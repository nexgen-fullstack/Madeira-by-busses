import { RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import { capitalise, clock } from '../lib/format.ts';
import type { LineTrips } from '../lib/scenic.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';
import { HourTable } from './HourTable.tsx';
import { RouteBadge } from './RouteBadge.tsx';

interface Props {
  /** The day's direct buses, line by line, busiest first. */
  lines: readonly LineTrips[];
  date: string;
  /** "There" or "Back". */
  tag: string;
  from: string;
  to: string;
  /** The way back: its last bus stands out, the one not to miss. */
  back?: boolean;
  /** A line's number tapped: its way on the map and its timetable, from where it is boarded. */
  onLine: (route: number, stop: number) => void;
}

/** Lines by the stop most of their buses are boarded at, in the order given. */
function byStop(lines: readonly LineTrips[]): Map<number, LineTrips[]> {
  const out = new Map<number, LineTrips[]>();
  for (const l of lines) out.set(l.from, [...(out.get(l.from) ?? []), l]);
  return out;
}

/**
 * All the day's direct buses between two places, whatever their line, as one printed
 * timetable: first and last (on the way back, the last bus back), every departure by the
 * hour with its line's number, and the lines themselves with where they are boarded.
 */
export function DayTrips({ lines, date, tag, from, to, back = false, onLine }: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  const trips = lines
    .flatMap((l) => l.trips)
    .sort((a, b) => a.depart - b.depart || a.arrive - b.arrive);
  if (trips.length === 0) return null;
  const rides = trips.map((c) => c.arrive - c.depart).sort((a, b) => a - b);
  const minutes = Math.round(rides[Math.floor(rides.length / 2)]! / 60);
  const first = clock(trips[0]!.depart);
  const last = clock(trips[trips.length - 1]!.depart);
  return (
    <div className="ride-timetable day-trips">
      <div className="ride-timetable__head">
        <span className="ride-timetable__route">
          <span className="ride-timetable__tag">{tag}</span>
          {from} → {to}
        </span>
        <span className="muted small nowrap">{t.t('dur.m', { m: minutes })}</span>
      </div>
      <p className="first-last">
        {t.t('lines.firstLast', { first, last })} · {t.tn('lines.buses', trips.length)}
      </p>
      {back && (
        <p className="day-trips__last">
          <RotateCcw size={16} aria-hidden /> {capitalise(t, t.t('scenic.lastBack', { t: last }))}
        </p>
      )}
      {/* The lines by where they are boarded, each number opening the line. */}
      {[...byStop(lines)].map(([stop, list]) => (
        <div key={stop} className="day-trips__lines">
          <span className="day-trips__stop">
            {capitalise(t, t.t('scenic.boardsAt', { stop: net.stops[stop]!.name }))}
          </span>
          <span className="day-trips__badges">
            {list.map((l) => (
              <button
                key={l.route}
                type="button"
                className="day-trips__line"
                aria-label={`${net.routes[l.route]!.short} — ${t.t('scenic.linesHint')}`}
                onClick={() => onLine(l.route, l.from)}
              >
                <RouteBadge route={net.routes[l.route]!} size="sm" />
              </button>
            ))}
          </span>
        </div>
      ))}
      <HourTable
        entries={trips.map((c) => ({ time: c.depart, line: net.routes[c.route]!.short }))}
        now={date === now.date ? now.time : undefined}
      />
    </div>
  );
}
