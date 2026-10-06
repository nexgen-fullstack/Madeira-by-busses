import type { FareTable } from './fares.ts';
import { encodePolyline, haversine, type LatLon } from './geo.ts';
import type { GtfsAgency, GtfsFeed, GtfsRoute, GtfsStop, GtfsStopTime } from './gtfs.ts';
import { encodeSides } from './lanes.ts';
import { isMunicipalityCode, municipalityFromIne, nearestMunicipality } from './municipality.ts';
import { addDays, gtfsDateToIso, madeiraHolidays, weekday } from './time.ts';

/**
 * The network bundle is the compact, JSON-serialisable form of the merged
 * timetable that ships to phones. Trips are grouped into stop *patterns*
 * (same route, same stop sequence) and each trip stores only its start time
 * and a reference to a shared travel-time *profile*, which typically shrinks
 * stop_times by an order of magnitude.
 */
export interface NetworkBundle {
  format: 'madeirabus.network';
  version: 1;
  generatedAt: string;
  /** True when the timetable is synthetic demo data. */
  demo: boolean;
  /**
   * Set when the official timetable ended before today and the pipeline
   * carried its weekly pattern forward: the app must say so.
   */
  projected?: { officialUntil: string; until: string };
  /** Operators of the network that this bundle does not include yet. */
  missingOperators?: string[];
  /** Operators of which this bundle has some lines but not all yet. */
  partialOperators?: string[];
  sources: BundleSource[];
  validity: { from: string; to: string };
  agencies: BAgency[];
  stops: BStop[];
  routes: BRoute[];
  services: BService[];
  /** Google-encoded polylines. */
  shapes: string[];
  /**
   * For each shape, how far right of the road's middle each of its steps runs
   * (see `encodeSides`); empty or missing where it is not known.
   */
  shapeSides?: string[];
  patterns: BPattern[];
  fares: FareTable;
  stats: { stops: number; routes: number; patterns: number; trips: number };
  /** Named places to search for besides stops (airport, museums, villages…). */
  places?: BPlace[];
}

/** What a trip to a town or village goes to: its bus station, central stop, church, town hall or square. */
export type PlaceGoal = 'station' | 'stop' | 'church' | 'townhall' | 'square';

export interface BPlace {
  name: string;
  lat: number;
  lon: number;
  /** Category, e.g. "aerodrome", "museum", "village" (see the app's labels). */
  kind: string;
  /** Names in other languages, keyed by language code. */
  names?: Record<string, string>;
  /** A town or village: where a trip there goes, within its own bounds. */
  goal?: [lat: number, lon: number, via: PlaceGoal];
  /**
   * A town or village with nothing in it to go to: its bounds (encoded polylines), shown
   * for the pin to be put down by hand.
   */
  bounds?: string[];
}

export interface BundleSource {
  name: string;
  url?: string;
  fetchedAt?: string;
  feedVersion?: string;
}

export interface BAgency {
  id: string;
  name: string;
  url: string;
  phone?: string;
}

export interface BStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Municipality code (see municipality.ts). */
  muni: string;
  /** True when the municipality was inferred from the nearest seat. */
  muniGuessed?: boolean;
  /** Parent station id; stops sharing one transfer without walking. */
  station?: string;
  code?: string;
  /** Elevation in metres, when known (improves walking times). */
  ele?: number;
}

export interface BRoute {
  id: string;
  agency: number;
  /** The number on the bus. */
  short: string;
  /** The number the line had before a renumbering ("10A" for today's 110). */
  formerly?: string;
  long: string;
  /** Hex colour without '#'. */
  color: string;
  text: string;
  type: number;
  /** Airport express with its own fare. */
  aerobus?: boolean;
}

export interface BService {
  id: string;
  /** Bitmask, bit 0 = Monday … bit 6 = Sunday. */
  days: number;
  start: string;
  end: string;
  /** ISO dates added / removed by calendar_dates. */
  add: string[];
  rem: string[];
}

/** [service index, start (s after midnight), profile index, trip id] */
export type BTrip = [number, number, number, string];

export interface BPattern {
  route: number;
  headsign: string;
  stops: number[];
  /** Index into `shapes`. */
  shape: number;
  /** Each profile is [arr0, dep0, arr1, dep1, …] in seconds from the trip start. */
  profiles: number[][];
  /** Sorted by start; guaranteed not to overtake each other (FIFO). */
  trips: BTrip[];
}

