import { haversine, type LatLon, type WalkGraphData } from '@madeirabus/engine';
import { BACKWARD, FORWARD, ROAD_SPEED_KMH, roadClass, roadDirection, roadSide } from './drive.ts';
import { pathLength, simplify } from './walk.ts';

/**
 * Lines along the roads. CAM and SIGA Rodoeste publish no shapes, so the
 * pipeline works out the way a bus most likely drives through a line's stops:
 * each stop is matched to the roads next to it, and the stops are chained by
 * the quickest ways between them so that the bus passes every stop in the
 * direction it drives and never turns round in the middle of a road (a hidden
 * Markov model solved with Viterbi, as map matching does with GPS points).
 *
 * Horários do Funchal does publish shapes, drawn by hand a few metres beside
 * the roads in places; the same matching, with points every few dozen metres
 * of the drawn line in place of the stops, puts them on the roads too.
 *
 * Every step of a line carries how far right of the road's middle the bus
 * drives (the centre of its lane), for the map to draw it there.
 */

/** A line along the roads: its points and, for each step, how far right of the road's middle it runs (m). */
export interface RoadShape {
  points: LatLon[];
  sides: number[];
}

/** Where a stop meets a road, and which way the bus drives past it. */
interface Candidate {
  edge: number;
  /** Metres from the edge's first node. */
  along: number;
  /** Metres between the stop and the road. */
  offset: number;
  point: LatLon;
  /** Driving from the edge's first node to its last. */
  forward: boolean;
  /** The way the bus heads there (radians clockwise from north). */
  heading: number;
}

/** Where a point comes closest to a road. */
export interface RoadHit {
  edge: number;
  /** Metres from the edge's first node. */
  along: number;
  /** Metres between the point and the road. */
  offset: number;
  point: LatLon;
  /** Of the road there, from its first node towards its last (radians clockwise from north). */
  bearing: number;
}

/** How the points of a line are matched to the roads. */
interface Matching {
  /** Roads this far from a point may be where it is (m)… */
  far: number;
  /** …the nearest always, and others this close (m). */
  near: number;
  /** A point by an expressway is this much less likely on it (s). */
  expressway: number;
  /** Seconds of driving to look for a way between two points `straight` metres apart. */
  limit: (straight: number) => number;
  /** A longer way (m) between two points `straight` metres apart is a wrong road, not a detour. */
  longest: (straight: number) => number;
  /** Ways this many seconds slower than the best found so far are not looked at. */
  slack: number;
}

/**
 * Stops: roads up to 150 m away (a stop on a square or a lay-by), the nearest
 * and any within 45 m (a stop between two parallel streets); buses seldom stop
 * on an expressway, so a stop next to one is more likely on the road beside it.
 */
const STOPS: Matching = {
  far: 150,
  near: 45,
  expressway: 30,
  limit: (straight) => (straight * 4 + 1500) / 8,
  longest: (straight) => straight * 4 + 1500,
  slack: 180,
};
/**
 * The points of a line drawn by its operator, every few dozen metres: on the
 * road within a few metres, the bus never far round the block between two of them.
 */
const DRAWN: Matching = {
  far: 20,
  near: 12,
  expressway: 0,
  limit: (straight) => (straight * 2.5 + 100) / 4,
  longest: (straight) => straight * 2.5 + 100,
  slack: 30,
};
/** Seconds a road heading across the drawn line costs (half of it at right angles). */
const HEADING_WEIGHT = 10;
/** A road between the ends of a stretch drawn off the roads, this much as long as it, takes its place. */
const BRIDGE_MIN = 0.5;
const BRIDGE_MAX = 1.3;
/** Points of a drawn line this far apart are matched to the roads (m). */
const GUIDE_STEP = 40;
/** A drawn line matched to the roads for less than this share of it is left as drawn. */
const MIN_MATCHED = 0.6;
/** Seconds of driving a metre between a stop and its road is worth. */
const OFFSET_WEIGHT = 0.3;
/** The fastest a bus goes (m/s), for the A* estimate. */
const VMAX = ROAD_SPEED_KMH[0]! / 3.6;
const CELL = 0.0015;
const DEG = Math.PI / 180;

