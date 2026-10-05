import type { LineReport, TimetableBuild } from './build.ts';

/** The part of the nightly report about the printed timetables. */
export function timetableReportMarkdown(
  lines: readonly LineReport[],
  missing?: TimetableBuild['missing'],
): string {
  const out = [
    '',
    '## CAM and SIGA Rodoeste (printed timetables)',
    '',
    'Trips "with every stop" lie on a route variant the SIGA website has shown; the others run',
    'between the printed places only, until the collector sees their variant run.',
    '',
    '| Line | Operator | With every stop | Printed places only | Left out |',
    '| ---- | -------- | --------------: | ------------------: | -------: |',
  ];
  for (const l of lines) {
    out.push(`| ${l.line} | ${l.operator} | ${l.full} | ${l.outline} | ${l.skipped.length} |`);
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
