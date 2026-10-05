import type { LineReport, ObservedReport, PlannerReport, TimetableBuild } from './build.ts';

const DAY_NAMES: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
  hol: 'Holiday',
};

/** The part of the nightly report about CAM and SIGA Rodoeste. */
export function timetableReportMarkdown(
  lines: readonly LineReport[],
  missing?: TimetableBuild['missing'],
  observed?: ObservedReport,
  planner?: PlannerReport,
): string {
  const out = ['', '## CAM and SIGA Rodoeste', ''];
  if (planner) {
    out.push(
      "### Timetable of SIGA's journey planner",
      '',
      'Every trip of every line with its time at every stop, and the days each service runs',
      '(holidays run the Sunday service, the school calendar picks the weekday one).',
      '',
      '| Service | First day | Last day | Days | Trips |',
      '| ------- | --------- | -------- | ---: | ----: |',
    );
    for (const s of planner.services) {
      out.push(`| ${s.id} | ${s.first} | ${s.last} | ${s.dates} | ${s.trips} |`);
    }
    const byOp = new Map<string, string[]>();
    for (const l of planner.lines) byOp.set(l.operator, [...(byOp.get(l.operator) ?? []), l.line]);
    for (const [op, list] of byOp) {
      out.push('', `Lines (${op}, ${list.length}): ${list.join(', ')}.`);
    }
    out.push('');
  }
  if (observed && observed.days.some((d) => d.trips > 0)) {
    out.push(
      '### Timetables seen on the SIGA website',
      '',
      'Every trip of every variant at every stop, as the site showed them on a day; such a day',
      'stands for the days of its kind to come until the collector sees the next one.',
      '',
      '| Kind of day | Seen on | Variants | Trips | Dates it stands for |',
      '| ----------- | ------- | -------: | ----: | ------------------: |',
    );
    for (const d of observed.days) {
      out.push(
        `| ${DAY_NAMES[d.kind] ?? d.kind} | ${d.date} | ${d.variants} | ${d.trips} | ${d.dates} |`,
      );
    }
    const byOp = new Map<string, string[]>();
    for (const l of observed.lines) byOp.set(l.operator, [...(byOp.get(l.operator) ?? []), l.line]);
    for (const [op, list] of byOp) out.push('', `Lines seen (${op}): ${list.join(', ')}.`);
    out.push('');
  }
  const used = lines.filter((l) => !l.covered);
  const standBy = lines.filter((l) => l.covered);
  if (used.length > 0) {
    out.push(
      '### Printed timetables',
      '',
      'For the days the SIGA website has not been seen on yet. Trips "with every stop" lie on a',
      'route variant the site has shown; the others run between the printed places, with the stops',
      'of the stretches every known variant agrees on.',
      '',
      '| Line | Operator | With every stop | Between printed places | Of those with some stops | Left out |',
      '| ---- | -------- | --------------: | ---------------------: | -----------------------: | -------: |',
    );
    for (const l of used) {
      out.push(
        `| ${l.line} | ${l.operator} | ${l.full} | ${l.outline} | ${l.filled} | ${l.skipped.length} |`,
      );
    }
  }
  if (standBy.length > 0) {
    out.push(
      '',
      `Printed timetables standing by (the journey planner has these lines): ${standBy
        .map((l) => l.line)
        .join(', ')}.`,
    );
  }
  for (const [op, list] of Object.entries(missing ?? {})) {
    if (list.length > 0) out.push('', `Not in the app yet (${op}): ${list.join(', ')}.`);
  }
  const notes = lines.flatMap((l) => [
    ...l.warnings.map((w) => `- ${l.file}: ${w}`),
    ...l.skipped.map((w) => `- ${l.file}: left out ${w}`),
  ]);
  if (notes.length > 0) out.push('', '### Notes', '', ...notes);
  return out.join('\n') + '\n';
}
