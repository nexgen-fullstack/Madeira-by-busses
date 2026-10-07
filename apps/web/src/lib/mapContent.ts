import { GridIndex, hasView, haversine, offsetPolyline, pavementSides } from '@madeirabus/engine';
import type { Itinerary, LatLon, Network, StopGroup } from '@madeirabus/engine';
import type { Direction } from './lines.ts';
import { routeColor as colorOf } from './color.ts';

export interface MapLine {
  coords: LatLon[];
  /** Hex colour with '#'. */
  color: string;
  dashed?: boolean;
  width?: number;
  /** Written along the line: the number of the bus. */
  label?: string;
  /** Arrows along the line, the way the bus goes. */
  arrows?: boolean;
  /**
   * Beside the line running the other way on the same road: drawn a little
   * further apart from it while the map is too far away for the lanes to show.
   */
  side?: boolean;
  /** Shown when the line is tapped: what it is and when it runs. */
  note?: LineNote;
  /** The bus it is (route and pattern indices), for its card when tapped. */
  route?: number;
  pattern?: number;
  /** The stop it is boarded at on a route: its card shows the next buses from there. */
  board?: number;
}

export interface LineNote {
  title: string;
  lines: string[];
}

export type PointKind =
  'stop' | 'board' | 'alight' | 'transfer' | 'origin' | 'destination' | 'user' | 'bus';

export interface MapPoint extends LatLon {
  kind: PointKind;
  /** The ring round a stop; the dot of a bus. */
  color?: string;
  /** Inside the ring of a stop (white when not given). */
  fill?: string;
  label?: string;
  /** Stop indices this point represents (clicking opens its departures). */
  stops?: number[];
  /**
   * A bus left and the next boarded at one place (within a few metres): the two flags
   * stand a little apart, so both show and that it is one place.
   */
  pair?: boolean;
  /** Its name written to the side of its flag, away from the other's name at the same place. */
  apart?: boolean;
}

export interface MapContent {
  lines: MapLine[];
  points: MapPoint[];
  /** Change this to re-fit the camera. */
  fitKey?: string;
  fit?: LatLon[];
  /**
   * A route chosen to take, which the map shows alone: every other stop and line steps
   * aside. Different for each route.
   */
  focus?: string;
  /**
   * Places with a view shown on the map by their photos, where they are: the island as
   * the app opens. The first ones stay when they crowd each other far out.
   */
  scenic?: ScenicSpot[];
}

/** A place with a view on the map: its photo (or its region's colours) and its name. */
export interface ScenicSpot extends LatLon {
  id: string;
  name: string;
  /** The small photo's address; none yet: the colours of `region`. */
  photo?: string;
  region: string;
}

export const EMPTY_CONTENT: MapContent = { lines: [], points: [] };

/** The way chosen, in the neon yellow of the logo's pin: it stands out on any map. */
export const WAY_YELLOW = '#FFE600';
/** The way back, in neon turquoise. */
export const WAY_TURQUOISE = '#00E8D5';
/** The ring round the stops on those ways. */
const INK = '#14181F';
/**
 * Each bus of a route in a neon of its own, the first in the yellow of a chosen way:
 * where one bus ends and the next begins shows on the map.
 */
export const RIDE_COLORS = [WAY_YELLOW, '#FF3DF0', WAY_TURQUOISE, '#FF8A00', '#7CFF3A'];
export const rideColor = (ride: number) => RIDE_COLORS[ride % RIDE_COLORS.length]!;
/** The foot of the flags where a bus is boarded and left. */
export const FLAG_FOOT = INK;
/** How wide a bus of a route is drawn (px), the line it rides on the map. */
export const RIDE_WIDTH = 8;
/** How wide a line's main way is drawn on its page (px), and its other runs. */
export const WAY_WIDTH = 6.5;
export const RUN_WIDTH = 4.5;

/** A walk on the map, in navy; one with a view (along the sea), in the deep cyan of the logo's wave. */
export const WALK_INK = '#002F85';
export const VIEW_WALK = '#00838F';

