import type { Network } from './network.ts';

/**
 * Whether a row of a day timetable is one of the day's own trips. The day
 * timetable also holds yesterday's trips that run past midnight, moved a day
 * earlier; those belong to yesterday's printed timetable.
 */
function ownTrip(net: Network, pattern: number, start: number, trip: number): boolean {
  return start === net.patterns[pattern]!.trips[trip]![1];
}

/** One bus of the day between two stops of the same trip. */
export interface Connection {
  pattern: number;
  route: number;
  /** Index of the trip in the pattern's day timetable. */
  dayTrip: number;
  tripId: string;
  headsign: string;
  /** Stop where the bus is boarded, and its departure from it. */
  from: number;
  depart: number;
  /** Stop where the bus is left, and its arrival there. */
  to: number;
  arrive: number;
}

export interface ConnectionOptions {
  /** Only these lines, e.g. the variants of one line. */
  routes?: ReadonlySet<number>;
  /**
   * Which of the stops a trip serves to board and leave at: by default the
   * first of the `from` stops it reaches (where a line starts or enters the
   * centre) and the first `to` stop after it; with "listed", the earliest
   * listed of each, for stops listed nearest first.
   */
  pick?: 'first' | 'listed';
}

/**
 * Every bus of a service day that goes from one of the `from` stops to one of
 * the `to` stops without a change, by departure. Trips are those of the
 * day's own services, so the timetable reads like a printed one: a 24:30
 * departure closes the day it belongs to.
 */
export function directConnections(
  net: Network,
  from: Iterable<number>,
  to: Iterable<number>,
  date: string,
  options: ConnectionOptions = {},
): Connection[] {
  const fromRank = new Map([...from].map((s, i) => [s, i] as const));
  const toRank = new Map([...to].map((s, i) => [s, i] as const));
  const listed = options.pick === 'listed';
  const day = net.timetable(date);
  const seen = new Set<number>();
  const out: Connection[] = [];
  for (const stop of fromRank.keys()) {
    for (const { pattern } of net.stopPatterns[stop] ?? []) {
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      const p = net.patterns[pattern]!;
      if (options.routes && !options.routes.has(p.route)) continue;
      const leg = pickLeg(p.stops, fromRank, toRank, listed);
      if (!leg) continue;
      const [board, alight] = leg;
      const dp = day.patterns[pattern]!;
      for (let j = 0; j < dp.start.length; j++) {
        if (!ownTrip(net, pattern, dp.start[j]!, dp.trip[j]!)) continue;
        out.push({
          pattern,
          route: p.route,
          dayTrip: j,
          tripId: p.trips[dp.trip[j]!]![3],
          headsign: p.headsign,
          from: p.stops[board]!,
          depart: net.departureAt(pattern, dp, j, board),
          to: p.stops[alight]!,
          arrive: net.arrivalAt(pattern, dp, j, alight),
        });
      }
    }
  }
  return out.sort((a, b) => a.depart - b.depart || a.arrive - b.arrive);
}

/** Positions to board and leave a stop sequence at, or undefined when it does not connect. */
function pickLeg(
  stops: readonly number[],
  fromRank: ReadonlyMap<number, number>,
  toRank: ReadonlyMap<number, number>,
  listed: boolean,
): [number, number] | undefined {
  const better = (rank: ReadonlyMap<number, number>, i: number, best: number) =>
    best < 0 || (listed && rank.get(stops[i]!)! < rank.get(stops[best]!)!);
  // The last stop where a `to` stop still follows.
  let lastTo = -1;
  for (let i = stops.length - 1; i >= 0 && lastTo < 0; i--) if (toRank.has(stops[i]!)) lastTo = i;
  let board = -1;
  for (let i = 0; i < lastTo; i++) {
    if (fromRank.has(stops[i]!) && better(fromRank, i, board)) board = i;
  }
  if (board < 0) return undefined;
  let alight = -1;
  for (let i = board + 1; i <= lastTo; i++) {
    if (toRank.has(stops[i]!) && better(toRank, i, alight)) alight = i;
    if (alight >= 0 && !listed) break;
  }
  return [board, alight];
}

/** A departure from one stop, as a printed stop timetable lists it. */
export interface StopDeparture {
  pattern: number;
  dayTrip: number;
  time: number;
  /** Last stop of the trip. */
  terminus: number;
}

/**
 * Departures of a service day from `stop` on the given patterns (one
 * direction of a line), by time. Trips that only end at the stop are left
 * out: nobody can board them there.
 */
export function stopDepartures(
  net: Network,
  patterns: readonly number[],
  stop: number,
  date: string,
): StopDeparture[] {
  const day = net.timetable(date);
  const out: StopDeparture[] = [];
  for (const pattern of patterns) {
    const p = net.patterns[pattern]!;
    const pos = p.stops.indexOf(stop);
    if (pos < 0 || pos === p.stops.length - 1) continue;
    const dp = day.patterns[pattern]!;
    for (let j = 0; j < dp.start.length; j++) {
      if (!ownTrip(net, pattern, dp.start[j]!, dp.trip[j]!)) continue;
      out.push({
        pattern,
        dayTrip: j,
        time: net.departureAt(pattern, dp, j, pos),
        terminus: p.stops[p.stops.length - 1]!,
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
