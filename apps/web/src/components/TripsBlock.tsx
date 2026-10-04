import type { Connection } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { clock } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';
import { HourTable } from './HourTable.tsx';
import { RouteBadge } from './RouteBadge.tsx';

interface Props {
  route: number;
  /** The usual stops the buses are boarded at and left. */
  from: number;
  to: number;
  trips: readonly Connection[];
  date: string;
  /** "There" or "Back". */
  tag?: string;
  /** Departure of the bus a journey takes, highlighted. */
  chosen?: number;
}

/**
 * One line's buses of the day between two places: first and last, every
 * departure by the hour, and a letter on a bus that is boarded at another stop.
 */
export function TripsBlock({ route, from, to, trips, date, tag, chosen }: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  if (trips.length === 0) return null;
  const name = (s: number) => net.stops[s]!.name;
  const usual = name(from);
  const others = [...new Set(trips.map((c) => name(c.from)).filter((n) => n !== usual))];
  const mark = (c: Connection) => {
    const i = others.indexOf(name(c.from));
    return i < 0 ? undefined : String.fromCharCode(97 + i);
  };
  const rides = trips.map((c) => c.arrive - c.depart).sort((a, b) => a - b);
  const minutes = Math.round(rides[Math.floor(rides.length / 2)]! / 60);
  return (
    <div className="ride-timetable">
      <div className="ride-timetable__head">
        <RouteBadge route={net.routes[route]!} size="sm" />
        <span className="ride-timetable__route">
          {tag && <span className="ride-timetable__tag">{tag}</span>}
          {usual} → {name(to)}
        </span>
        <span className="muted small nowrap">{t.t('dur.m', { m: minutes })}</span>
      </div>
      <p className="first-last">
        {t.t('lines.firstLast', {
          first: clock(trips[0]!.depart),
          last: clock(trips[trips.length - 1]!.depart),
        })}{' '}
        · {t.tn('lines.buses', trips.length)}
      </p>
      <HourTable
        entries={trips.map((c) => ({ time: c.depart, mark: mark(c) }))}
        chosen={chosen}
        now={date === now.date ? now.time : undefined}
      />
      {others.length > 0 && (
        <ul className="legend">
          {others.map((stop, i) => (
            <li key={stop}>
              <sup className="timetable__mark">{String.fromCharCode(97 + i)}</sup>{' '}
              {t.t('scenic.boardsAt', { stop })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
