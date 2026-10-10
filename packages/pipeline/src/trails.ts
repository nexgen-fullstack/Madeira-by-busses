import {
  encodePolyline,
  haversine,
  type LatLon,
  type Trail,
  type TrailKind,
  type TrailsFile,
} from '@madeirabus/engine';
import { resample, type Terrain } from './terrain.ts';
import { simplify } from './walk.ts';

/**
 * Madeira's hiking trails from OpenStreetMap's hiking routes (relations with their ways'
 * shapes, as Overpass gives them with `out geom`): each made into one line or a few, with
 * its length, its climb on the elevation tiles and its kind.
 */

export interface OsmRelation {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: {
    type: string;
    /** The way's id. */
    ref?: number;
    role?: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}

/** The roads buses and cars drive on: no trail's start or end, however a route goes on them. */
const ROADS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'road',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);
/** North of this latitude is Porto Santo, whose trails no bus of the app goes to. */
const PORTO_SANTO = 32.95;
/** A route that is mostly roads like these (this share of it or more) is no trail to walk. */
const MOSTLY_ROADS = 0.5;

/** Ways whose ends are this close (m) join into one line. */
const JOIN = 25;
/** A trail's start and end this close (m) make a loop. */
const LOOP = 250;
/** How much detail its shape keeps (m): the path itself, for a phone's GPS to follow. */
const DETAIL = 0.7;
/** Shorter trails (m) are a few steps, not a walk. */
const SHORTEST = 400;