/** A walk along the streets on their pavements, or as the crow flies without the streets. */
export function walkPath(leg: {
  from: LatLon;
  to: LatLon;
  path?: LatLon[];
  kerb?: number[];
}): LatLon[] {
  if (!leg.path) return [leg.from, leg.to];
  if (!leg.kerb || leg.kerb.length !== leg.path.length - 1) return leg.path;
  return offsetPolyline(leg.path, pavementSides(leg.path, leg.kerb));
}

const routeColor = (net: Network, route: number) => colorOf(net.routes[route]!);

/**
 * A route on the map, each of its buses in a neon of its own with arrows the way it goes,
 * a start flag where it is boarded and a chequered one where it is left, both on the bus's
 * side of the road, where the walks lead; `focus` brings one of its legs close up. A route
 * `chosen` to take is shown alone.
 */
export function itineraryContent(
  net: Network,
  it: Itinerary,
  focus?: number,
  chosen = false,
): MapContent {
  const lines: MapLine[] = [];
  const points: MapPoint[] = [];
  // Each bus in the centre of its lane, from where its stop meets the lane: where it is
  // boarded and left, not the pavement where the stop is mapped.
  const rides = it.legs.map((leg) =>
    leg.kind === 'ride' ? net.rideLane(leg.pattern, leg.boardPos, leg.alightPos) : undefined,
  );
  let ride = 0;
  it.legs.forEach((leg, i) => {
    if (leg.kind === 'walk') {
      // Along the pavements when the walking network is loaded, to the very spot of the bus.
      const from = rides[i - 1]?.at(-1);
      const to = rides[i + 1]?.[0];
      const path = walkPath(leg);
      lines.push({
        coords: [...(from ? [from] : []), ...path, ...(to ? [to] : [])],
        color: hasView(leg) ? VIEW_WALK : WALK_INK,
        dashed: true,
      });
      return;
    }
    const coords = rides[i]!;
    const start = coords[0] ?? leg.from;
    const end = coords.at(-1) ?? leg.to;
    lines.push({
      coords,
      color: rideColor(ride++),
      width: RIDE_WIDTH,
      label: net.routes[leg.route]!.short,
      arrows: true,
      route: leg.route,
      pattern: leg.pattern,
      board: leg.from.stop,
    });
    points.push({
      lat: start.lat,
      lon: start.lon,
      kind: 'board',
      color: '#ffffff',
      fill: FLAG_FOOT,
      label: leg.from.name,
      stops: [leg.from.stop!],
    });
    points.push({
      lat: end.lat,
      lon: end.lon,
      kind: 'alight',
      color: '#ffffff',
      fill: FLAG_FOOT,
      label: leg.to.name,
      stops: [leg.to.stop!],
    });
    for (const s of leg.stops.slice(1, -1)) {
      const st = net.stops[s.stop]!;
      points.push({ lat: st.lat, lon: st.lon, kind: 'stop', color: INK, stops: [s.stop] });
    }
  });
  pairFlags(points);
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  if (first?.kind === 'walk') points.push({ ...first.from, kind: 'origin', color: '#14181F' });
  // The yellow pin where the journey ends, as in a maps app (at the last stop when it ends there).
  // Not over the chequered flag when the journey ends at the stop: that flag says it.
  if (last?.kind === 'walk') {
    points.push({
      lat: last.to.lat,
      lon: last.to.lon,
      kind: 'destination',
      color: '#14181F',
      label: last.kind === 'walk' ? last.to.name || undefined : undefined,
    });
  }
  const leg = focus !== undefined ? lines[focus] : undefined;
  const key = `it:${it.key}:${it.depart}`;
  return {
    lines,
    points,
    fitKey: `${key}${leg ? `:${focus}` : ''}`,
    fit: leg ? leg.coords : lines.flatMap((l) => l.coords),
    ...(chosen ? { focus: key } : {}),
  };
}

