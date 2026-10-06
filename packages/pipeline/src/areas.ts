import {
  decodePolyline,
  encodePolyline,
  haversine,
  isBusStation,
  Network,
  normalise,
  type BPlace,
  type LatLon,
  type NetworkBundle,
  type PlaceGoal,
} from '@madeirabus/engine';
import type { OsmElement } from './places.ts';
import { simplify } from './walk.ts';

/**
 * Where a trip to a town or village goes. Its pin used to go to the bus station
 * nearest it, if one was within 1.5 km: Tabua's went to Ribeira Brava's, in the next
 * town. Now, within the town's or village's own bounds (OpenStreetMap's parish or
 * place area): its bus station; else its central stop, the one with most buses near
 * its middle; else its church, its town hall or its square; else nothing, and the app
 * shows its bounds for the pin to be put down by hand.
 */

/** An Overpass element with its geometry (`out geom`). */
export interface OsmShape extends OsmElement {
  geometry?: LatLon[];
  members?: { type: string; ref: number; role: string; geometry?: LatLon[] }[];
}

/** A parish, a municipality, or a town or village mapped as an area. */
export interface Area {
  name: string;
  /** OSM admin_level: 7 a municipality, 8 a parish. */
  level?: number;
  /** OSM place, for a town or village mapped as an area. */
  place?: string;
  rings: LatLon[][];
  holes: LatLon[][];
}

/** A place at a town's middle: its church, town hall or square. */
export interface Anchor {
  name: string;
  kind: 'church' | 'townhall' | 'square';
  lat: number;
  lon: number;
}

/** data/sources/osm/areas.json: the areas' rings as encoded polylines, the anchors as rows. */
export interface AreasFile {
  v: 1;
  areas: { name: string; level?: number; place?: string; rings: string[]; holes?: string[] }[];
  anchors: [name: string, kind: Anchor['kind'], lat: number, lon: number][];
}

/** How closely the bounds are kept (m): ample for which town a stop is in. */
const TOLERANCE = 12;
const SAME = 1e-7;
const near = (a: LatLon, b: LatLon) =>
  Math.abs(a.lat - b.lat) < SAME && Math.abs(a.lon - b.lon) < SAME;

/** Closed rings from the ways of a relation's members, joined end to end. */
export function joinRings(ways: readonly LatLon[][]): LatLon[][] {
  const left = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings: LatLon[][] = [];
  while (left.length > 0) {
    const ring = left.shift()!;
    for (let grew = true; grew && !near(ring[0]!, ring[ring.length - 1]!);) {
      grew = false;
      const end = ring[ring.length - 1]!;
      for (let i = 0; i < left.length; i++) {
        const w = left[i]!;
        if (near(w[0]!, end)) ring.push(...w.slice(1));
        else if (near(w[w.length - 1]!, end)) ring.push(...w.slice(0, -1).reverse());
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && near(ring[0]!, ring[ring.length - 1]!)) rings.push(ring);
  }
  return rings;
}

/** Whether a point lies in a ring (ray casting; the ring closed or not). */
export function inRing(p: LatLon, ring: readonly LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat) {
      const lon = a.lon + ((p.lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon);
      if (p.lon < lon) inside = !inside;
    }
  }
  return inside;
}

export const inArea = (p: LatLon, area: Pick<Area, 'rings' | 'holes'>) =>
  area.rings.some((r) => inRing(p, r)) && !area.holes.some((r) => inRing(p, r));

/** The parishes, municipalities and town or village areas of an Overpass answer. */
export function areasFromOsm(elements: readonly OsmShape[]): Area[] {
  const out: Area[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (!t.name) continue;
    const level = t.boundary === 'administrative' ? Number(t.admin_level) : undefined;
    const place = t.place && t.place !== 'square' ? t.place : undefined;
    if (level === undefined && !place) continue;
    let rings: LatLon[][] = [];
    let holes: LatLon[][] = [];
    if (e.type === 'way' && e.geometry) rings = joinRings([e.geometry]);
    else if (e.type === 'relation' && e.members) {
      const ways = (role: string) =>
        e.members!.filter((m) => m.type === 'way' && m.role === role && m.geometry);
      rings = joinRings(ways('outer').map((m) => m.geometry!));
      holes = joinRings(ways('inner').map((m) => m.geometry!));
    }
    if (rings.length === 0) continue;
    const thin = (r: LatLon[]) => simplify(r, TOLERANCE);
    out.push({
      name: t.name,
      ...(level !== undefined && Number.isFinite(level) ? { level } : {}),
      ...(place ? { place } : {}),
      rings: rings.map(thin),
      holes: holes.map(thin),
    });
  }
  return out;
}

/** Churches, town halls and squares, at their middle. */
export function anchorsFromOsm(elements: readonly OsmElement[]): Anchor[] {
  const out: Anchor[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!t.name || lat === undefined || lon === undefined) continue;
    const kind =
      t.amenity === 'place_of_worship'
        ? 'church'
        : t.amenity === 'townhall'
          ? 'townhall'
          : t.place === 'square'
            ? 'square'
            : undefined;
    if (!kind) continue;
    out.push({
      name: t.name,
      kind,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
    });
  }
  return out;
}

export function encodeAreas(areas: readonly Area[], anchors: readonly Anchor[]): AreasFile {
  return {
    v: 1,
    areas: areas.map((a) => ({
      name: a.name,
      ...(a.level !== undefined ? { level: a.level } : {}),
      ...(a.place ? { place: a.place } : {}),
      rings: a.rings.map((r) => encodePolyline(r)),
      ...(a.holes.length > 0 ? { holes: a.holes.map((r) => encodePolyline(r)) } : {}),
    })),
    anchors: anchors.map((a) => [a.name, a.kind, a.lat, a.lon]),
  };
}