/** "PR 6 - Levada das 25 Fontes": the number on the waymark, and the name. */
export function splitName(tags: Record<string, string>): { ref?: string; name: string } {
  const ref = tags.ref?.trim() || undefined;
  let name = (tags.name ?? '').trim();
  // The number in the name again: "PR 6 - …", "PR 6.1 – …", "PR 9.1 …".
  if (ref)
    name = name.replace(
      new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:]?\\s*`),
      '',
    );
  return { ref, name: name || ref || '' };
}

/** An official PR trail, a levada, a vereda or royal path, or another walk. */
export function kindOf(ref: string | undefined, name: string): TrailKind {
  if (/^PR\s*\d/i.test(ref ?? '')) return 'pr';
  if (/^levada/i.test(name)) return 'levada';
  if (/^(vereda|caminho)/i.test(name)) return 'vereda';
  return 'other';
}

/**
 * The ways of a route joined end to end into lines, in the order the route lists them
 * (a way turned round where it fits that way); a gap starts another line.
 */
export function joinWays(ways: readonly LatLon[][]): LatLon[][] {
  const lines: LatLon[][] = [];
  for (const way of ways) {
    if (way.length < 2) continue;
    const line = lines[lines.length - 1];
    if (!line) {
      lines.push([...way]);
      continue;
    }
    const head = line[0]!;
    const tail = line[line.length - 1]!;
    const a = way[0]!;
    const b = way[way.length - 1]!;
    // A line of one way may still be turned round to meet the next.
    const options: [number, () => void][] = [
      [haversine(tail, a), () => line.push(...way.slice(1))],
      [haversine(tail, b), () => line.push(...[...way].reverse().slice(1))],
      [haversine(head, b), () => line.unshift(...way.slice(0, -1))],
      [haversine(head, a), () => line.unshift(...[...way].reverse().slice(0, -1))],
    ];
    const [d, join] = options.reduce((x, y) => (y[0] < x[0] ? y : x));
    if (d <= JOIN) join();
    else lines.push([...way]);
  }
  return lines;
}

/** Metres between the heights read along a trail. */
const STEP = 25;
/** Heights taken as the middle one of this many around each (about 150 m): cliffs beside a path. */
const SMOOTH = 7;
/** A change smaller than this (m) is the elevation model's noise, not a slope. */
const NOISE = 8;
/**
 * A levada follows the hillside nearly level, the cliffs beside it all the way: its
 * heights over about a kilometre, and only a change of 15 m.
 */
const LEVADA_SMOOTH = 41;
const LEVADA_NOISE = 15;

/**
 * Metres climbed and gone down along a trail. The elevation tiles are coarse beside the
 * cliffs that levadas and veredas cling to: read every 25 m, each height is the middle one
 * of those round it, and only a change of 8 m counts; a levada comes out nearly level.
 */
export function trailClimb(
  line: readonly LatLon[],
  terrain: Terrain,
  smooth = SMOOTH,
  noise = NOISE,
): { up: number; down: number; heights: number[] } {
  const raw = resample(line, STEP)
    .map((p) => terrain.at(p))
    .filter((h): h is number => h !== undefined);
  const half = Math.floor(smooth / 2);
  const heights = raw.map((_, i) => {
    const window = raw.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)]!;
  });
  let up = 0;
  let down = 0;
  let anchor = heights[0];
  for (const h of heights) {
    if (anchor === undefined) break;
    if (h - anchor >= noise) {
      up += h - anchor;
      anchor = h;
    } else if (anchor - h >= noise) {
      down += anchor - h;
      anchor = h;
    }
  }
  return { up: Math.round(up), down: Math.round(down), heights };
}

const lengthOf = (line: readonly LatLon[]) =>
  line.slice(1).reduce((m, p, i) => m + haversine(line[i]!, p), 0);

const key = (p: LatLon) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** A stretch of road in the middle of a trail longer than this (m) is left off it too. */
const ROAD_STRETCH = 200;

/**
 * A line with its stretches along roads left off (`onRoad`: whether a step from one point
 * to the next runs along a road): its ends start and finish where it leaves the road for the path,
 * and a long stretch of road in its middle cuts it in two; a road only crossed stays.
 */
export function offTheRoads(
  line: readonly LatLon[],
  onRoad: (a: LatLon, b: LatLon) => boolean,
): LatLon[][] {
  // Each step, whether it runs along a road.
  const road = line.slice(1).map((p, i) => onRoad(line[i]!, p));
  const out: LatLon[][] = [];
  let i = 0;
  while (i < road.length) {
    let j = i;
    while (j < road.length && road[j] === road[i]) j++;
    // Steps i…j-1 of one kind: points i…j.
    const part = line.slice(i, j + 1);
    const atEnd = i === 0 || j === road.length;
    if (!road[i] || (!atEnd && lengthOf(part) <= ROAD_STRETCH)) {
      const last = out[out.length - 1];
      if (last && last[last.length - 1] === part[0]) last.push(...part.slice(1));
      else out.push(part);
    }
    i = j;
  }
  return out.filter((l) => l.length > 1);
}

/** Its ways, each with whether it is a road (`wayTags`: the tags of each way, by its id). */
function waysOf(rel: OsmRelation, wayTags?: ReadonlyMap<number, Record<string, string>>) {
  return (rel.members ?? [])
    .filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map((m) => ({
      points: m.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })),
      road: ROADS.has(wayTags?.get(m.ref ?? -1)?.highway ?? ''),
    }));
}

/** How much of a route is roads, and its lines with the roads at their ends left off. */
export function trailLinesOf(
  rel: OsmRelation,
  wayTags?: ReadonlyMap<number, Record<string, string>>,
): { lines: LatLon[][]; roads: number; trimmed: number; kept: number } {
  const ways = waysOf(rel, wayTags);
  // The steps of the roads, either way.
  const roadSteps = new Set<string>();
  let roads = 0;
  let all = 0;
  for (const w of ways) {
    if (w.road) {
      w.points.slice(1).forEach((p, i) => {
        roadSteps.add(`${key(w.points[i]!)}|${key(p)}`);
        roadSteps.add(`${key(p)}|${key(w.points[i]!)}`);
      });
    }
    const m = lengthOf(w.points);
    all += m;
    if (w.road) roads += m;
  }
  const onRoad = (a: LatLon, b: LatLon) => roadSteps.has(`${key(a)}|${key(b)}`);
  const joined = joinWays(ways.map((w) => w.points));
  const lines = joined.flatMap((l) => offTheRoads(l, onRoad));
  const kept = lines.reduce((m, l) => m + lengthOf(l), 0);
  const before = joined.reduce((m, l) => m + lengthOf(l), 0);
  return {
    lines,
    roads: all > 0 ? roads / all : 0,
    trimmed: before - kept,
    kept: before > 0 ? kept / before : 0,
  };
}

/** One trail from its route, or undefined when it has no shape, is too short or is roads. */
export function trailOf(
  rel: OsmRelation,
  terrain?: Terrain,
  wayTags?: ReadonlyMap<number, Record<string, string>>,
): Trail | undefined {
  const tags = rel.tags ?? {};
  const { ref, name } = splitName(tags);
  if (!name) return undefined;
  const found = trailLinesOf(rel, wayTags);
  // Mostly roads, or roads cut most of it off: a royal road through the villages, not a trail.
  if (found.roads >= MOSTLY_ROADS || found.kept < 1 - MOSTLY_ROADS) return undefined;
  const lines = found.lines
    .map((l) => simplify(l, DETAIL))
    .sort((x, y) => lengthOf(y) - lengthOf(x));
  const length = Math.round(lines.reduce((m, l) => m + lengthOf(l), 0));
  if (lines.length === 0 || length < SHORTEST) return undefined;
  const main = lines[0]!;
  const first = main[0]!;
  const last = main[main.length - 1]!;
  if (first.lat > PORTO_SANTO) return undefined;
  let up = 0;
  let down = 0;
  let low = 0;
  let high = 0;
  const kind = kindOf(ref, name);
  const levada = /^levada/i.test(name);
  if (terrain) {
    for (const l of lines) {
      const c = levada
        ? trailClimb(l, terrain, LEVADA_SMOOTH, LEVADA_NOISE)
        : trailClimb(l, terrain);
      up += c.up;
      down += c.down;
      if (l === main && c.heights.length) {
        low = Math.round(Math.min(...c.heights));
        high = Math.round(Math.max(...c.heights));
      }
    }
  }
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-|-$/g, '');
  return {
    id: kind === 'pr' && ref ? slug(ref.replace(/\s+/g, '')) : `osm-${rel.id}`,
    ...(ref ? { ref } : {}),
    name,
    kind,
    osm: rel.id,
    length,
    up,
    down,
    low,
    high,
    roundtrip: haversine(first, last) <= LOOP,
    start: [round(first.lat), round(first.lon)],
    end: [round(last.lat), round(last.lon)],
    lines: lines.map(encodePolyline),
  };
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

const KIND_ORDER: Record<TrailKind, number> = { pr: 0, levada: 1, vereda: 2, other: 3 };

/** Every trail of the routes: the PR trails first by their number, then the rest by name. */
export function buildTrails(elements: readonly OsmRelation[], terrain?: Terrain): TrailsFile {
  const seen = new Set<string>();
  // The ways' own tags, when Overpass sent them (`way(r); out tags`): which are roads.
  const wayTags = new Map(
    elements.filter((e) => e.type === 'way').map((e) => [e.id, e.tags ?? {}] as const),
  );
  const trails = elements
    .filter((e) => e.type === 'relation')
    .flatMap((rel) => {
      const t = trailOf(rel, terrain, wayTags.size > 0 ? wayTags : undefined);
      if (!t || seen.has(t.id)) return [];
      seen.add(t.id);
      return [t];
    })
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.ref ?? '').localeCompare(b.ref ?? '', 'pt', { numeric: true }) ||
        a.name.localeCompare(b.name, 'pt'),
    );
  return { generatedAt: new Date().toISOString(), trails };
}
