import type { BPattern, BPlace, BRoute, BStop, NetworkBundle } from './bundle.ts';
import {
  cumulativeDistances,
  decodePolyline,
  GridIndex,
  projectOnPolyline,
  slicePolyline,
  walkSeconds,
  type LatLon,
} from './geo.ts';
import { addDays, DAY, weekday } from './time.ts';

export interface Footpath {
  to: number;
  /** Walking time at the network's reference speed. */
  seconds: number;
  distance: number;
}

/** Trips of one pattern that run on a given day, sorted by start (FIFO). */
export interface DayPattern {
  /** Start time relative to the query day's midnight (previous-day trips are shifted by -24h). */
  start: number[];
  profile: number[];
  /** Index into `BPattern.trips`. */
  trip: number[];
}

export interface DayTimetable {
  date: string;
  patterns: DayPattern[];
}

export interface Departure {
  pattern: number;
  route: number;
  headsign: string;
  /** Index in the day timetable of the pattern. */
  dayTrip: number;
  tripId: string;
  time: number;
  /** True when no later trip of this pattern leaves this stop today. */
  last: boolean;
}

export interface StopGroup {
  /** Display name. */
  name: string;
  muni: string;
  stops: number[];
  lat: number;
  lon: number;
}

export type SearchHit = { kind: 'stop'; group: StopGroup } | { kind: 'place'; place: BPlace };

export interface NetworkOptions {
  /** Reference walking speed for footpaths (m/s). */
  walkSpeed?: number;
  /** Maximum walking distance for a transfer between stops (m). */
  transferRadius?: number;
}

export const DEFAULT_WALK_SPEED = 1.25;

/** Runtime view of a bundle with the indexes the planner needs. */
export class Network {
  readonly stops: readonly BStop[];
  readonly routes: readonly BRoute[];
  readonly patterns: readonly BPattern[];
  /** For each stop, the patterns serving it and the stop's position in them. */
  readonly stopPatterns: { pattern: number; pos: number }[][];
  readonly footpaths: Footpath[][];
  readonly grid: GridIndex;
  readonly walkSpeed: number;
  private readonly shapeCache = new Map<number, LatLon[]>();
  private readonly alongCache = new Map<number, { cum: number[]; stops: number[] }>();
  private readonly dayCache = new Map<string, DayTimetable>();
  private readonly searchIndex: { key: string; words: string[]; group: StopGroup }[];
  private readonly placeIndex: { keys: { key: string; words: string[] }[]; place: BPlace }[];

  constructor(
    readonly bundle: NetworkBundle,
    options: NetworkOptions = {},
  ) {
    if (bundle.format !== 'madeirabus.network' || bundle.version !== 1) {
      throw new Error('Unsupported network bundle format');
    }
    this.stops = bundle.stops;
    this.routes = bundle.routes;
    this.patterns = bundle.patterns;
    this.walkSpeed = options.walkSpeed ?? DEFAULT_WALK_SPEED;
    this.grid = new GridIndex(this.stops);

    this.stopPatterns = this.stops.map(() => []);
    this.patterns.forEach((p, pattern) =>
      p.stops.forEach((s, pos) => this.stopPatterns[s]!.push({ pattern, pos })),
    );

    const radius = options.transferRadius ?? 400;
    this.footpaths = this.stops.map((s, i) => {
      const out: Footpath[] = [];
      for (const hit of this.grid.within(s, radius)) {
        if (hit.index === i) continue;
        const t = this.stops[hit.index]!;
        // At least 30 s even across the street; keeps walk chains strictly increasing.
        const seconds = Math.max(30, walkSeconds(hit.distance, this.walkSpeed, s.ele, t.ele));
        out.push({ to: hit.index, seconds, distance: Math.round(hit.distance) });
      }
      return out;
    });

    this.searchIndex = buildSearchIndex(this.stops);
    this.placeIndex = (bundle.places ?? []).map((place) => ({
      place,
      keys: [...new Set([place.name, ...Object.values(place.names ?? {})])].map((n) => {
        const key = normalise(n);
        return { key, words: significantWords(key) };
      }),
    }));
  }

  shape(pattern: number): LatLon[] {
    const shapeIdx = this.patterns[pattern]!.shape;
    let pts = this.shapeCache.get(shapeIdx);
    if (!pts) {
      pts = decodePolyline(this.bundle.shapes[shapeIdx] ?? '');
      this.shapeCache.set(shapeIdx, pts);
    }
    return pts;
  }