export interface FeedInput {
  feed: GtfsFeed;
  source: BundleSource;
  /** Prefix for ids when merging several feeds. */
  prefix?: string;
}

export interface BuildOptions {
  demo: boolean;
  fares: FareTable;
  generatedAt?: string;
  /** Display name for a stop (e.g. to expand abbreviations); defaults to stop_name. */
  stopName?: (stop: GtfsStop) => string;
  /** Display name for a route; defaults to route_long_name. */
  routeName?: (route: GtfsRoute) => string;
  /** The number on the bus and the one it replaced; defaults to route_short_name. */
  routeNumber?: (route: GtfsRoute) => { short: string; formerly?: string };
  /** Display name for an operator; defaults to agency_name. */
  agencyName?: (agency: GtfsAgency) => string;
  /** Display text for a trip headsign; defaults to trip_headsign. */
  headsign?: (headsign: string) => string;
  /** Carry an expired weekly pattern forward up to this ISO date (see `projectServices`). */
  extendUntil?: string;
  missingOperators?: string[];
  partialOperators?: string[];
  /**
   * Stops of later feeds with the id of an earlier feed's stop, at the same
   * place (within 30 m), become that stop: SIGA's stop codes are Horários do
   * Funchal's stop ids, and a pole served by both operators is one stop.
   */
  shareStops?: boolean;
  /**
   * The way between a trip's stops when its feed has no shape (shapes.txt),
   * e.g. along the roads; straight lines between the stops when it gives none.
   */
  routeShape?: (stops: readonly LatLon[]) => SidedShape | undefined;
  /** A feed's own shape put on the roads it follows; undefined to keep it as it is. */
  matchShape?: (shape: readonly LatLon[]) => SidedShape | undefined;
}

/** A shape with, for each step, how far right of the road's middle it runs (m). */
export interface SidedShape {
  points: LatLon[];
  sides: number[];
}

/** How far apart two feeds' stops with one id may be and still be the same stop (m). */
const SHARED_STOP_RADIUS = 30;

export interface BuildReport {
  warnings: string[];
  /** Services whose weekly pattern was carried past the feed's end. */
  projectedServices: number;
  guessedMunicipalities: number;
  interpolatedTimes: number;
  expandedFrequencyTrips: number;
  splitPatterns: number;
}

const DEFAULT_COLORS = ['1565C0', 'C62828', '2E7D32', 'EF6C00', '6A1B9A', '00838F', 'AD1457'];

