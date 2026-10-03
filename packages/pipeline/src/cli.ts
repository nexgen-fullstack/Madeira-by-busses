#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync, strToU8 } from 'fflate';
import {
  addDays,
  buildBundle,
  madeiraNow,
  parseGtfs,
  SIGA_FARES_2026,
  type FeedInput,
  type NetworkBundle,
} from '@madeirabus/engine';
import { generateDemoGtfs } from './demo/generate.ts';
import { loadFeedFiles, parseFeedArg } from './load.ts';
import { expandAbbreviations, prettyAgencyName, prettyRouteName, prettyStopName } from './names.ts';
import { DEMO_PLACES } from './demo/places.ts';
import { placesFromOsm } from './places.ts';
import { buildReportMarkdown, diffBundles, diffMarkdown } from './report.ts';
import { validateBundle, validateFeed, type Issue } from './validate.ts';

const USAGE = `madeirabus-pipeline <command>

  demo  --out <dir>                       write the synthetic demo network as GTFS
  build --feed [name=]<dir|zip|url>[|fallback] …   build the app's network bundle
        --out <bundle.json> [--report <report.md>] [--diff <diff.md>]
        [--demo] [--strict] [--pretty-names]
        [--extend-days <n>]          carry an expired timetable forward n days from today
        [--missing <op1,op2>]        operators not covered yet (shown in the app)
        [--places <osm.json>]        searchable places from an Overpass answer (skipped if absent)
  validate --feed [name=]<dir|zip|url> …  validate feeds only
  diff <old.json> <new.json>              summarise timetable changes
`;

interface Args {
  _: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const value = next !== undefined && !next.startsWith('--') ? (i++, next) : 'true';
      out.flags.set(key, [...(out.flags.get(key) ?? []), value]);
    } else {
      out._.push(a);
    }
  }
  return out;
}

const flag = (args: Args, key: string) => args.flags.get(key)?.[0];

async function writeText(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function printIssues(title: string, issues: Issue[]) {
  if (issues.length === 0) {
    console.log(`✓ ${title}: no issues`);
    return;
  }
  console.log(`${title}:`);
  for (const i of issues) {
    const mark = i.severity === 'error' ? '✗' : i.severity === 'warning' ? '!' : 'i';
    console.log(`  ${mark} [${i.code}] ${i.message} ×${i.count} — e.g. ${i.samples[0]}`);
  }
}

async function demo(args: Args) {
  const out = flag(args, 'out') ?? 'data/demo/gtfs';
  const files = generateDemoGtfs();
  for (const [name, text] of Object.entries(files)) await writeText(join(out, name), text);
  console.log(`Demo GTFS written to ${out} (${Object.keys(files).length} files)`);
}

async function loadFeeds(args: Args) {
  const feedArgs = args.flags.get('feed') ?? [];
  if (feedArgs.length === 0) throw new Error('At least one --feed is required');
  const today = madeiraNow().date;
  const loaded: { input: FeedInput; issues: Issue[] }[] = [];
  for (const arg of feedArgs) {
    const { name, location } = parseFeedArg(arg);
    console.log(`Loading ${name} from ${location}…`);
    const feed = parseGtfs(await loadFeedFiles(location));
    const issues = validateFeed(feed, today);
    printIssues(`Feed ${name}`, issues);
    loaded.push({
      input: {
        feed,
        source: {
          name,
          // The first of the `|`-separated locations is the operator's own.
          url: location.split('|').find((l) => /^https?:/.test(l)),
          fetchedAt: new Date().toISOString(),
        },
        prefix: feedArgs.length > 1 ? `${name}:` : '',
      },
      issues,
    });
  }
  return { loaded, today };
}

async function build(args: Args) {
  const out = flag(args, 'out');
  if (!out) throw new Error('--out is required');
  const { loaded, today } = await loadFeeds(args);
  const extendDays = flag(args, 'extend-days');
  const extendUntil = extendDays ? addDays(today, Number(extendDays)) : undefined;
  // An expired feed is expected when we are about to carry it forward.
  const ignore = new Set(extendUntil ? ['feed-expired'] : []);
  const errors = loaded
    .flatMap((l) => l.issues)
    .filter((i) => i.severity === 'error' && !ignore.has(i.code));
  if (errors.length > 0 && args.flags.has('strict')) {
    throw new Error(`${errors.length} kinds of errors in the feeds; refusing to build (--strict)`);
  }

  const { bundle, report } = buildBundle(
    loaded.map((l) => l.input),
    {
      demo: args.flags.has('demo'),
      fares: SIGA_FARES_2026,
      extendUntil,
      ...(args.flags.has('pretty-names') && {
        stopName: prettyStopName,
        routeName: prettyRouteName,
        agencyName: prettyAgencyName,
        headsign: expandAbbreviations,
      }),
      missingOperators: flag(args, 'missing')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  );
  if (bundle.projected) {
    console.log(
      `! Official timetable ended ${bundle.projected.officialUntil}; ` +
        `${report.projectedServices} services carried forward to ${bundle.projected.until}`,
    );
  }
  const placesPath = flag(args, 'places');
  if (placesPath && existsSync(placesPath)) {
    bundle.places = placesFromOsm(JSON.parse(await readFile(placesPath, 'utf8')));
    console.log(`Places: ${bundle.places.length} from ${placesPath}`);
  } else if (placesPath) {
    console.log(`! No places file at ${placesPath}; searching stops only`);
  }
  if (!bundle.places && bundle.demo) bundle.places = DEMO_PLACES;
  const bundleIssues = validateBundle(bundle, today);
  printIssues('Network', bundleIssues);

  const previous: NetworkBundle | undefined = existsSync(out)
    ? JSON.parse(await readFile(out, 'utf8'))
    : undefined;
  const json = JSON.stringify(bundle);
  await writeText(out, json);
  const gz = gzipSync(strToU8(json), { level: 9 }).length;

  console.log(
    `Bundle written to ${out}: ${bundle.stats.stops} stops, ${bundle.stats.routes} routes, ` +
      `${bundle.stats.trips} trips, ${(json.length / 1024).toFixed(0)} KiB (${(gz / 1024).toFixed(0)} KiB gzipped)`,
  );

  const reportPath = flag(args, 'report');
  if (reportPath) {
    const md = buildReportMarkdown(
      bundle,
      report,
      loaded.map((l) => ({ feed: l.input.source.name, issues: l.issues })),
      bundleIssues,
      json.length,
    );
    await writeText(reportPath, md);
    console.log(`Report written to ${reportPath}`);
  }
  const diffPath = flag(args, 'diff');
  if (diffPath && previous) {
    await writeText(diffPath, diffMarkdown(diffBundles(previous, bundle)));
    console.log(`Diff written to ${diffPath}`);
  }
}

async function validate(args: Args) {
  const { loaded } = await loadFeeds(args);
  if (loaded.some((l) => l.issues.some((i) => i.severity === 'error'))) process.exitCode = 1;
}

async function diff(args: Args) {
  const [a, b] = args._.slice(1);
  if (!a || !b) throw new Error('diff needs <old.json> <new.json>');
  const before = JSON.parse(await readFile(a, 'utf8')) as NetworkBundle;
  const after = JSON.parse(await readFile(b, 'utf8')) as NetworkBundle;
  process.stdout.write(diffMarkdown(diffBundles(before, after)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const commands: Record<string, (a: Args) => Promise<void>> = { demo, build, validate, diff };
  const run = command ? commands[command] : undefined;
  if (!run) {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }
  await run(args);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
