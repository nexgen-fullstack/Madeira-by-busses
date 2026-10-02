import type { BuildReport, NetworkBundle } from '@madeirabus/engine';
import type { Issue } from './validate.ts';

export interface BundleDiff {
  addedRoutes: string[];
  removedRoutes: string[];
  changedRoutes: { route: string; before: number; after: number }[];
  addedStops: number;
  removedStops: number;
  validityChanged: boolean;
}

const routeLabel = (b: NetworkBundle, i: number) => {
  const r = b.routes[i]!;
  return `${r.short} ${r.long}`.trim();
};

function tripsPerRoute(b: NetworkBundle): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of b.patterns) {
    const key = b.routes[p.route]!.id;
    out.set(key, (out.get(key) ?? 0) + p.trips.length);
  }
  return out;
}

/** What changed between two bundles, for the nightly "timetable changed" message. */
export function diffBundles(before: NetworkBundle, after: NetworkBundle): BundleDiff {
  const beforeRoutes = new Map(before.routes.map((r, i) => [r.id, routeLabel(before, i)]));
  const afterRoutes = new Map(after.routes.map((r, i) => [r.id, routeLabel(after, i)]));
  const tb = tripsPerRoute(before);
  const ta = tripsPerRoute(after);
  const beforeStops = new Set(before.stops.map((s) => s.id));
  const afterStops = new Set(after.stops.map((s) => s.id));
  return {
    addedRoutes: [...afterRoutes].filter(([id]) => !beforeRoutes.has(id)).map(([, l]) => l),
    removedRoutes: [...beforeRoutes].filter(([id]) => !afterRoutes.has(id)).map(([, l]) => l),
    changedRoutes: [...afterRoutes]
      .filter(([id]) => beforeRoutes.has(id) && (tb.get(id) ?? 0) !== (ta.get(id) ?? 0))
      .map(([id, label]) => ({ route: label, before: tb.get(id) ?? 0, after: ta.get(id) ?? 0 })),
    addedStops: [...afterStops].filter((s) => !beforeStops.has(s)).length,
    removedStops: [...beforeStops].filter((s) => !afterStops.has(s)).length,
    validityChanged:
      before.validity.from !== after.validity.from || before.validity.to !== after.validity.to,
  };
}

export function isEmptyDiff(d: BundleDiff): boolean {
  return (
    d.addedRoutes.length === 0 &&
    d.removedRoutes.length === 0 &&
    d.changedRoutes.length === 0 &&
    d.addedStops === 0 &&
    d.removedStops === 0 &&
    !d.validityChanged
  );
}

export function diffMarkdown(d: BundleDiff): string {
  if (isEmptyDiff(d)) return 'No timetable changes.\n';
  const lines = ['## Timetable changes', ''];
  if (d.addedRoutes.length) lines.push(`- Added routes: ${d.addedRoutes.join(', ')}`);
  if (d.removedRoutes.length) lines.push(`- Removed routes: ${d.removedRoutes.join(', ')}`);
  for (const c of d.changedRoutes) lines.push(`- ${c.route}: ${c.before} → ${c.after} trips`);
  if (d.addedStops || d.removedStops) lines.push(`- Stops: +${d.addedStops} / −${d.removedStops}`);
  if (d.validityChanged) lines.push('- Validity period changed');
  return lines.join('\n') + '\n';
}

export function buildReportMarkdown(
  bundle: NetworkBundle,
  build: BuildReport,
  issues: { feed: string; issues: Issue[] }[],
  bundleIssues: Issue[],
  bytes: number,
): string {
  const lines: string[] = [];
  lines.push(`# Network build report`, '');
  lines.push(
    `Generated ${bundle.generatedAt}${bundle.demo ? ' — **DEMO DATA (synthetic timetable)**' : ''}`,
    '',
  );
  lines.push('| Metric | Value |', '| --- | --- |');
  lines.push(`| Sources | ${bundle.sources.map((s) => s.name).join(', ')} |`);
  lines.push(`| Valid | ${bundle.validity.from} → ${bundle.validity.to} |`);
  lines.push(`| Stops | ${bundle.stats.stops} |`);
  lines.push(`| Routes | ${bundle.stats.routes} |`);
  lines.push(`| Patterns | ${bundle.stats.patterns} |`);
  lines.push(`| Trips | ${bundle.stats.trips} |`);
  lines.push(`| Bundle size | ${(bytes / 1024).toFixed(0)} KiB |`);
  lines.push(`| Interpolated times | ${build.interpolatedTimes} |`);
  lines.push(`| Frequency trips expanded | ${build.expandedFrequencyTrips} |`);
  lines.push(`| Patterns split for FIFO | ${build.splitPatterns} |`, '');

  const section = (title: string, list: Issue[]) => {
    lines.push(`## ${title}`, '');
    if (list.length === 0) {
      lines.push('No issues.', '');
      return;
    }
    lines.push('| Severity | Issue | Count | Examples |', '| --- | --- | --- | --- |');
    for (const i of list) {
      lines.push(
        `| ${i.severity} | ${i.message} | ${i.count} | ${i.samples.join('; ').replaceAll('|', '/')} |`,
      );
    }
    lines.push('');
  };
  for (const f of issues) section(`Feed "${f.feed}"`, f.issues);
  section('Merged network', bundleIssues);
  if (build.warnings.length) {
    lines.push('## Build warnings', '');
    for (const w of build.warnings.slice(0, 50)) lines.push(`- ${w}`);
    if (build.warnings.length > 50) lines.push(`- … and ${build.warnings.length - 50} more`);
    lines.push('');
  }
  return lines.join('\n');
}