export function decodeAreas(file: AreasFile): { areas: Area[]; anchors: Anchor[] } {
  return {
    areas: file.areas.map((a) => ({
      name: a.name,
      ...(a.level !== undefined ? { level: a.level } : {}),
      ...(a.place ? { place: a.place } : {}),
      rings: a.rings.map(decodePolyline),
      holes: (a.holes ?? []).map(decodePolyline),
    })),
    anchors: file.anchors.map(([name, kind, lat, lon]) => ({ name, kind, lat, lon })),
  };
}

/**
 * The bounds of a town or village: the area of its name around it, a place area before
 * a parish and a parish before a municipality (Ribeira Brava the parish, not the whole
 * municipality); none for a suburb without bounds of its own.
 */
export function areaOf(place: BPlace, areas: readonly Area[]): Area | undefined {
  const name = normalise(place.name);
  const rank = (a: Area) => (a.place ? 0 : a.level === 8 ? 1 : 2);
  return areas
    .filter((a) => normalise(a.name) === name && inArea(place, a))
    .sort((a, b) => rank(a) - rank(b))[0];
}

/** Without bounds of its own, how far from its point a place reaches (m). */
const REACH: Record<string, number> = { town: 1200, village: 700 };
/** How the buses at a stop count against its distance from the middle (m). */
const MIDDLE = 500;
/** The church, town hall or square must be this near the middle (m). */
const ANCHOR_REACH = 1500;

/**
 * How many buses call at each stop on the day, the ones that end there too: a trip
 * there may end at a terminus in the middle of the village.
 */
export function busesPerStop(net: Network, date: string): number[] {
  const count = net.stops.map(() => 0);
  const day = net.timetable(date);
  net.patterns.forEach((p, i) => {
    const n = day.patterns[i]!.start.length;
    if (n === 0) return;
    for (const s of new Set(p.stops)) count[s]! += n;
  });
  return count;
}

export interface PlaceGoalResult {
  goal?: { lat: number; lon: number; via: PlaceGoal; name: string };
  /** The bounds, when there is nothing in them to go to. */
  area?: Area;
}

/** Where a trip to a town or village goes (see the top of this file). */
export function placeGoal(
  net: Network,
  place: BPlace,
  areas: readonly Area[],
  anchors: readonly Anchor[],
  buses: readonly number[],
): PlaceGoalResult {
  const area = areaOf(place, areas);
  const reach = REACH[place.kind] ?? 700;
  const inside = (p: LatLon) => (area ? inArea(p, area) : haversine(place, p) <= reach);
  const stops = net.stops
    .map((s, i) => ({ s, i, d: haversine(place, s) }))
    .filter((x) => x.d <= 8000 && inside(x.s));
  // Its own bus station: the one nearest its middle.
  const station = stops
    .filter((x) => isBusStation(x.s.name) && buses[x.i]! > 0)
    .sort((a, b) => a.d - b.d)[0];
  if (station) return { goal: { ...at(station.s), via: 'station', name: station.s.name } };
  // Its central stop: many buses and near the middle.
  const score = (x: { i: number; d: number }) => buses[x.i]! * Math.exp(-x.d / MIDDLE);
  const central = stops
    .filter((x) => buses[x.i]! > 0)
    .sort((a, b) => score(b) - score(a) || a.d - b.d)[0];
  if (central) return { goal: { ...at(central.s), via: 'stop', name: central.s.name } };
  // Its church (a parish church before a chapel), its town hall, its square.
  const nearBy = anchors
    .map((a) => ({ a, d: haversine(place, a) }))
    .filter((x) => x.d <= ANCHOR_REACH && inside(x.a));
  const own = normalise(place.name);
  const order = (x: { a: Anchor; d: number }) =>
    (x.a.kind === 'church'
      ? /^(igreja|matriz|se\b)/i.test(normalise(x.a.name))
        ? 0
        : 3
      : x.a.kind === 'townhall'
        ? normalise(x.a.name).includes(own)
          ? 1
          : 4
        : 2) *
      100_000 +
    x.d;
  const anchor = nearBy.sort((a, b) => order(a) - order(b))[0];
  if (anchor) return { goal: { ...at(anchor.a), via: anchor.a.kind, name: anchor.a.name } };
  return area ? { area } : {};
}

const at = (p: LatLon) => ({
  lat: Math.round(p.lat * 1e5) / 1e5,
  lon: Math.round(p.lon * 1e5) / 1e5,
});

/**
 * Puts on each town and village of the bundle where a trip there goes, or its bounds
 * when nothing in them is to be gone to; `date` is a day whose buses count.
 */
export function addPlaceGoals(
  bundle: NetworkBundle,
  file: AreasFile,
  date: string,
): { goals: Record<PlaceGoal, number>; bounds: number } {
  const net = new Network(bundle);
  const { areas, anchors } = decodeAreas(file);
  const buses = busesPerStop(net, date);
  const goals: Record<PlaceGoal, number> = {
    station: 0,
    stop: 0,
    church: 0,
    townhall: 0,
    square: 0,
  };
  let bounds = 0;
  for (const place of bundle.places ?? []) {
    if (place.kind !== 'town' && place.kind !== 'village') continue;
    const found = placeGoal(net, place, areas, anchors, buses);
    if (found.goal) {
      place.goal = [found.goal.lat, found.goal.lon, found.goal.via];
      goals[found.goal.via]++;
    } else if (found.area) {
      place.bounds = found.area.rings.map((r) => encodePolyline(simplify(r, 40)));
      bounds++;
    }
  }
  return { goals, bounds };
}