  /** Distance along the pattern's shape of each of its stops (monotonic). */
  stopPositions(pattern: number): { cum: number[]; stops: number[] } {
    let cached = this.alongCache.get(pattern);
    if (!cached) {
      const shape = this.shape(pattern);
      const cum = cumulativeDistances(shape);
      const stops: number[] = [];
      let from = 0;
      for (const s of this.patterns[pattern]!.stops) {
        const pr = projectOnPolyline(shape, cum, this.stops[s]!, from);
        stops.push(Math.max(pr.along, stops[stops.length - 1] ?? 0));
        from = pr.segment;
      }
      cached = { cum, stops };
      this.alongCache.set(pattern, cached);
    }
    return cached;
  }

  /** Shape of a ride from one stop of a pattern to another. */
  rideShape(pattern: number, boardPos: number, alightPos: number): LatLon[] {
    const { cum, stops } = this.stopPositions(pattern);
    return slicePolyline(this.shape(pattern), cum, stops[boardPos]!, stops[alightPos]!);
  }

  isServiceActive(service: number, date: string): boolean {
    const s = this.bundle.services[service]!;
    if (s.rem.includes(date)) return false;
    if (s.add.includes(date)) return true;
    if (date < s.start || date > s.end) return false;
    return (s.days & (1 << weekday(date))) !== 0;
  }

  /** Active trips per pattern for a service day, including late trips of the previous day. */
  timetable(date: string): DayTimetable {
    const cached = this.dayCache.get(date);
    if (cached) return cached;
    const prev = addDays(date, -1);
    const activeToday = this.bundle.services.map((_, i) => this.isServiceActive(i, date));
    const activeYesterday = this.bundle.services.map((_, i) => this.isServiceActive(i, prev));

    const patterns = this.patterns.map<DayPattern>((p) => {
      const rows: [number, number, number][] = [];
      p.trips.forEach(([service, start, profile], trip) => {
        if (activeToday[service]) rows.push([start, profile, trip]);
        if (activeYesterday[service]) {
          const prof = p.profiles[profile]!;
          if (start + prof[prof.length - 2]! >= DAY) rows.push([start - DAY, profile, trip]);
        }
      });
      rows.sort((a, b) => a[0] - b[0]);
      return {
        start: rows.map((r) => r[0]),
        profile: rows.map((r) => r[1]),
        trip: rows.map((r) => r[2]),
      };
    });

    const table = { date, patterns };
    this.dayCache.set(date, table);
    if (this.dayCache.size > 4) this.dayCache.delete(this.dayCache.keys().next().value!);
    return table;
  }

  /** Departure at position `pos` of trip `j` of a day pattern. */
  departureAt(pattern: number, day: DayPattern, j: number, pos: number): number {
    return day.start[j]! + this.patterns[pattern]!.profiles[day.profile[j]!]![2 * pos + 1]!;
  }

  arrivalAt(pattern: number, day: DayPattern, j: number, pos: number): number {
    return day.start[j]! + this.patterns[pattern]!.profiles[day.profile[j]!]![2 * pos]!;
  }

  /** First trip index in [0, hi) departing `pos` at or after `time`, or -1. */
  earliestTrip(
    pattern: number,
    day: DayPattern,
    pos: number,
    time: number,
    hi = day.start.length,
  ): number {
    let lo = 0;
    let h = hi;
    while (lo < h) {
      const mid = (lo + h) >> 1;
      if (this.departureAt(pattern, day, mid, pos) < time) lo = mid + 1;
      else h = mid;
    }
    return lo < hi ? lo : -1;
  }

  nearbyStops(p: LatLon, radius: number): { stop: number; distance: number }[] {
    return this.grid.within(p, radius).map((h) => ({ stop: h.index, distance: h.distance }));
  }

  /** Next departures from any of the given stops, merged and sorted. */
  departures(stops: readonly number[], date: string, time: number, limit = 12): Departure[] {
    const day = this.timetable(date);
    const out: Departure[] = [];
    for (const stop of stops) {
      for (const { pattern, pos } of this.stopPatterns[stop]!) {
        const p = this.patterns[pattern]!;
        if (pos === p.stops.length - 1) continue; // no boarding at the terminus
        const dp = day.patterns[pattern]!;
        const n = dp.start.length;
        let j = this.earliestTrip(pattern, dp, pos, time);
        if (j < 0) continue;
        for (let c = 0; j < n && c < limit; j++, c++) {
          out.push({
            pattern,
            route: p.route,
            headsign: p.headsign,
            dayTrip: j,
            tripId: p.trips[dp.trip[j]!]![3],
            time: this.departureAt(pattern, dp, j, pos),
            last: j === n - 1,
          });
        }
      }
    }
    return out.sort((a, b) => a.time - b.time).slice(0, limit);
  }

