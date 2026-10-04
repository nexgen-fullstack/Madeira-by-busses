import { clock } from '../lib/format.ts';

export interface HourEntry {
  time: number;
  /** Footnote letter, e.g. for a bus that turns back early. */
  mark?: string;
}

interface Props {
  entries: readonly HourEntry[];
  /** Departure to highlight: the bus of the chosen journey. */
  chosen?: number;
  /** Seconds after midnight now, when the table is for today: earlier buses fade. */
  now?: number;
}

/** Departures as a printed timetable shows them: one row per hour, the minutes after it. */
export function HourTable({ entries, chosen, now }: Props) {
  const rows = new Map<number, HourEntry[]>();
  for (const e of entries) {
    const h = Math.floor(e.time / 3600);
    rows.set(h, [...(rows.get(h) ?? []), e]);
  }
  return (
    <table className="timetable">
      <tbody>
        {[...rows.entries()].map(([h, list]) => (
          <tr key={h}>
            <th scope="row">{String(h % 24).padStart(2, '0')}</th>
            <td>
              {list.map((e, i) => {
                const classes = [
                  e.time === chosen ? 'is-chosen' : '',
                  now !== undefined && e.time < now && e.time !== chosen ? 'is-past' : '',
                ].join(' ');
                return (
                  <span
                    key={`${e.time}-${i}`}
                    className={classes.trim() || undefined}
                    aria-current={e.time === chosen ? 'true' : undefined}
                  >
                    {clock(e.time).slice(3)}
                    {e.mark && <sup className="timetable__mark">{e.mark}</sup>}
                  </span>
                );
              })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
