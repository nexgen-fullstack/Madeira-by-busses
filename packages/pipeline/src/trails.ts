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
  members?: { type: string; role?: string; geometry?: { lat: number; lon: number }[] }[];
}

/** Ways whose ends are this close (m) join into one line. */
const JOIN = 25;
/** A trail's start and end this close (m) make a loop. */
const LOOP = 250;
/** How much detail its shape keeps (m). */
const DETAIL = 4;
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

/** One trail from its route, or undefined when it has no shape or is too short. */
export function trailOf(rel: OsmRelation, terrain?: Terrain): Trail | undefined {
  const tags = rel.tags ?? {};
  const { ref, name } = splitName(tags);
  if (!name) return undefined;
  const ways = (rel.members ?? [])
    .filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map((m) => m.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })));
  const lines = joinWays(ways)
    .map((l) => simplify(l, DETAIL))
    .sort((x, y) => lengthOf(y) - lengthOf(x));
  const length = Math.round(lines.reduce((m, l) => m + lengthOf(l), 0));
  if (lines.length === 0 || length < SHORTEST) return undefined;
  const main = lines[0]!;
  const first = main[0]!;
  const last = main[main.length - 1]!;
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
    roundtrip: tags.roundtrip === 'yes' || haversine(first, last) <= LOOP,
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
  const trails = elements
    .filter((e) => e.type === 'relation')
    .flatMap((rel) => {
      const t = trailOf(rel, terrain);
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
