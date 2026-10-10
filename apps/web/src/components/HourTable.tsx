import { clock } from '../lib/format.ts';

export interface HourEntry {
  time: number;
  /** Footnote letter, e.g. for a bus that turns back early. */
  mark?: string;
  /** The bus's line number, for a table of several lines. */
  line?: string;
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
                    {e.line && <small className="timetable__line">{e.line}</small>}
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

/** A bus of a line's timetable: when it leaves the stop, and which bus of the day it is. */
export interface WayEntry extends HourEntry {
  pattern: number;
  dayTrip: number;
}

/** One way of a line in the timetable: its colour, where it goes and from which stop. */
export interface WayColumn {
  color: string;
  title: string;
  from: string;
  entries: readonly WayEntry[];
}

/**
 * A line's timetable both ways side by side, as at a stop with a shelter on each side of
 * the road: the hour down the middle, this way's minutes to its left, the way back's to
 * its right. Each minute is a button that opens that bus.
 */
export function WaysTable({
  ways,
  now,
  label,
  onPick,
}: {
  ways: readonly WayColumn[];
  now?: number;
  /** What a minute's button says it opens ("The 08:20 bus"). */
  label: (time: number) => string;
  onPick: (entry: WayEntry, way: number) => void;
}) {
  const hours = [
    ...new Set(ways.flatMap((w) => w.entries.map((e) => Math.floor(e.time / 3600)))),
  ].sort((a, b) => a - b);
  const two = ways.length > 1;
  const minutes = (way: number, hour: number) => (
    <div className={`ways__mins${two && way === 0 ? ' ways__mins--left' : ''}`}>
      {ways[way]!.entries.filter((e) => Math.floor(e.time / 3600) === hour).map((e) => (
        <button
          key={`${e.pattern}-${e.dayTrip}`}
          type="button"
          className={`ways__min${now !== undefined && e.time < now ? ' is-past' : ''}`}
          style={{ ['--way' as string]: ways[way]!.color }}
          aria-label={label(e.time)}
          onClick={() => onPick(e, way)}
        >
          {clock(e.time).slice(3)}
          {e.mark && <sup className="timetable__mark">{e.mark}</sup>}
        </button>
      ))}
    </div>
  );
  return (
    <div className={`ways${two ? ' ways--two' : ''}`}>
      <div className="ways__head">
        {ways.map((w, i) => (
          <div key={i} className={`ways__title${two && i === 0 ? ' ways__title--left' : ''}`}>
            <span className="way-swatch" style={{ background: w.color }} aria-hidden />
            <span>
              <strong>→ {w.title}</strong>
              <small className="muted">{w.from}</small>
            </span>
          </div>
        ))}
      </div>
      {hours.map((h) => (
        <div key={h} className="ways__row">
          {two && minutes(0, h)}
          <span className="ways__hour">{String(h % 24).padStart(2, '0')}</span>
          {minutes(two ? 1 : 0, h)}
        </div>
      ))}
    </div>
  );
}
