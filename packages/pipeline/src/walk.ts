import {
  haversine,
  MAX_KERB,
  WALK_PATH,
  WALK_STEPS,
  WALK_STREET,
  type LatLon,
  type WalkGraphData,
} from '@madeirabus/engine';
import { BOTH_WAYS, carriageway, driveKind, highwayClass, roadDirection } from './drive.ts';

/**
 * The walking network for the app (walk.bin), from OpenStreetMap's ways as
 * Overpass returns them with `out geom`: streets, pavements, steps and paths
 * a pedestrian may use, joined at their junctions, without the expressways,
 * long road tunnels and private ways.
 */

/** An Overpass way with its node ids and coordinates. */
export interface OsmWay {
  id: number;
  nodes: number[];
  geometry: LatLon[];
  tags?: Record<string, string>;
}

const NOT_FOR_WALKING = new Set([
  'motorway',
  'motorway_link',
  'construction',
  'proposed',
  'raceway',
  'bus_guideway',
  'busway',
  'platform',
  'elevator',
  'via_ferrata',
  'abandoned',
  'disused',
  'razed',
  'no',
  'emergency_bay',
  'escape',
  'corridor',
  'bus_stop',
  'stop',
  'ladder',
  'rest_area',
  'services',
]);
const FOOT_NO = new Set(['no', 'private', 'use_sidepath', 'discouraged']);
const FOOT_YES = new Set(['yes', 'designated', 'permissive', 'official', 'destination']);
const ACCESS_NO = new Set(['no', 'private', 'military', 'permit', 'agricultural', 'forestry']);
/** Longer tunnels than this are left out unless marked for walking (m). */
const MAX_TUNNEL = 250;

/** How a way walks (WALK_STREET, WALK_STEPS, WALK_PATH), or undefined where one may not walk. */
export function walkKind(tags: Record<string, string> = {}, length = 0): number | undefined {
  const hw = tags.highway;
  if (!hw || NOT_FOR_WALKING.has(hw) || tags.area === 'yes') return undefined;
  const foot = tags.foot;
  if (foot && FOOT_NO.has(foot)) return undefined;
  const footYes = foot !== undefined && FOOT_YES.has(foot);
  if (!footYes && tags.access && ACCESS_NO.has(tags.access)) return undefined;
  // Madeira's road and levada tunnels run for kilometres through the mountains.
  if (!footYes && tags.tunnel === 'yes' && length > MAX_TUNNEL) return undefined;
  if (hw === 'steps') return WALK_STEPS;
  if (hw === 'path' || hw === 'track' || hw === 'bridleway') return WALK_PATH;
  return WALK_STREET;
}

/** Ways where people walk in the middle: a square, a shared street, a pedestrian street. */
const SHARED = new Set(['living_street', 'pedestrian']);

/**
 * How far from a road's middle its pavement is (m): half the carriageway and
 * the kerb, where a walk along the road goes. None on footways, steps and paths,
 * which are mapped where they are.
 */
export function kerbOffset(tags: Record<string, string> = {}): number {
  const cls = highwayClass(tags.highway);
  if (cls === undefined || SHARED.has(tags.highway ?? '')) return 0;
  const kind = driveKind(tags);
  const oneWay = kind !== undefined && roadDirection(kind) !== BOTH_WAYS;
  const { lanes, lane } = carriageway(tags, cls, oneWay);
  return Math.min(MAX_KERB, Math.round(((lanes * lane) / 2 + 0.5) * 10) / 10);
}

/** A way's kind in walk.bin: how it walks and, along a road, how far its pavement is. */
export function walkEdgeKind(tags: Record<string, string> = {}, length = 0): number | undefined {
  const kind = walkKind(tags, length);
  if (kind === undefined) return undefined;
  return kind + Math.round(kerbOffset(tags) * 10) * 4;
}

export function pathLength(points: readonly LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1]!, points[i]!);
  return d;
}

/** Douglas–Peucker on a short polyline, in metres. */
export function simplify(points: LatLon[], tolerance: number): LatLon[] {
  if (points.length <= 2) return points;
  const lat0 = points[0]!.lat;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    const a = points[i]!;
    const b = points[j]!;
    const dx = (b.lon - a.lon) * kx;
    const dy = (b.lat - a.lat) * ky;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const px = (points[k]!.lon - a.lon) * kx;
      const py = (points[k]!.lat - a.lat) * ky;
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, k) => keep[k] === 1);
}

export interface GraphBuildOptions {
  /** Douglas–Peucker tolerance for the shapes of the ways (m). */
  tolerance?: number;
  /** Pieces of network shorter than this in all are left out (m). */
  minComponent?: number;
  /** The kind of a way, or undefined to leave it out; by default how it walks and its pavement. */
  kindOf?: (tags: Record<string, string> | undefined, length: number) => number | undefined;
  /** The kind of a way taken the other way round (one-way roads); by default the same. */
  reverse?: (kind: number) => number;
}

export interface WalkBuildStats {
  ways: number;
  walkable: number;
  nodes: number;
  edges: number;
  /** Total length of the kept ways (km). */
  km: number;
  droppedComponents: number;
}

/**
 * Builds the graph: junctions become nodes, the ways between them edges.
 * Pieces of network shorter than `minComponent` metres in all (a stretch of
 * pavement mapped apart from everything else) are dropped, so nobody is sent
 * to walk on one.
 */