/** A bus left this close to where the next is boarded is left and boarded at one place (m). */
const ONE_PLACE = 6;

/**
 * Where a bus is left and the next boarded at one place, the two flags stand a little
 * apart, and the stop's name is written once when it is the same stop.
 */
function pairFlags(points: MapPoint[]): void {
  for (const board of points) {
    if (board.kind !== 'board') continue;
    const alight = points.find(
      (p) => p.kind === 'alight' && p !== board && haversine(p, board) < ONE_PLACE,
    );
    if (!alight) continue;
    alight.pair = true;
    board.pair = true;
    if (alight.label === board.label) {
      board.label = undefined;
    } else {
      alight.apart = true;
      board.apart = true;
    }
  }
}

/** Where the trip starts and where it goes, before there is a route between them. */
export function placesContent(from?: MapPoint, to?: MapPoint): MapContent {
  const points: MapPoint[] = [];
  if (from) points.push({ ...from, kind: 'origin', color: '#14181F' });
  if (to) points.push({ ...to, kind: 'destination', color: '#14181F' });
  return {
    lines: [],
    points,
    fitKey: points.map((p) => `${p.kind}:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|'),
    fit: points,
  };
}

/** Closer than this (m) to a line already drawn, a variant runs along it. */
const ALONG = 25;
/** Shorter detours (m) are only the road wobbling. */
const DETOUR = 60;

/** A polyline with a point at least every `step` metres. */
function densify(coords: readonly LatLon[], step = 10): LatLon[] {
  const out: LatLon[] = [];
  coords.forEach((b, i) => {
    const a = coords[i - 1];
    if (a) {
      const n = Math.floor(haversine(a, b) / step);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push({ lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) });
      }
    }
    out.push(b);
  });
  return out;
}

/**
 * The stretches of `coords` away from every line of `drawn`: where a variant of a way
 * leaves its main road, e.g. a detour to Cabo Girão or a run by the Via Rápida.
 */
export function detours(coords: readonly LatLon[], drawn: readonly LatLon[][]): LatLon[][] {
  const index = new GridIndex(
    drawn.flatMap((d) => densify(d)),
    60,
  );
  const runs: LatLon[][] = [];
  let run: LatLon[] | undefined;
  let last: LatLon | undefined;
  for (const p of densify(coords)) {
    const near = index.within(p, ALONG).length > 0;
    if (!near) {
      // From where it leaves the line, so the detour hangs on it.
      run ??= last ? [last] : [];
      run.push(p);
    } else if (run) {
      run.push(p);
      runs.push(run);
      run = undefined;
    }
    last = p;
  }
  if (run) runs.push(run);
  return runs.filter((r) => r.slice(1).reduce((m, p, i) => m + haversine(r[i]!, p), 0) >= DETOUR);
}

/** Whether a variant has a bus on `date` (every variant when no date is given). */
const runsOn = (net: Network, pattern: number, date?: string) =>
  date === undefined ||
  net.patterns[pattern]!.trips.some(([service]) => net.isServiceActive(service, date));

/**
 * A line on the map, each way it runs on its side of the road with arrows the way the bus
 * goes: the `chosen` way in neon yellow, the way back (and any other) in neon turquoise,
 * and each stop in the colour of its way. Of the other variants of a way, those with a
 * bus on `date`, only where they leave its road are drawn, thinner and with arrows too;
 * tapped, they tell their `note`.
 */
export function routeContent(
  net: Network,
  directions: readonly Direction[],
  chosen: number,
  date?: string,
  note?: (direction: Direction, pattern: number) => LineNote,
): MapContent {
  const lines: MapLine[] = [];
  const points = new Map<number, MapPoint>();
  const way = directions[chosen];
  // The chosen way last, over the way back where the two share a stop.
  const ways = [...directions.filter((d) => d !== way), ...(way ? [way] : [])];
  for (const d of ways) {
    const color = d === way ? WAY_YELLOW : WAY_TURQUOISE;
    const drawn: LatLon[][] = [];
    // The main variant always, the line's road; the others on the day they run.
    d.patterns.forEach((p, i) => {
      if (i > 0 && !runsOn(net, p, date)) return;
      const shape = net.lane(p);
      const parts = i === 0 ? [shape] : detours(shape, drawn);
      drawn.push(...parts);
      const about = i > 0 ? note?.(d, p) : undefined;
      for (const coords of parts) {
        lines.push({
          coords,
          color,
          width: i === 0 ? WAY_WIDTH : RUN_WIDTH,
          arrows: true,
          side: true,
          route: net.patterns[p]!.route,
          pattern: p,
          ...(about ? { note: about } : {}),
        });
      }
      for (const s of net.patterns[p]!.stops) {
        const st = net.stops[s]!;
        points.delete(s);
        points.set(s, {
          lat: st.lat,
          lon: st.lon,
          kind: 'stop',
          color: INK,
          fill: color,
          label: st.name,
          stops: [s],
        });
      }
    });
  }
  // The same while the reader switches between the ways or days: the line is shown alone.
  const main = directions[0]?.patterns[0];
  const key = `route:${main === undefined ? '' : net.patterns[main]!.route}`;
  return {
    lines,
    points: [...points.values()],
    fitKey: key,
    fit: lines.flatMap((l) => l.coords),
    focus: key,
  };
}

/** Every line of the network along its roads (the stops are a map layer of their own). */
export function networkContent(net: Network): MapContent {
  const seen = new Set<number>();
  const lines: MapLine[] = [];
  net.patterns.forEach((p, i) => {
    if (seen.has(p.shape)) return;
    seen.add(p.shape);
    lines.push({
      coords: net.lane(i),
      color: routeColor(net, p.route),
      width: 2.5,
      route: p.route,
      pattern: i,
    });
  });
  return {
    lines,
    points: [],
    fitKey: 'network',
    fit: net.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
  };
}

export function stopsContent(groups: StopGroup[], user?: LatLon, fitKey = 'stops'): MapContent {
  const points: MapPoint[] = groups.map((g) => ({
    lat: g.lat,
    lon: g.lon,
    kind: 'stop',
    color: '#002F85',
    label: g.name,
    stops: g.stops,
  }));
  if (user) points.push({ ...user, kind: 'user' });
  return { lines: [], points, fitKey, fit: [...groups, ...(user ? [user] : [])] };
}

/** How close stops with the same name are to count as one place (both sides of a road, m). */
const SAME_STOP = 120;

/**
 * Every stop and line of the network as GeoJSON, for the "bus stops and
 * lines" layer. Each stop carries the stops of the same name around it, so a
 * tap shows the buses both ways.
 */
export function transitGeoJson(net: Network) {
  const seen = new Set<number>();
  const lines = net.patterns.flatMap((p, i) => {
    if (seen.has(p.shape)) return [];
    seen.add(p.shape);
    return [
      {
        type: 'Feature' as const,
        properties: { color: routeColor(net, p.route), route: p.route, pattern: i },
        geometry: {
          type: 'LineString' as const,
          coordinates: net.lane(i).map((c) => [c.lon, c.lat]),
        },
      },
    ];
  });
  const served = new Set(net.patterns.flatMap((p) => p.stops));
  const stops = net.stops.flatMap((s, i) => {
    if (!served.has(i)) return [];
    const same = net
      .nearbyStops(s, SAME_STOP)
      .filter((h) => net.stops[h.stop]!.name === s.name)
      .map((h) => h.stop)
      .sort((a, b) => a - b);
    return [
      {
        type: 'Feature' as const,
        properties: { label: s.name, stops: (same.length > 0 ? same : [i]).join(',') },
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      },
    ];
  });
  return {
    lines: { type: 'FeatureCollection' as const, features: lines },
    stops: { type: 'FeatureCollection' as const, features: stops },
  };
}