/** A step of a line is looked at every this many metres for the Via Rápida… */
const EXPRESSWAY_SAMPLE = 40;
/** …on it within this many metres of its middle… */
const EXPRESSWAY_NEAR = 12;
/** …and running along it: the cosine of the most a road may turn from the step (30°). */
const EXPRESSWAY_ALONG = Math.cos(30 * DEG);
/** A junction between two stretches on the Via Rápida shorter than this is on it (m). */
const EXPRESSWAY_GAP = 250;
/** The shortest stretch on the Via Rápida that counts (m). */
const EXPRESSWAY_MIN = 600;
const cellKey = (iy: number, ix: number) => iy * 1_000_000 + ix;

/** A binary min-heap of node indices keyed by cost. */
class Heap {
  private keys: number[] = [];
  private items: number[] = [];
  get size() {
    return this.items.length;
  }
  peekKey(): number {
    return this.keys[0]!;
  }
  push(item: number, key: number) {
    const k = this.keys;
    const it = this.items;
    let i = it.length;
    k.push(key);
    it.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      it[i] = it[p]!;
      i = p;
    }
    k[i] = key;
    it[i] = item;
  }
  pop(): number {
    const k = this.keys;
    const it = this.items;
    const top = it[0]!;
    const lastK = k.pop()!;
    const lastI = it.pop()!;
    const n = it.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1]! < k[c]!) c++;
        if (k[c]! >= lastK) break;
        k[i] = k[c]!;
        it[i] = it[c]!;
        i = c;
      }
      k[i] = lastK;
      it[i] = lastI;
    }
    return top;
  }
}

/** A polyline built piece by piece, each step with its side; repeated points are dropped. */
class SidedLine {
  readonly points: LatLon[] = [];
  readonly sides: number[] = [];
  push(points: readonly LatLon[], side: number): void {
    for (const p of points) {
      const last = this.points[this.points.length - 1];
      if (last && Math.abs(last.lat - p.lat) <= 1e-7 && Math.abs(last.lon - p.lon) <= 1e-7)
        continue;
      if (last) this.sides.push(side);
      this.points.push(p);
    }
  }
  append(line: RoadShape): void {
    line.points.forEach((p, i) =>
      this.push([p], i === 0 ? (line.sides[0] ?? 0) : line.sides[i - 1]!),
    );
  }
}

/**
 * Douglas–Peucker on a line with sides, each run of steps on one side
 * simplified on its own: where the side changes stays where it is.
 */
export function simplifySided(line: RoadShape, tolerance: number): RoadShape {
  const out = new SidedLine();
  let start = 0;
  for (let i = 1; i <= line.sides.length; i++) {
    if (i < line.sides.length && line.sides[i] === line.sides[start]) continue;
    const run = simplify(line.points.slice(start, i + 1), tolerance);
    out.push(run, line.sides[start]!);
    start = i;
  }
  if (out.points.length === 0) out.push(line.points, 0);
  return { points: out.points, sides: out.sides };
}

/** Points along a line every `step` metres (and its last point), each with its vertex before it. */
function resample(points: readonly LatLon[], step: number): { p: LatLon; vertex: number }[] {
  const out: { p: LatLon; vertex: number }[] = [{ p: points[0]!, vertex: 0 }];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = haversine(a, b);
    let at = step - carried;
    while (at < d) {
      const t = at / d;
      out.push({
        p: { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) },
        vertex: i - 1,
      });
      at += step;
    }
    carried = d - (at - step);
  }
  const last = points.length - 1;
  if (haversine(out[out.length - 1]!.p, points[last]!) > 1)
    out.push({ p: points[last]!, vertex: last });
  else out[out.length - 1] = { p: points[last]!, vertex: last };
  return out;
}

export interface ShapeStats {
  patterns: number;
  /** Stop-to-stop sections drawn along the roads. */
  routed: number;
  /** Sections left straight: a stop far from the roads, or no sensible way between two. */
  straight: number;
  /** Lines drawn by their operator put on the roads. */
  matched: number;
  /** Lines drawn by their operator left as drawn: too little of them near the roads. */
  kept: number;
}