export function buildWalkGraph(
  ways: readonly OsmWay[],
  {
    tolerance = 1.5,
    minComponent = 400,
    kindOf = walkEdgeKind,
    reverse = (kind: number) => kind,
  }: GraphBuildOptions = {},
): { graph: WalkGraphData; stats: WalkBuildStats } {
  type Raw = { a: number; b: number; kind: number; points: LatLon[] };
  const kept: { way: OsmWay; kind: number }[] = [];
  for (const way of ways) {
    if (!way.nodes || !way.geometry || way.nodes.length !== way.geometry.length) continue;
    if (way.nodes.length < 2) continue;
    const kind = kindOf(way.tags, pathLength(way.geometry));
    if (kind !== undefined) kept.push({ way, kind });
  }

  // Junctions: nodes on more than one way, and the ends of every way.
  const refs = new Map<number, number>();
  for (const { way } of kept) {
    way.nodes.forEach((id, i) => {
      const end = i === 0 || i === way.nodes.length - 1 ? 2 : 1;
      refs.set(id, (refs.get(id) ?? 0) + end);
    });
  }
  const nodeIndex = new Map<number, number>();
  const nodes: LatLon[] = [];
  const indexOf = (id: number, p: LatLon) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodes.length;
      nodeIndex.set(id, i);
      nodes.push({ lat: p.lat, lon: p.lon });
    }
    return i;
  };

  let edges: (Raw | undefined)[] = [];
  for (const { way, kind } of kept) {
    let start = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      if ((refs.get(way.nodes[i]!) ?? 0) < 2) continue;
      const a = indexOf(way.nodes[start]!, way.geometry[start]!);
      const b = indexOf(way.nodes[i]!, way.geometry[i]!);
      const points = way.geometry.slice(start + 1, i).map((p) => ({ lat: p.lat, lon: p.lon }));
      if (a !== b || points.length > 0) edges.push({ a, b, kind, points });
      start = i;
    }
  }

  // Merge chains: a node where exactly two ways of the same kind meet is just a bend.
  const incident: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    incident[e!.a]!.push(i);
    if (e!.b !== e!.a) incident[e!.b]!.push(i);
  });
  for (let x = 0; x < nodes.length; x++) {
    const inc = incident[x]!;
    if (inc.length !== 2) continue;
    const [i, j] = inc as [number, number];
    const e1 = edges[i]!;
    const e2 = edges[j]!;
    if (i === j || e1.a === e1.b || e2.a === e2.b) continue;
    // Orient e1 to end at x and e2 to start at x (a one-way road turned round changes kind).
    const p1 =
      e1.b === x
        ? e1
        : { a: e1.b, b: e1.a, kind: reverse(e1.kind), points: [...e1.points].reverse() };
    const p2 =
      e2.a === x
        ? e2
        : { a: e2.b, b: e2.a, kind: reverse(e2.kind), points: [...e2.points].reverse() };
    if (p1.kind !== p2.kind) continue;
    if (p1.a === p2.b) continue; // would close a loop on one node
    const merged: Raw = {
      a: p1.a,
      b: p2.b,
      kind: p1.kind,
      points: [...p1.points, nodes[x]!, ...p2.points],
    };
    edges[i] = merged;
    edges[j] = undefined;
    incident[x] = [];
    const other = incident[p2.b]!;
    other[other.indexOf(j)] = i;
  }
  edges = edges.filter((e) => e !== undefined);

  // Connected pieces and their length.
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const lengths = edges.map((e) => pathLength([nodes[e!.a]!, ...e!.points, nodes[e!.b]!]));
  edges.forEach((e) => {
    const ra = find(e!.a);
    const rb = find(e!.b);
    if (ra !== rb) parent[ra] = rb;
  });
  const size = new Map<number, number>();
  edges.forEach((e, i) => size.set(find(e!.a), (size.get(find(e!.a)) ?? 0) + lengths[i]!));
  const keepEdge = edges.map((e) => (size.get(find(e!.a)) ?? 0) >= minComponent);
  const droppedComponents = [...size.values()].filter((s) => s < minComponent).length;

  // Renumber the nodes still in use, near each other in space (small differences in the file).
  const used = new Set<number>();
  edges.forEach((e, i) => {
    if (!keepEdge[i]) return;
    used.add(e!.a);
    used.add(e!.b);
  });
  const order = [...used].sort((p, q) => morton(nodes[p]!) - morton(nodes[q]!));
  const renumber = new Map(order.map((n, i) => [n, i]));
  const graph: WalkGraphData = {
    nodes: order.map((n) => nodes[n]!),
    edges: [],
  };
  let km = 0;
  edges.forEach((e, i) => {
    if (!keepEdge[i]) return;
    km += lengths[i]! / 1000;
    const full = simplify([nodes[e!.a]!, ...e!.points, nodes[e!.b]!], tolerance);
    graph.edges.push({
      from: renumber.get(e!.a)!,
      to: renumber.get(e!.b)!,
      kind: e!.kind,
      points: full.slice(1, -1),
    });
  });
  return {
    graph,
    stats: {
      ways: ways.length,
      walkable: kept.length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      km: Math.round(km),
      droppedComponents,
    },
  };
}

/** Interleaved bits of the coordinates: nearby points get nearby numbers. */
function morton(p: LatLon): number {
  const x = Math.floor(((p.lon + 180) / 360) * 65535);
  const y = Math.floor(((p.lat + 90) / 180) * 65535);
  let z = 0;
  for (let b = 15; b >= 0; b--) z = z * 4 + ((x >> b) & 1) * 2 + ((y >> b) & 1);
  return z;
}