export function buildBundle(
  inputs: readonly FeedInput[],
  options: BuildOptions,
): { bundle: NetworkBundle; report: BuildReport } {
  const report: BuildReport = {
    warnings: [],
    projectedServices: 0,
    guessedMunicipalities: 0,
    interpolatedTimes: 0,
    expandedFrequencyTrips: 0,
    splitPatterns: 0,
  };
  const agencies: BAgency[] = [];
  const stops: BStop[] = [];
  const routes: BRoute[] = [];
  const services: BService[] = [];
  const shapes: string[] = [];
  const shapeSides: string[] = [];
  const patterns: BPattern[] = [];
  const sources: BundleSource[] = [];

  /** Stops of earlier feeds by their own (unprefixed) id, for `shareStops`. */
  const byRawId = new Map<string, number>();
  /** Shapes made for stop sequences without one, by the sequence. */
  const madeShapes = new Map<string, number>();

  /** The feed each service comes from: each feed's timetable ends on its own day. */
  const serviceFeed: number[] = [];

  for (const [feedIndex, { feed, source, prefix = '' }] of inputs.entries()) {
    sources.push({ ...source, feedVersion: source.feedVersion ?? feed.feedInfo?.feed_version });
    const id = (v: string) => `${prefix}${v}`;

    // Agencies
    const agencyIndex = new Map<string, number>();
    for (const a of feed.agencies) {
      agencyIndex.set(a.agency_id, agencies.length);
      agencies.push({
        id: id(a.agency_id || a.agency_name),
        name: options.agencyName ? options.agencyName(a) : a.agency_name,
        url: a.agency_url,
        phone: a.agency_phone,
      });
    }
    const defaultAgency =
      feed.agencies.length === 1 ? agencyIndex.get(feed.agencies[0]!.agency_id) : undefined;

    // Stops (only boarding points; stations are kept as grouping keys)
    const usedStops = new Set(feed.stopTimes.map((st) => st.stop_id));
    const stopIndex = new Map<string, number>();
    for (const s of feed.stops) {
      if (s.location_type !== 0 && !usedStops.has(s.stop_id)) continue;
      if (!Number.isFinite(s.stop_lat) || !Number.isFinite(s.stop_lon)) {
        report.warnings.push(`Stop ${s.stop_id} has no coordinates; skipped`);
        continue;
      }
      const shared = options.shareStops ? byRawId.get(s.stop_id) : undefined;
      if (
        shared !== undefined &&
        haversine(stops[shared]!, { lat: s.stop_lat, lon: s.stop_lon }) <= SHARED_STOP_RADIUS
      ) {
        stopIndex.set(s.stop_id, shared);
        continue;
      }
      const tagged = isMunicipalityCode(s.zone_id)
        ? (s.zone_id!.toUpperCase() as string)
        : municipalityFromIne(s.municipality);
      if (!tagged) report.guessedMunicipalities++;
      stopIndex.set(s.stop_id, stops.length);
      if (!byRawId.has(s.stop_id)) byRawId.set(s.stop_id, stops.length);
      stops.push({
        id: id(s.stop_id),
        name: options.stopName ? options.stopName(s) : s.stop_name,
        lat: round6(s.stop_lat),
        lon: round6(s.stop_lon),
        muni: tagged ?? nearestMunicipality({ lat: s.stop_lat, lon: s.stop_lon }),
        ...(tagged ? {} : { muniGuessed: true }),
        ...(s.parent_station ? { station: id(s.parent_station) } : {}),
        ...(s.stop_code ? { code: s.stop_code } : {}),
        ...(s.elevation !== undefined ? { ele: s.elevation } : {}),
      });
    }

    // Routes
    const routeIndex = new Map<string, number>();
    for (const r of feed.routes) {
      const agency = r.agency_id !== undefined ? agencyIndex.get(r.agency_id) : defaultAgency;
      if (agency === undefined) {
        report.warnings.push(
          `Route ${r.route_id} has unknown agency ${r.agency_id ?? '(none)'}; skipped`,
        );
        continue;
      }
      routeIndex.set(r.route_id, routes.length);
      const agencyName = agencies[agency]!.name;
      const number = options.routeNumber?.(r) ?? { short: r.route_short_name };
      routes.push({
        id: id(r.route_id),
        agency,
        short: number.short,
        ...(number.formerly ? { formerly: number.formerly } : {}),
        long: options.routeName ? options.routeName(r) : r.route_long_name,
        color:
          normaliseColor(r.route_color) ?? DEFAULT_COLORS[routes.length % DEFAULT_COLORS.length]!,
        text: normaliseColor(r.route_text_color) ?? 'FFFFFF',
        type: r.route_type,
        ...(/aerobus/i.test(`${agencyName} ${r.route_short_name} ${r.route_long_name}`)
          ? { aerobus: true }
          : {}),
      });
    }

    // Services
    const serviceIndex = new Map<string, number>();
    const serviceOf = (sid: string) => {
      let i = serviceIndex.get(sid);
      if (i === undefined) {
        i = services.length;
        serviceIndex.set(sid, i);
        serviceFeed.push(feedIndex);
        services.push({
          id: id(sid),
          days: 0,
          start: '9999-12-31',
          end: '0000-01-01',
          add: [],
          rem: [],
        });
      }
      return services[i]!;
    };
    for (const c of feed.calendars) {
      const s = serviceOf(c.service_id);
      s.days = c.days.reduce((mask, on, d) => (on ? mask | (1 << d) : mask), 0);
      s.start = gtfsDateToIso(c.start_date);
      s.end = gtfsDateToIso(c.end_date);
    }
    for (const cd of feed.calendarDates) {
      const s = serviceOf(cd.service_id);
      const date = gtfsDateToIso(cd.date);
      (cd.exception_type === 1 ? s.add : s.rem).push(date);
      if (s.days === 0 && cd.exception_type === 1) {
        if (date < s.start) s.start = date;
        if (date > s.end) s.end = date;
      }
    }
    for (const s of services) {
      s.add.sort();
      s.rem.sort();
    }

    // Shapes from shapes.txt
    const shapePoints = new Map<string, { lat: number; lon: number; sequence: number }[]>();
    for (const p of feed.shapes) {
      const list = shapePoints.get(p.shape_id);
      if (list) list.push(p);
      else shapePoints.set(p.shape_id, [p]);
    }
    const shapeIndex = new Map<string, number>();
    const shapeFor = (shapeId: string | undefined, stopSeq: number[]): number => {
      if (shapeId && shapePoints.has(shapeId)) {
        let i = shapeIndex.get(shapeId);
        if (i === undefined) {
          const pts = shapePoints.get(shapeId)!.sort((a, b) => a.sequence - b.sequence);
          i = shapes.length;
          const onRoads = options.matchShape?.(pts);
          shapes.push(encodePolyline(onRoads?.points ?? pts));
          shapeSides.push(onRoads ? encodeSides(onRoads.sides) : '');
          shapeIndex.set(shapeId, i);
        }
        return i;
      }
      // No shape: along the roads when known, else straight lines between the stops.
      const key = stopSeq.join(',');
      let made = madeShapes.get(key);
      if (made === undefined) {
        const points = stopSeq.map((s) => stops[s]!);
        made = shapes.length;
        const routed = options.routeShape?.(points);
        shapes.push(encodePolyline(routed?.points ?? points));
        shapeSides.push(routed ? encodeSides(routed.sides) : '');
        madeShapes.set(key, made);
      }
      return made;
    };

    // Trips → patterns
    const stopTimesByTrip = new Map<string, GtfsStopTime[]>();
    for (const st of feed.stopTimes) {
      const list = stopTimesByTrip.get(st.trip_id);
      if (list) list.push(st);
      else stopTimesByTrip.set(st.trip_id, [st]);
    }
    const frequenciesByTrip = new Map<string, typeof feed.frequencies>();
    for (const f of feed.frequencies) {
      const list = frequenciesByTrip.get(f.trip_id);
      if (list) list.push(f);
      else frequenciesByTrip.set(f.trip_id, [f]);
    }

    interface RawTrip {
      id: string;
      service: number;
      times: number[]; // absolute [arr0, dep0, …]
      headsign: string;
      shapeId?: string;
    }
    const groups = new Map<string, { route: number; stops: number[]; trips: RawTrip[] }>();

    for (const trip of feed.trips) {
      const route = routeIndex.get(trip.route_id);
      if (route === undefined) continue;
      const sts = (stopTimesByTrip.get(trip.trip_id) ?? []).sort(
        (a, b) => a.stop_sequence - b.stop_sequence,
      );
      const seq: number[] = [];
      const points: LatLon[] = [];
      const known: (number | undefined)[][] = [];
      let skip = false;
      for (const st of sts) {
        const si = stopIndex.get(st.stop_id);
        if (si === undefined) {
          skip = true;
          break;
        }
        seq.push(si);
        points.push(stops[si]!);
        known.push([st.arrival_time ?? st.departure_time, st.departure_time ?? st.arrival_time]);
      }
      if (skip || seq.length < 2) {
        report.warnings.push(`Trip ${trip.trip_id} has fewer than 2 valid stops; skipped`);
        continue;
      }
      const times = interpolateTimes(points, known, report);
      if (!times) {
        report.warnings.push(`Trip ${trip.trip_id} has no usable times; skipped`);
        continue;
      }
      const service = serviceIndex.get(trip.service_id);
      if (service === undefined) {
        report.warnings.push(
          `Trip ${trip.trip_id} references unknown service ${trip.service_id}; skipped`,
        );
        continue;
      }
      const key = `${route}|${seq.join(',')}`;
      let group = groups.get(key);
      if (!group) {
        group = { route, stops: seq, trips: [] };
        groups.set(key, group);
      }
      const headsign = trip.trip_headsign
        ? (options.headsign?.(trip.trip_headsign) ?? trip.trip_headsign)
        : stops[seq[seq.length - 1]!]!.name;
      const freqs = frequenciesByTrip.get(trip.trip_id);
      if (freqs) {
        const base = times[1]!;
        for (const f of freqs) {
          for (let t = f.start_time; t < f.end_time; t += f.headway_secs) {
            group.trips.push({
              id: `${id(trip.trip_id)}@${t}`,
              service,
              times: times.map((x) => x - base + t),
              headsign,
              shapeId: trip.shape_id,
            });
            report.expandedFrequencyTrips++;
          }
        }
      } else {
        group.trips.push({
          id: id(trip.trip_id),
          service,
          times,
          headsign,
          shapeId: trip.shape_id,
        });
      }
    }

    for (const group of groups.values()) {
      group.trips.sort((a, b) => a.times[1]! - b.times[1]!);
      // Split into FIFO sub-patterns so binary search over trips stays valid.
      const subs: RawTrip[][] = [];
      for (const t of group.trips) {
        const target = subs.find((sub) => !overtakes(sub[sub.length - 1]!.times, t.times));
        if (target) target.push(t);
        else subs.push([t]);
      }
      if (subs.length > 1) report.splitPatterns += subs.length - 1;

      for (const sub of subs) {
        const profileKeys = new Map<string, number>();
        const profiles: number[][] = [];
        const trips: BTrip[] = sub.map((t) => {
          const start = t.times[1]!;
          const profile = t.times.map((x) => x - start);
          const k = profile.join(',');
          let pi = profileKeys.get(k);
          if (pi === undefined) {
            pi = profiles.length;
            profiles.push(profile);
            profileKeys.set(k, pi);
          }
          return [t.service, start, pi, t.id];
        });
        patterns.push({
          route: group.route,
          headsign: mostCommon(sub.map((t) => t.headsign)),
          stops: group.stops,
          shape: shapeFor(mostCommon(sub.map((t) => t.shapeId ?? '')) || undefined, group.stops),
          profiles,
          trips,
        });
      }
    }
  }

  // Each feed whose timetable ends too early is carried forward on its own (Horários do
  // Funchal's may end in November while the other operators' go on into the next year).
  let projection: { officialUntil: string; services: number } | undefined;
  if (options.extendUntil) {
    const byFeed = new Map<number, BService[]>();
    services.forEach((s, i) =>
      byFeed.set(serviceFeed[i]!, [...(byFeed.get(serviceFeed[i]!) ?? []), s]),
    );
    for (const group of byFeed.values()) {
      const p = projectServices(group, options.extendUntil);
      if (!p) continue;
      projection = {
        officialUntil:
          projection && projection.officialUntil < p.officialUntil
            ? projection.officialUntil
            : p.officialUntil,
        services: (projection?.services ?? 0) + p.services,
      };
    }
  }
  if (projection) report.projectedServices = projection.services;

  const usedServices = services.filter((s) => s.days !== 0 || s.add.length > 0);
  const validity = {
    from: usedServices.reduce((m, s) => (s.start < m ? s.start : m), '9999-12-31'),
    to: usedServices.reduce((m, s) => (s.end > m ? s.end : m), '0000-01-01'),
  };

  const bundle: NetworkBundle = {
    format: 'madeirabus.network',
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    demo: options.demo,
    ...(projection
      ? { projected: { officialUntil: projection.officialUntil, until: options.extendUntil! } }
      : {}),
    ...(options.missingOperators?.length ? { missingOperators: options.missingOperators } : {}),
    ...(options.partialOperators?.length ? { partialOperators: options.partialOperators } : {}),
    sources,
    validity,
    agencies,
    stops,
    routes,
    services,
    shapes,
    ...(shapeSides.some(Boolean) && { shapeSides }),
    patterns,
    fares: options.fares,
    stats: {
      stops: stops.length,
      routes: routes.length,
      patterns: patterns.length,
      trips: patterns.reduce((n, p) => n + p.trips.length, 0),
    },
  };
  return { bundle, report };
}

