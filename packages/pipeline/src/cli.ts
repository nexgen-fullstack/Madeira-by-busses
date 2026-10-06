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
  decodeWalkGraphData,
  encodeWalkGraph,
  WalkGraph,
  type FeedInput,
  type NetworkBundle,
} from '@madeirabus/engine';
import { generateDemoGtfs } from './demo/generate.ts';
import { loadFeedFiles, parseFeedArg } from './load.ts';
import {
  expandAbbreviations,
  prettyAgencyName,
  prettyRouteName,
  prettyStopName,
  sigaRouteNumber,
} from './names.ts';
import { DEMO_PLACES } from './demo/places.ts';
import { placesFromOsm, type OsmElement } from './places.ts';
import { buildReportMarkdown, diffBundles, diffMarkdown } from './report.ts';
import { addressesFromOsm } from './addresses.ts';
import { buildWalkGraph, type OsmWay } from './walk.ts';
import { driveKind, reverseDriveKind } from './drive.ts';
import { RoadRouter } from './shapes.ts';
import { checkShapes, offRoadMarkdown } from './checkShapes.ts';
import { AGENCIES, buildTimetableFeed } from './timetables/build.ts';
import { loadLocalities, loadSiga, loadTimetables } from './timetables/load.ts';
import { timetableReportMarkdown } from './timetables/report.ts';
import { validateBundle, validateFeed, type Issue } from './validate.ts';