  /** Stop-by-stop times of one trip of a day pattern. */
  tripStops(
    pattern: number,
    date: string,
    dayTrip: number,
  ): { stop: number; arr: number; dep: number }[] {
    const dp = this.timetable(date).patterns[pattern]!;
    return this.patterns[pattern]!.stops.map((stop, pos) => ({
      stop,
      arr: this.arrivalAt(pattern, dp, dayTrip, pos),
      dep: this.departureAt(pattern, dp, dayTrip, pos),
    }));
  }

  /**
   * Accent-insensitive search over stop names, grouped by name and
   * municipality. A name matches when it contains the query, or when every
   * query word starts a word of the name in any order, ignoring linking words
   * ("Curral das Freiras" finds "Igreja Curral Freiras").
   */
  searchStops(query: string, limit = 8): StopGroup[] {
    return this.scored(
      query,
      this.searchIndex,
      (e) => [e],
      (e) => e.group,
    )
      .slice(0, limit)
      .map((s) => s.value);
  }

  /** Same matching over named places, in any of their languages. */
  searchPlaces(query: string, limit = 8): BPlace[] {
    return this.scored(
      query,
      this.placeIndex,
      (e) => e.keys,
      (e) => e.place,
    )
      .slice(0, limit)
      .map((s) => s.value);
  }

  /** Stops and places together, best match first. */
  search(query: string, limit = 8): SearchHit[] {
    const stops = this.scored(
      query,
      this.searchIndex,
      (e) => [e],
      (e) => e.group,
    );
    const places = this.scored(
      query,
      this.placeIndex,
      (e) => e.keys,
      (e) => e.place,
    );
    return [
      ...stops.map((s) => ({ score: s.score, hit: { kind: 'stop', group: s.value } as const })),
      ...places.map((s) => ({ score: s.score, hit: { kind: 'place', place: s.value } as const })),
    ]
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((s) => s.hit);
  }

  private scored<E, T>(
    query: string,
    entries: readonly E[],
    keysOf: (e: E) => readonly { key: string; words: string[] }[],
    valueOf: (e: E) => T,
  ): { score: number; value: T }[] {
    const q = normalise(query);
    if (!q) return [];
    const words = significantWords(q);
    const scored: { score: number; value: T }[] = [];
    for (const entry of entries) {
      let best = Infinity;
      for (const k of keysOf(entry)) best = Math.min(best, matchScore(q, words, k));
      if (best < Infinity) scored.push({ score: best, value: valueOf(entry) });
    }
    return scored.sort((a, b) => a.score - b.score);
  }

  /** All stop groups (for browsing). */
  stopGroups(): StopGroup[] {
    return this.searchIndex.map((e) => e.group);
  }
}

/** Portuguese linking words that stop names often leave out. */
const LINKING_WORDS = new Set(['a', 'as', 'o', 'os', 'da', 'das', 'de', 'do', 'dos', 'e']);

/**
 * Lower is better: the name starts with the query, contains it at a word
 * start, has every query word as a word prefix, or merely contains it.
 */
function matchScore(q: string, words: string[], k: { key: string; words: string[] }): number {
  const idx = k.key.indexOf(q);
  let tier: number;
  if (idx === 0) tier = 0;
  else if (idx > 0 && k.key[idx - 1] === ' ') tier = 1;
  else if (words.length > 0 && words.every((w) => k.words.some((kw) => kw.startsWith(w)))) tier = 2;
  else if (idx > 0) tier = 3;
  else return Infinity;
  return tier * 1000 + k.key.length;
}

function significantWords(normalised: string): string[] {
  return normalised.split(' ').filter((w) => w && !LINKING_WORDS.has(w));
}

export function normalise(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Any script: places carry Cyrillic, Polish and Czech names too.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

function buildSearchIndex(
  stops: readonly BStop[],
): { key: string; words: string[]; group: StopGroup }[] {
  const groups = new Map<string, StopGroup>();
  stops.forEach((s, i) => {
    const key = `${normalise(s.name)}|${s.muni}`;
    const g = groups.get(key);
    if (g) {
      g.stops.push(i);
      g.lat += (s.lat - g.lat) / g.stops.length;
      g.lon += (s.lon - g.lon) / g.stops.length;
    } else {
      groups.set(key, { name: s.name, muni: s.muni, stops: [i], lat: s.lat, lon: s.lon });
    }
  });
  return [...groups.values()]
    .map((group) => {
      const key = normalise(group.name);
      return { key, words: significantWords(key), group };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