/**
 * Carries an expired timetable forward. Operators sometimes publish the next
 * timetable late; rather than showing nothing, we repeat each service's
 * weekly pattern after the feed's last day: a service keeps running on the
 * weekdays it ran on in the last eight weeks, and Madeira's public holidays
 * use whichever service ran on holidays (otherwise the Sunday one). The
 * bundle records the official end date so the app can say so.
 */
export function projectServices(
  services: BService[],
  until: string,
): { officialUntil: string; services: number } | undefined {
  const lastOf = (s: BService) => {
    const lastAdd = s.add[s.add.length - 1];
    if (s.days === 0) return lastAdd;
    return lastAdd && lastAdd > s.end ? lastAdd : s.end;
  };
  const officialUntil = services.map(lastOf).filter(Boolean).sort().pop();
  if (!officialUntil || officialUntil >= until) return undefined;

  const windowStart = addDays(officialUntil, -55);
  const years = new Set([windowStart.slice(0, 4), officialUntil.slice(0, 4), until.slice(0, 4)]);
  const holidays = new Set(
    [...years].flatMap((y) => madeiraHolidays(Number(y)).map((h) => h.date)),
  );
  const isActive = (s: BService, d: string) =>
    !s.rem.includes(d) &&
    (s.add.includes(d) || (d >= s.start && d <= s.end && (s.days & (1 << weekday(d))) !== 0));

  // Observed behaviour in the last eight weeks of the feed.
  const days: string[] = [];
  for (let d = windowStart; d <= officialUntil; d = addDays(d, 1)) days.push(d);
  const holidayDays = days.filter((d) => holidays.has(d));
  const plainDays = days.filter((d) => !holidays.has(d));

  let projected = 0;
  const holidayRunners: BService[] = [];
  const masks = services.map((s) => {
    let mask = 0;
    for (let wd = 0; wd < 7; wd++) {
      const sample = plainDays.filter((d) => weekday(d) === wd);
      const active = sample.filter((d) => isActive(s, d)).length;
      if (sample.length > 0 && active / sample.length >= 0.5) mask |= 1 << wd;
    }
    if (
      holidayDays.length > 0 &&
      holidayDays.filter((d) => isActive(s, d)).length / holidayDays.length >= 0.5
    ) {
      holidayRunners.push(s);
    }
    return mask;
  });
  // Without holidays in the window, the Sunday-only services run on holidays.
  const runsOnHolidays = (s: BService, mask: number) =>
    holidayDays.length > 0 ? holidayRunners.includes(s) : mask === 1 << 6;

  services.forEach((s, i) => {
    const mask = masks[i]!;
    const onHolidays = runsOnHolidays(s, mask);
    if (mask === 0 && !onHolidays) return;
    const from = addDays(officialUntil, 1);
    // Keep the official dates as explicit additions, then add the projected range.
    if (s.days !== 0) {
      for (let d = s.start; d <= s.end && d <= officialUntil; d = addDays(d, 1)) {
        if (isActive(s, d) && !s.add.includes(d)) s.add.push(d);
      }
    }
    s.add = s.add.filter((d) => d <= officialUntil);
    s.rem = s.rem.filter((d) => d <= officialUntil);
    s.days = mask;
    s.start = from;
    s.end = until;
    for (const h of holidays) {
      if (h < from || h > until) continue;
      if (onHolidays) s.add.push(h);
      else if (mask & (1 << weekday(h))) s.rem.push(h);
    }
    s.add.sort();
    s.rem.sort();
    projected++;
  });
  return { officialUntil, services: projected };
}

/** Fills missing times (non-timepoints) by distance between timed stops. */
function interpolateTimes(
  points: LatLon[],
  known: (number | undefined)[][],
  report: BuildReport,
): number[] | undefined {
  const n = points.length;
  const arr = known.map((k) => k[0]);
  const dep = known.map((k) => k[1]);
  if (dep[0] === undefined || arr[n - 1] === undefined) return undefined;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + haversine(points[i - 1]!, points[i]!));
  let last = 0;
  for (let i = 1; i < n; i++) {
    if (arr[i] !== undefined) {
      for (let j = last + 1; j < i; j++) {
        const span = cum[i]! - cum[last]!;
        const f = span === 0 ? (j - last) / (i - last) : (cum[j]! - cum[last]!) / span;
        const t = Math.round(dep[last]! + f * (arr[i]! - dep[last]!));
        arr[j] = t;
        dep[j] = t;
        report.interpolatedTimes++;
      }
      last = i;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(arr[i]!, Math.max(arr[i]!, dep[i]!));
  return out;
}

/** True if trip b (starting no earlier than a) is ever ahead of a. */
function overtakes(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (b[i]! < a[i]!) return true;
  return false;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  let best = values[0] ?? '';
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

function normaliseColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hex = value.replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : undefined;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