const USAGE = `madeirabus-pipeline <command>

  demo  --out <dir>                       write the synthetic demo network as GTFS
  build --feed [name=]<dir|zip|url>[|fallback] …   build the app's network bundle
        --out <bundle.json> [--report <report.md>] [--diff <diff.md>]
        [--demo] [--strict] [--pretty-names]
        [--extend-days <n>]          carry an expired timetable forward n days from today
        [--missing <op1,op2>]        operators not covered yet (shown in the app)
        [--places <osm.json>]        searchable places from an Overpass answer (skipped if absent)
        [--walk <walk.bin>]          the walking network, copied next to the bundle (skipped if absent)
        [--addresses <json>]         streets and house numbers, copied next to the bundle (skipped if absent)
        [--drive <drive.bin>]        the roads: every line is drawn along them, in its lane
        [--timetables <dir> --siga <dir>]  add CAM and SIGA Rodoeste from their printed
                                     timetables and the SIGA website's routes
        [--timetable-days <n>]       how far ahead their calendar goes (default 180)
  validate --feed [name=]<dir|zip|url> …  validate feeds only
  diff <old.json> <new.json>              summarise timetable changes
  walk  --osm <overpass.json> --out <walk.bin>   the walking network from OpenStreetMap ways
  addresses --osm <overpass.json> --places <osm.json> --out <addresses.json>
                                          streets and house numbers to search for
  drive --osm <overpass.json> --out <drive.bin>  the roads buses drive on, from OpenStreetMap ways
  check-shapes --bundle <bundle.json> --drive <drive.bin> [--report <md>]
                                          every stretch of a line off the roads
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

/** The feed made from the printed timetables (--timetables, --siga), if asked for. */
async function timetableFeed(args: Args, today: string) {
  const dir = flag(args, 'timetables');
  const sigaDir = flag(args, 'siga');
  if (!dir || !sigaDir) return undefined;
  const files = await loadTimetables(dir);
  const siga = await loadSiga(sigaDir);
  const days = Number(flag(args, 'timetable-days') ?? 180);
  const placesPath = flag(args, 'places');
  const localities = placesPath ? await loadLocalities(placesPath) : [];
  const built = buildTimetableFeed(files, siga, {
    from: today,
    to: addDays(today, days),
    localities,
  });
  const full = built.lines.reduce((n, l) => n + l.full, 0);
  const outline = built.lines.reduce((n, l) => n + l.outline, 0);
  const filled = built.lines.reduce((n, l) => n + l.filled, 0);
  const skipped = built.lines.reduce((n, l) => n + l.skipped.length, 0);
  if (built.planner) {
    const trips = built.planner.lines.reduce((n, l) => n + l.trips, 0);
    console.log(
      `SIGA journey planner: ${built.planner.lines.length} lines, ${trips} trips; ` +
        built.planner.services
          .map((s) => `${s.id} ${s.dates} days (${s.first}…${s.last})`)
          .join(', '),
    );
  }
  for (const d of built.observed.days) {
    console.log(
      `SIGA timetable of a ${d.kind} (seen ${d.date}): ${d.variants} variants, ${d.trips} trips, for ${d.dates} dates`,
    );
  }
  const standBy = built.lines.filter((l) => l.covered).length;
  console.log(
    `Printed timetables: ${files.length} files (${standBy} standing by), ${full + outline} trips for the other days ` +
      `(${full} with every stop, ${outline} between the printed places, ${filled} of them with some stops; ` +
      `${skipped} rows left out); SIGA: ${siga.variants.length} variants, ${Object.keys(siga.stops).length} stops`,
  );
  for (const l of built.lines) {
    for (const w of l.warnings) console.log(`  ! ${l.file}: ${w}`);
  }
  for (const [op, lines] of Object.entries(built.missing)) {
    if (lines.length > 0)
      console.log(`  No trips yet (not seen on SIGA, not printed), ${op}: ${lines.join(' ')}`);
  }
  const issues = validateFeed(built.feed, today);
  printIssues('Feed timetables', issues);
  return { built, issues };
}

async function build(args: Args) {
  const out = flag(args, 'out');
  if (!out) throw new Error('--out is required');
  const { loaded, today } = await loadFeeds(args);
  const timetables = await timetableFeed(args, today);
  if (timetables) {
    loaded.push({
      input: {
        feed: timetables.built.feed,
        source: {
          name: 'CAM, SIGA Rodoeste',
          url: 'https://siga.madeira.gov.pt/horarios',
          fetchedAt: new Date().toISOString(),
        },
        prefix: 'siga:',
      },
      issues: timetables.issues,
    });
  }
  // The roads: lines without shapes (CAM, SIGA Rodoeste) drawn the way their buses drive,
  // drawn ones (Horários do Funchal) put on the roads they follow, every one in its lane.
  const drivePath = flag(args, 'drive');
  let router: RoadRouter | undefined;
  if (drivePath && existsSync(drivePath)) {
    router = new RoadRouter(decodeWalkGraphData(await readFile(drivePath)));
  } else if (drivePath) {
    console.log(`! No road network at ${drivePath}; lines without shapes are drawn straight`);
  }
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
      // Always: the number passengers see on the bus is not a matter of style.
      routeNumber: sigaRouteNumber,
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
      shareStops: timetables !== undefined,
      routeShape: router ? (points) => router.shape(points) : undefined,
      matchShape: router ? (shape) => router.match(shape) : undefined,
      partialOperators: timetables
        ? (Object.entries(timetables.built.missing) as [keyof typeof AGENCIES, string[]][])
            .filter(([, lines]) => lines.length > 0)
            .map(([op]) => AGENCIES[op].name)
        : undefined,
    },
  );
  if (router) {
    const s = router.stats;
    console.log(
      `Lines along the roads: ${s.patterns} stop sequences, ${s.routed} sections routed, ${s.straight} left straight; ` +
        `${s.matched} drawn lines put on the roads, ${s.kept} left as drawn`,
    );
  }
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
  // Every line checked against the roads: where one still crosses grass or houses.
  const offRoad = router ? checkShapes(bundle, roadDistance(router)) : undefined;
  if (offRoad) {
    const metres = Math.round(offRoad.reduce((m, s) => m + s.end - s.start, 0));
    console.log(
      `Lines off the roads: ${offRoad.length} stretches further than 10 m from a road, ${metres} m in all`,
    );
  }
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
    const lines = new Set(bundle.patterns.map((p) => p.shape)).size;
    const roads = offRoad ? `\n${offRoadMarkdown(offRoad, lines)}` : '';
    await writeText(
      reportPath,
      timetables
        ? md +
            roads +
            timetableReportMarkdown(
              timetables.built.lines,
              timetables.built.missing,
              timetables.built.observed,
              timetables.built.planner,
            )
        : md + roads,
    );
    console.log(`Report written to ${reportPath}`);
  }
  const diffPath = flag(args, 'diff');
  if (diffPath && previous) {
    await writeText(diffPath, diffMarkdown(diffBundles(previous, bundle)));
    console.log(`Diff written to ${diffPath}`);
  }

  // The walking network goes next to the timetable, as walk.bin.
  const walkPath = flag(args, 'walk');
  if (walkPath && existsSync(walkPath)) {
    const bytes = await readFile(walkPath);
    const g = WalkGraph.decode(bytes);
    const target = join(dirname(out), 'walk.bin');
    await writeFile(target, bytes);
    console.log(
      `Walking network copied to ${target}: ${g.nodeCount} junctions, ${g.edgeCount} links`,
    );
  } else if (walkPath) {
    console.log(`! No walking network at ${walkPath}; walks are drawn as the crow flies`);
  }

  // Streets and house numbers too, as addresses.json, which the app loads once someone types.
  const addressPath = flag(args, 'addresses');
  if (addressPath && existsSync(addressPath)) {
    const target = join(dirname(out), 'addresses.json');
    await writeFile(target, await readFile(addressPath));
    console.log(`Addresses copied to ${target}`);
  } else if (addressPath) {
    console.log(`! No addresses at ${addressPath}; only stops and places can be searched`);
  }
}

async function addresses(args: Args) {
  const input = flag(args, 'osm');
  const placesPath = flag(args, 'places');
  const out = flag(args, 'out');
  if (!input || !placesPath || !out) {
    throw new Error('addresses needs --osm <overpass.json> --places <osm.json> --out <json>');
  }
  const json = JSON.parse(await readFile(input, 'utf8')) as { elements?: OsmElement[] };
  const places = placesFromOsm(JSON.parse(await readFile(placesPath, 'utf8')));
  const book = addressesFromOsm(json.elements ?? [], places);
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(book);
  await writeFile(out, text);
  const houses = book.streets.reduce((n, s) => n + s[5].length, 0);
  console.log(
    `Addresses: ${book.streets.length} streets, ${houses} house numbers, ` +
      `${book.areas.length} villages and towns, ${Math.round(text.length / 1024)} KiB`,
  );
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

async function walk(args: Args) {
  const input = flag(args, 'osm');
  const out = flag(args, 'out');
  if (!input || !out) throw new Error('walk needs --osm <overpass.json> and --out <walk.bin>');
  const json = JSON.parse(await readFile(input, 'utf8')) as {
    elements?: OsmWay[] & { type?: string }[];
  };
  const ways = (json.elements ?? []).filter((e) => (e as { type?: string }).type !== 'node');
  const { graph, stats } = buildWalkGraph(ways);
  const bytes = encodeWalkGraph(graph);
  // Read it back: the app must be able to.
  WalkGraph.decode(bytes);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  const kb = (n: number) => `${Math.round(n / 1024)} KiB`;
  console.log(
    `Walking network: ${stats.walkable} of ${stats.ways} ways, ${stats.km} km, ` +
      `${stats.nodes} junctions, ${stats.edges} links (${stats.droppedComponents} isolated pieces left out)`,
  );
  console.log(`Written to ${out}: ${kb(bytes.length)} (${kb(gzipSync(bytes).length)} gzipped)`);
}

async function drive(args: Args) {
  const input = flag(args, 'osm');
  const out = flag(args, 'out');
  if (!input || !out) throw new Error('drive needs --osm <overpass.json> and --out <drive.bin>');
  const json = JSON.parse(await readFile(input, 'utf8')) as {
    elements?: OsmWay[] & { type?: string }[];
  };
  const ways = (json.elements ?? []).filter((e) => (e as { type?: string }).type !== 'node');
  const { graph, stats } = buildWalkGraph(ways, {
    kindOf: (tags) => driveKind(tags),
    reverse: reverseDriveKind,
    tolerance: 2,
    minComponent: 300,
  });
  const bytes = encodeWalkGraph(graph);
  // Read it back: the build must be able to.
  decodeWalkGraphData(bytes);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  const kb = (n: number) => `${Math.round(n / 1024)} KiB`;
  console.log(
    `Road network: ${stats.walkable} of ${stats.ways} ways, ${stats.km} km, ` +
      `${stats.nodes} junctions, ${stats.edges} links (${stats.droppedComponents} isolated pieces left out)`,
  );
  console.log(`Written to ${out}: ${kb(bytes.length)} (${kb(gzipSync(bytes).length)} gzipped)`);
}

/** How far a point is from the nearest road, looking no further than 60 m (by the metre, remembered). */
function roadDistance(router: RoadRouter) {
  const known = new Map<string, number>();
  return (p: { lat: number; lon: number }) => {
    const key = `${Math.round(p.lat * 1e5)},${Math.round(p.lon * 1e5)}`;
    let d = known.get(key);
    if (d === undefined) {
      d = router.nearest(p, 60)?.offset ?? Number.POSITIVE_INFINITY;
      known.set(key, d);
    }
    return d;
  };
}

async function checkShapesCommand(args: Args) {
  const bundlePath = flag(args, 'bundle');
  const drivePath = flag(args, 'drive');
  if (!bundlePath || !drivePath) throw new Error('check-shapes needs --bundle and --drive');
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as NetworkBundle;
  const router = new RoadRouter(decodeWalkGraphData(await readFile(drivePath)));
  const found = checkShapes(bundle, roadDistance(router));
  const md = offRoadMarkdown(found, new Set(bundle.patterns.map((p) => p.shape)).size);
  const reportPath = flag(args, 'report');
  if (reportPath) await writeText(reportPath, md);
  process.stdout.write(`${md}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const commands: Record<string, (a: Args) => Promise<void>> = {
    demo,
    build,
    validate,
    diff,
    walk,
    addresses,
    drive,
    'check-shapes': checkShapesCommand,
  };
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
