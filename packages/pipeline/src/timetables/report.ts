import type { LineReport, ObservedReport, TimetableBuild } from './build.ts';

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
): string {
  const out = ['', '## CAM and SIGA Rodoeste', ''];
  if (observed && observed.days.length > 0) {
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
  for (const l of lines) {
    out.push(
      `| ${l.line} | ${l.operator} | ${l.full} | ${l.outline} | ${l.filled} | ${l.skipped.length} |`,
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