export class RoadRouter {
  readonly stats: ShapeStats = { patterns: 0, routed: 0, straight: 0, matched: 0, kept: 0 };
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  private readonly from: Uint32Array;
  private readonly to: Uint32Array;
  private readonly dir: Uint8Array;
  private readonly cls: Uint8Array;
  /** How far right of the road's middle a bus drives (m). */
  private readonly side: Float64Array;
  private readonly len: Float64Array;
  /** Metres per second. */
  private readonly speed: Float64Array;
  private readonly shapes: LatLon[][];
  private readonly cum: number[][];
  /** Ways out of each node: edge index, and whether it is driven first node → last. */
  private readonly outStart: Uint32Array;
  private readonly outEdge: Uint32Array;
  private readonly outForward: Uint8Array;
  private readonly cells = new Map<number, number[]>();
  private readonly cost: Float64Array;
  private readonly prevEdge: Int32Array;
  private readonly prevForward: Uint8Array;
  private readonly stamp: Uint32Array;
  private readonly done: Uint32Array;
  private run = 0;
  private readonly candidateCache = new Map<string, Candidate[]>();
  private readonly pathCache = new Map<string, RoadShape | undefined>();
  private expresswayCells?: Set<number>;

  constructor(data: WalkGraphData) {
    const n = data.nodes.length;
    const m = data.edges.length;
    this.lat = Float64Array.from(data.nodes, (p) => p.lat);
    this.lon = Float64Array.from(data.nodes, (p) => p.lon);
    this.from = new Uint32Array(m);
    this.to = new Uint32Array(m);
    this.dir = new Uint8Array(m);
    this.cls = new Uint8Array(m);
    this.side = new Float64Array(m);
    this.len = new Float64Array(m);
    this.speed = new Float64Array(m);
    this.shapes = [];
    this.cum = [];
    data.edges.forEach((e, i) => {
      this.from[i] = e.from;
      this.to[i] = e.to;
      this.dir[i] = roadDirection(e.kind);
      this.cls[i] = roadClass(e.kind);
      this.side[i] = roadSide(e.kind);
      this.speed[i] = (ROAD_SPEED_KMH[roadClass(e.kind)] ?? 25) / 3.6;
      const pts = [data.nodes[e.from]!, ...e.points, data.nodes[e.to]!];
      const cum = [0];
      for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1]! + haversine(pts[j - 1]!, pts[j]!));
      this.shapes.push(pts);
      this.cum.push(cum);
      this.len[i] = cum[cum.length - 1]!;
    });

    const degree = new Uint32Array(n + 1);
    for (let e = 0; e < m; e++) {
      if (this.dir[e] !== BACKWARD) degree[this.from[e]!]!++;
      if (this.dir[e] !== FORWARD) degree[this.to[e]!]!++;
    }
    this.outStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.outStart[i + 1] = this.outStart[i]! + degree[i]!;
    this.outEdge = new Uint32Array(this.outStart[n]!);
    this.outForward = new Uint8Array(this.outStart[n]!);
    const fill = this.outStart.slice(0, n);
    for (let e = 0; e < m; e++) {
      if (this.dir[e] !== BACKWARD) {
        const at = fill[this.from[e]!]!++;
        this.outEdge[at] = e;
        this.outForward[at] = 1;
      }
      if (this.dir[e] !== FORWARD) {
        const at = fill[this.to[e]!]!++;
        this.outEdge[at] = e;
        this.outForward[at] = 0;
      }
    }

    for (let e = 0; e < m; e++) {
      const pts = this.shapes[e]!;
      for (let j = 1; j < pts.length; j++) {
        const p = pts[j - 1]!;
        const q = pts[j]!;
        const y0 = Math.floor((Math.min(p.lat, q.lat) + 90) / CELL);
        const y1 = Math.floor((Math.max(p.lat, q.lat) + 90) / CELL);
        const x0 = Math.floor((Math.min(p.lon, q.lon) + 180) / CELL);
        const x1 = Math.floor((Math.max(p.lon, q.lon) + 180) / CELL);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const key = cellKey(y, x);
            const list = this.cells.get(key);
            if (!list) this.cells.set(key, [e]);
            else if (list[list.length - 1] !== e) list.push(e);
          }
        }
      }
    }

    this.cost = new Float64Array(n);
    this.prevEdge = new Int32Array(n);
    this.prevForward = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.done = new Uint32Array(n);
  }

  /** Where each road within `radius` metres of a point comes closest to it. */
  private near(p: LatLon, radius: number): Map<number, RoadHit> {
    const span = Math.ceil(radius / 111_000 / CELL / Math.cos(p.lat * DEG)) + 1;
    const cy = Math.floor((p.lat + 90) / CELL);
    const cx = Math.floor((p.lon + 180) / CELL);
    const kx = 111_320 * Math.cos(p.lat * DEG);
    const ky = 110_540;
    const best = new Map<number, RoadHit>();
    for (let y = cy - span; y <= cy + span; y++) {
      for (let x = cx - span; x <= cx + span; x++) {
        for (const e of this.cells.get(cellKey(y, x)) ?? []) {
          if (best.has(e)) continue;
          const pts = this.shapes[e]!;
          const cum = this.cum[e]!;
          let hit: RoadHit | undefined;
          for (let j = 1; j < pts.length; j++) {
            const a = pts[j - 1]!;
            const b = pts[j]!;
            const ax = (a.lon - p.lon) * kx;
            const ay = (a.lat - p.lat) * ky;
            const dx = (b.lon - a.lon) * kx;
            const dy = (b.lat - a.lat) * ky;
            const seg = dx * dx + dy * dy;
            const t = seg === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / seg));
            const offset = Math.hypot(ax + t * dx, ay + t * dy);
            if (!hit || offset < hit.offset) {
              hit = {
                edge: e,
                along: cum[j - 1]! + t * (cum[j]! - cum[j - 1]!),
                offset,
                point: { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) },
                bearing: Math.atan2(dx, dy),
              };
            }
          }
          if (hit && hit.offset <= radius) best.set(e, hit);
        }
      }
    }
    return best;
  }

  /** The road nearest to a point, if one is within `max` metres. */
  nearest(p: LatLon, max: number): RoadHit | undefined {
    let best: RoadHit | undefined;
    for (const hit of this.near(p, max).values()) if (!best || hit.offset < best.offset) best = hit;
    return best;
  }

  /** The roads next to a point, each with the ways a bus may drive past it. */
  private candidates(p: LatLon, how: Matching): Candidate[] {
    const key = `${how.far}:${p.lat},${p.lon}`;
    const cached = this.candidateCache.get(key);
    if (cached) return cached;
    const sorted = [...this.near(p, how.far)].sort((a, b) => a[1].offset - b[1].offset);
    const chosen = sorted.filter(([, h], i) => i === 0 || (h.offset <= how.near && i < 4));
    const out: Candidate[] = [];
    for (const [edge, { along, offset, point, bearing }] of chosen) {
      if (this.dir[edge] !== BACKWARD) {
        out.push({ edge, along, offset, point, forward: true, heading: bearing });
      }
      if (this.dir[edge] !== FORWARD) {
        out.push({ edge, along, offset, point, forward: false, heading: bearing + Math.PI });
      }
    }
    this.candidateCache.set(key, out);
    return out;
  }

  /** What standing at a candidate costs the matching (s), heading `heading` when known. */
  private emission(c: Candidate, how: Matching, heading?: number): number {
    const across = heading === undefined ? 0 : HEADING_WEIGHT * (1 - Math.cos(c.heading - heading));
    return c.offset * OFFSET_WEIGHT + (this.cls[c.edge] === 0 ? how.expressway : 0) + across;
  }

  /** Metres per second on an edge, seconds to drive part of it. */
  private secs(e: number, metres: number): number {
    return metres / this.speed[e]!;
  }

  private settle(
    node: number,
    cost: number,
    edge: number,
    forward: boolean,
    heap: Heap,
    h: number,
  ) {
    if (this.stamp[node] === this.run && this.cost[node]! <= cost) return;
    this.stamp[node] = this.run;
    this.cost[node] = cost;
    this.prevEdge[node] = edge;
    this.prevForward[node] = forward ? 1 : 0;
    heap.push(node, cost + h);
  }

  /** Where a candidate's drive enters its edge, and the seconds from there to the stop. */
  private entry(t: Candidate): { node: number; secs: number } {
    return t.forward
      ? { node: this.from[t.edge]!, secs: this.secs(t.edge, t.along) }
      : { node: this.to[t.edge]!, secs: this.secs(t.edge, this.len[t.edge]! - t.along) };
  }

  /**
   * Seconds of driving from one stop's candidate to each of the next stop's
   * (Infinity where there is no sensible way), by A* towards the next stop.
   */
  private drive(
    src: Candidate,
    targets: readonly Candidate[],
    goal: LatLon,
    limit: number,
    how: Matching,
  ): number[] {
    this.run++;
    const heap = new Heap();
    const out = targets.map((t) => {
      // On the same edge, ahead in the same direction.
      if (t.edge !== src.edge || t.forward !== src.forward) return Infinity;
      const d = src.forward ? t.along - src.along : src.along - t.along;
      return d >= 0 ? this.secs(t.edge, d) : Infinity;
    });
    const h = (node: number) =>
      Math.max(0, haversine({ lat: this.lat[node]!, lon: this.lon[node]! }, goal) - 2 * how.far) /
      VMAX;
    const exit = src.forward ? this.to[src.edge]! : this.from[src.edge]!;
    const first = src.forward
      ? this.secs(src.edge, this.len[src.edge]! - src.along)
      : this.secs(src.edge, src.along);
    this.settle(exit, first, -1, src.forward, heap, h(exit));
    const entries = targets.map((t) => this.entry(t));
    let bestFound = Math.min(...out);
    while (heap.size > 0) {
      const key = heap.peekKey();
      if (key > limit || key > bestFound + how.slack) break;
      const node = heap.pop();
      if (this.done[node] === this.run) continue;
      this.done[node] = this.run;
      const c = this.cost[node]!;
      entries.forEach((en, i) => {
        if (en.node === node && c + en.secs < out[i]!) {
          out[i] = c + en.secs;
          bestFound = Math.min(bestFound, out[i]!);
        }
      });
      for (let k = this.outStart[node]!; k < this.outStart[node + 1]!; k++) {
        const e = this.outEdge[k]!;
        const fwd = this.outForward[k] === 1;
        const other = fwd ? this.to[e]! : this.from[e]!;
        if (this.done[other] === this.run) continue;
        this.settle(other, c + this.secs(e, this.len[e]!), e, fwd, heap, h(other));
      }
    }
    return out;
  }

  /** Points of edge e from `a0` to `a1` metres along it (either direction). */
  private slice(e: number, a0: number, a1: number): LatLon[] {
    const pts = this.shapes[e]!;
    const cum = this.cum[e]!;
    const at = (d: number): LatLon => {
      for (let j = 1; j < pts.length; j++) {
        if (d <= cum[j]! || j === pts.length - 1) {
          const span = cum[j]! - cum[j - 1]!;
          const t = span === 0 ? 0 : Math.max(0, Math.min(1, (d - cum[j - 1]!) / span));
          const p = pts[j - 1]!;
          const q = pts[j]!;
          return { lat: p.lat + t * (q.lat - p.lat), lon: p.lon + t * (q.lon - p.lon) };
        }
      }
      return pts[pts.length - 1]!;
    };
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const out = [at(lo)];
    for (let j = 1; j < pts.length - 1; j++) if (cum[j]! > lo && cum[j]! < hi) out.push(pts[j]!);
    out.push(at(hi));
    return a0 <= a1 ? out : out.reverse();
  }

  /** The road from one candidate to the next, with its sides (undefined without a way). */
  private path(
    src: Candidate,
    dst: Candidate,
    goal: LatLon,
    limit: number,
    how: Matching,
  ): RoadShape | undefined {
    const key = `${how.far}|${src.edge}/${src.along.toFixed(1)}/${src.forward}>${dst.edge}/${dst.along.toFixed(1)}/${dst.forward}`;
    if (this.pathCache.has(key)) return this.pathCache.get(key);
    let result: RoadShape | undefined;
    const [secs] = this.drive(src, [dst], goal, limit, how);
    if (secs !== undefined && Number.isFinite(secs)) {
      const direct =
        dst.edge === src.edge &&
        dst.forward === src.forward &&
        (src.forward ? dst.along >= src.along : dst.along <= src.along);
      const en = this.entry(dst);
      const viaRoads =
        this.done[en.node] === this.run ? this.cost[en.node]! + en.secs : Number.POSITIVE_INFINITY;
      const directSecs = direct
        ? this.secs(src.edge, Math.abs(dst.along - src.along))
        : Number.POSITIVE_INFINITY;
      const line = new SidedLine();
      if (directSecs <= viaRoads) {
        line.push(this.slice(src.edge, src.along, dst.along), this.side[src.edge]!);
      } else {
        // Back from the target's entry node to the source's exit node.
        const chain: { points: LatLon[]; side: number }[] = [];
        let node = en.node;
        for (let guard = 0; guard < 100_000; guard++) {
          const e = this.prevEdge[node]!;
          if (e < 0) break;
          const fwd = this.prevForward[node] === 1;
          chain.push({
            points: fwd ? this.shapes[e]! : [...this.shapes[e]!].reverse(),
            side: this.side[e]!,
          });
          node = fwd ? this.from[e]! : this.to[e]!;
        }
        line.push(
          this.slice(src.edge, src.along, src.forward ? this.len[src.edge]! : 0),
          this.side[src.edge]!,
        );
        for (const piece of chain.reverse()) line.push(piece.points, piece.side);
        line.push(
          this.slice(dst.edge, dst.forward ? 0 : this.len[dst.edge]!, dst.along),
          this.side[dst.edge]!,
        );
      }
      result = { points: line.points, sides: line.sides };
    }
    this.pathCache.set(key, result);
    return result;
  }

  /**
   * Viterbi over the candidates of each point, in chains broken where two
   * points have no way between them: the candidate chosen for each point and
   * whether it was reached from the previous point's.
   */
  private viterbi(
    points: readonly LatLon[],
    how: Matching,
    headings?: readonly number[],
  ): { cands: Candidate[][]; choice: (number | undefined)[]; linked: boolean[] } {
    const n = points.length;
    const cands = points.map((s) => this.candidates(s, how));
    const choice: (number | undefined)[] = new Array(n).fill(undefined);
    const linked: boolean[] = new Array(n).fill(false);
    let chainStart = 0;
    const emit = (c: Candidate, i: number) => this.emission(c, how, headings?.[i]);
    let score: number[] = cands[0]!.map((c) => emit(c, 0));
    const back: number[][] = [[]];
    const closeChain = (end: number) => {
      // Backtrack the chain [chainStart, end].
      if (cands[end]!.length === 0) return;
      let j = score.indexOf(Math.min(...score));
      for (let i = end; i >= chainStart; i--) {
        choice[i] = j;
        if (i > chainStart) j = back[i]![j]!;
      }
    };
    for (let i = 1; i < n; i++) {
      const prev = cands[i - 1]!;
      const cur = cands[i]!;
      const straight = haversine(points[i - 1]!, points[i]!);
      const limit = how.limit(straight);
      const next = cur.map(() => Infinity);
      const from = cur.map(() => -1);
      if (prev.length > 0 && cur.length > 0 && straight > 0.5) {
        prev.forEach((p, a) => {
          if (!Number.isFinite(score[a]!)) return;
          const secs = this.drive(p, cur, points[i]!, limit, how);
          secs.forEach((s, b) => {
            const total = score[a]! + s + emit(cur[b]!, i);
            if (total < next[b]!) {
              next[b] = total;
              from[b] = a;
            }
          });
        });
      } else if (prev.length > 0 && cur.length > 0) {
        // The same place twice: stay put.
        cur.forEach((c, b) => {
          const a = prev.findIndex((p) => p.edge === c.edge && p.forward === c.forward);
          if (a >= 0 && Number.isFinite(score[a]!)) {
            next[b] = score[a]!;
            from[b] = a;
          }
        });
      }
      if (next.some(Number.isFinite)) {
        back[i] = from;
        score = next;
        linked[i] = true;
      } else {
        closeChain(i - 1);
        chainStart = i;
        back[i] = [];
        score = cur.map((c) => emit(c, i));
      }
    }
    closeChain(n - 1);
    return { cands, choice, linked };
  }

  /**
   * The roads between matched points: each piece along the roads where there
   * is a sensible way, otherwise `gap(i)` (the points from point i - 1 to i).
   * With `bridge`, a run of pieces off the roads is replaced by the road
   * between its ends when that road is about as long as the run: the tunnel a
   * line drawn over the old road now takes; not the car park a bus turns in.
   * Undefined when no piece is on the roads; with how many pieces are.
   */
  private assemble(
    points: readonly LatLon[],
    how: Matching,
    gap: (i: number, c: Candidate | undefined) => LatLon[],
    headings?: readonly number[],
    bridge = false,
  ): { line: RoadShape; routed: number } | undefined {
    const n = points.length;
    if (n < 2) return undefined;
    const { cands, choice, linked } = this.viterbi(points, how, headings);
    const at = (i: number) => (choice[i] !== undefined ? cands[i]![choice[i]!] : undefined);
    const pieces: (RoadShape | undefined)[] = new Array(n).fill(undefined);
    for (let i = 1; i < n; i++) {
      const c = at(i);
      const prev = at(i - 1);
      if (!c || !prev || !linked[i]) continue;
      const straight = haversine(points[i - 1]!, points[i]!);
      const piece = this.path(prev, c, points[i]!, how.limit(straight), how);
      if (piece && pathLength(piece.points) <= how.longest(straight)) pieces[i] = piece;
    }
    // Pieces taken by a bridge before them.
    const bridged = new Set<number>();
    if (bridge) {
      for (let i = 1; i < n; i++) {
        if (pieces[i]) continue;
        let j = i;
        while (j < n && !pieces[j]) j++;
        const a = at(i - 1);
        const b = j < n ? at(j - 1) : undefined;
        if (a && b && j - 1 > i - 1) {
          let drawn = 0;
          for (let k = i; k < j; k++) drawn += haversine(points[k - 1]!, points[k]!);
          const road = this.path(a, b, points[j - 1]!, (drawn * 1.3 + 50) / 3, how);
          const length = road && pathLength(road.points);
          if (road && length! >= drawn * BRIDGE_MIN && length! <= drawn * BRIDGE_MAX + 50) {
            pieces[i] = road;
            for (let k = i + 1; k < j; k++) bridged.add(k);
          }
        }
        i = j;
      }
    }
    const line = new SidedLine();
    line.push([at(0)?.point ?? points[0]!], 0);
    let routed = 0;
    for (let i = 1; i < n; i++) {
      if (bridged.has(i)) {
        routed++;
        continue;
      }
      const piece = pieces[i];
      if (piece) {
        routed++;
        line.append(piece);
      } else {
        line.push(gap(i, at(i)), 0);
      }
    }
    if (routed === 0) return undefined;
    return { line: { points: line.points, sides: line.sides }, routed };
  }

  /**
   * The way along the roads through the stops, or undefined when too few of
   * them are near a road to tell.
   */
  shape(stops: readonly LatLon[]): RoadShape | undefined {
    this.stats.patterns++;
    const made = this.assemble(stops, STOPS, (i, c) => [c?.point ?? stops[i]!]);
    if (!made) {
      if (stops.length >= 2) this.stats.straight += stops.length - 1;
      return undefined;
    }
    this.stats.routed += made.routed;
    this.stats.straight += stops.length - 1 - made.routed;
    return simplifySided(made.line, 2);
  }

  /**
   * A line drawn by its operator, put on the roads it follows; undefined when
   * too little of it is near the roads, to keep it as drawn. Where no road
   * goes (a pier, a road missing from the map) it stays as drawn.
   */
  match(drawn: readonly LatLon[]): RoadShape | undefined {
    if (drawn.length < 2) return undefined;
    const guides = resample(drawn, GUIDE_STEP);
    // The way the drawn line heads at each point: a road across it is not the one it follows.
    const headings = guides.map((g) => {
      const a = drawn[Math.min(g.vertex, drawn.length - 2)]!;
      const b = drawn[Math.min(g.vertex, drawn.length - 2) + 1]!;
      return Math.atan2((b.lon - a.lon) * Math.cos(a.lat * DEG), b.lat - a.lat);
    });
    const made = this.assemble(
      guides.map((g) => g.p),
      DRAWN,
      (i) => [...drawn.slice(guides[i - 1]!.vertex + 1, guides[i]!.vertex + 1), guides[i]!.p],
      headings,
      true,
    );
    if (!made || made.routed < MIN_MATCHED * (guides.length - 1)) {
      this.stats.kept++;
      return undefined;
    }
    this.stats.matched++;
    return simplifySided(made.line, 1.5);
  }

  /**
   * Where a line runs on the Via Rápida (the island's trunk roads, VR1 and VR2, with their
   * slip roads: class 0 of drive.bin), as [first point, last point] of each stretch, flat.
   * A step is on it when most of it runs along it, no other road nearer and running the
   * same way; a short gap (a junction) joins two stretches, and a short stretch (crossing
   * it at a roundabout, a slip road taken past it) is not one.
   */
  expresswayRuns(points: readonly LatLon[]): number[] {
    // The cells by the Via Rápida: elsewhere no point is looked at more closely.
    if (!this.expresswayCells) {
      const cells = new Set<number>();
      for (const [key, edges] of this.cells) {
        if (!edges.some((e) => this.cls[e] === 0)) continue;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) cells.add(key + dy * 1_000_000 + dx);
      }
      this.expresswayCells = cells;
    }
    const byIt = this.expresswayCells;
    const on: boolean[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const d = haversine(a, b);
      const bearing = Math.atan2((b.lon - a.lon) * Math.cos(a.lat * DEG), b.lat - a.lat);
      const n = Math.max(1, Math.ceil(d / EXPRESSWAY_SAMPLE));
      let hits = 0;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
        const cell = cellKey(Math.floor((p.lat + 90) / CELL), Math.floor((p.lon + 180) / CELL));
        if (!byIt.has(cell)) continue;
        let best: RoadHit | undefined;
        for (const hit of this.near(p, EXPRESSWAY_NEAR).values()) {
          // Along it either way (a road's first node may be at either end), not across it.
          if (Math.abs(Math.cos(hit.bearing - bearing)) < EXPRESSWAY_ALONG) continue;
          if (!best || hit.offset < best.offset) best = hit;
        }
        if (best && this.cls[best.edge] === 0) hits++;
      }
      on.push(d > 0 && hits * 2 >= n);
    }
    // Runs of steps, as [first step, last step, on it, metres].
    const runs: [number, number, boolean, number][] = [];
    on.forEach((f, i) => {
      const m = haversine(points[i]!, points[i + 1]!);
      const last = runs.at(-1);
      if (last && last[2] === f) {
        last[1] = i;
        last[3] += m;
      } else runs.push([i, i, f, m]);
    });
    // A short gap between two stretches on it is on it too.
    runs.forEach((r, i) => {
      if (!r[2] && i > 0 && i < runs.length - 1 && r[3] < EXPRESSWAY_GAP) r[2] = true;
    });
    const out: number[] = [];
    let start = -1;
    let metres = 0;
    runs.forEach((r, i) => {
      if (r[2]) {
        if (start < 0) {
          start = r[0];
          metres = 0;
        }
        metres += r[3];
      }
      if (start >= 0 && (!r[2] || i === runs.length - 1)) {
        const end = r[2] ? r[1] : r[0] - 1;
        if (metres >= EXPRESSWAY_MIN) out.push(start, end + 1);
        start = -1;
      }
    });
    return out;
  }
}
