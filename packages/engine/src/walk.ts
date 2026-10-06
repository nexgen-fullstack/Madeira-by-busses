import { haversine, type LatLon } from './geo.ts';

/**
 * Walking along Madeira's streets, steps and footpaths, on the phone.
 *
 * The pipeline turns OpenStreetMap's ways into a compact graph (walk.bin):
 * the junctions and the ways between them with their shape. The planner asks
 * it how far each stop really is on foot from a point — a café across a
 * ravine is not "200 m" from the stop on the other side — and the app draws
 * every walk along the streets instead of as the crow flies.
 */

/** "MBW1": the file format and its version. */
const MAGIC = [0x4d, 0x42, 0x57, 0x31];
/** Coordinates are stored in 1e-5 degree (about a metre). */
const Q = 1e5;

/** Kinds of way, which take different time per metre. */
export const WALK_STREET = 0;
export const WALK_STEPS = 1;
export const WALK_PATH = 2;
/** How long a metre takes on each kind of way, relative to a pavement. */
const KIND_COST = [1, 1.6, 1.15];
/**
 * An edge's kind packs how it walks (WALK_STREET, WALK_STEPS, WALK_PATH) and,
 * along a road, how far the road's pavement is from its middle in decimetres:
 * kind + kerb × 4. A walk along the road is drawn there, not down its middle.
 */
export const walkWay = (kind: number) => kind & 3;
/** How far a road's pavement is from its middle (m); 0 on footways, steps and paths. */
export const walkKerb = (kind: number) => (kind >> 2) / 10;
/** The furthest a pavement is kept from the middle of a road (m): what fits in a kind. */
export const MAX_KERB = 6.3;

export interface WalkGraphData {
  /** Junctions and dead ends. */
  nodes: LatLon[];
  /** Ways between two nodes; `points` is the shape in between. */
  edges: { from: number; to: number; kind: number; points: LatLon[] }[];
}

/** Where a point meets the walkable ways. */
export interface WalkHit {
  edge: number;
  /** Metres from the edge's first node. */
  along: number;
  /** Metres between the point and the way. */
  offset: number;
  point: LatLon;
}

export interface WalkDistance {
  /** Metres along the ways, plus the steps on and off them. */
  length: number;
  /** The same in metres of level pavement: steps and paths count for more. */
  cost: number;
}

export interface WalkRoute extends WalkDistance {
  /** From the first point to the second, along the ways. */
  path: LatLon[];
  /**
   * For each step of `path` (from a point to the next), how far the pavement
   * is from the middle of the road there (m); 0 off the roads.
   */
  kerb: number[];
}

// ---------- Encoding ----------

class Writer {
  private buf = new Uint8Array(1 << 16);
  private n = 0;

  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  byte(b: number) {
    this.room(1);
    this.buf[this.n++] = b;
  }

  uint(v: number) {
    this.room(10);
    while (v >= 0x80) {
      this.buf[this.n++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.n++] = v;
  }

  int(v: number) {
    this.uint(v < 0 ? -2 * v - 1 : 2 * v);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.buf.length) throw new Error('Walk graph is truncated');
    return this.buf[this.pos++]!;
  }

  uint(): number {
    let v = 0;
    let scale = 1;
    for (;;) {
      const b = this.byte();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
    }
  }

  int(): number {
    const u = this.uint();
    return u % 2 === 1 ? -(u + 1) / 2 : u / 2;
  }
}

/** The graph as walk.bin bytes: varints, coordinates as differences from the previous one. */
export function encodeWalkGraph(data: WalkGraphData): Uint8Array {
  const w = new Writer();
  for (const b of MAGIC) w.byte(b);
  w.uint(data.nodes.length);
  w.uint(data.edges.length);
  const q = data.nodes.map((n) => [Math.round(n.lat * Q), Math.round(n.lon * Q)] as const);
  let lat = 0;
  let lon = 0;
  for (const [a, b] of q) {
    w.int(a - lat);
    w.int(b - lon);
    lat = a;
    lon = b;
  }
  const edges = [...data.edges].sort((a, b) => a.from - b.from || a.to - b.to);
  let from = 0;
  for (const e of edges) {
    w.uint(e.from - from);
    from = e.from;
    w.int(e.to - e.from);
    w.uint(e.kind);
    w.uint(e.points.length);
    [lat, lon] = q[e.from]!;
    for (const p of e.points) {
      const a = Math.round(p.lat * Q);
      const b = Math.round(p.lon * Q);
      w.int(a - lat);
      w.int(b - lon);
      lat = a;
      lon = b;
    }
  }
  return w.finish();
}

/** The nodes and edges of walk.bin bytes (or a file in the same format, like drive.bin). */
export function decodeWalkGraphData(bytes: Uint8Array): WalkGraphData {
  const r = new Reader(bytes);
  for (const b of MAGIC) if (r.byte() !== b) throw new Error('Not a walk graph');
  const n = r.uint();
  const m = r.uint();
  const q: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < n; i++) {
    lat += r.int();
    lon += r.int();
    q.push([lat, lon]);
  }
  const nodes = q.map(([a, b]) => ({ lat: a / Q, lon: b / Q }));
  const edges: WalkGraphData['edges'] = [];
  let from = 0;
  for (let e = 0; e < m; e++) {
    from += r.uint();
    const to = from + r.int();
    if (from >= n || to < 0 || to >= n) throw new Error('Walk graph edge out of range');
    const kind = r.uint();
    const k = r.uint();
    [lat, lon] = q[from]!;
    const points: LatLon[] = [];
    for (let j = 0; j < k; j++) {
      lat += r.int();
      lon += r.int();
      points.push({ lat: lat / Q, lon: lon / Q });
    }
    edges.push({ from, to, kind, points });
  }
  return { nodes, edges };
}

// ---------- The graph ----------

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

const CELL = 0.0015; // degrees: ~170 m north–south, ~140 m east–west on Madeira
const cellKey = (iy: number, ix: number) => iy * 1_000_000 + ix;
const DEG = Math.PI / 180;

export class WalkGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  private readonly from: Uint32Array;
  private readonly to: Uint32Array;
  private readonly kind: Uint8Array;
  /** Metres. */
  private readonly len: Float64Array;
  /** Edge e's inner points are geo[geoStart[e] .. geoStart[e + 1]). */
  private readonly geoStart: Uint32Array;
  private readonly geoLat: Float64Array;
  private readonly geoLon: Float64Array;
  private readonly adjStart: Uint32Array;
  private readonly adjEdge: Uint32Array;
  private readonly cells = new Map<number, number[]>();
  // Search state, reused between searches: a node's values count when stamp === run.
  private readonly cost: Float64Array;
  private readonly length: Float64Array;
  private readonly prev: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly done: Uint32Array;
  private run = 0;

  private constructor(bytes: Uint8Array) {
    const r = new Reader(bytes);
    for (const b of MAGIC) if (r.byte() !== b) throw new Error('Not a walk graph');
    const n = r.uint();
    const m = r.uint();
    this.nodeCount = n;
    this.edgeCount = m;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    const qLat = new Int32Array(n);
    const qLon = new Int32Array(n);
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      a += r.int();
      b += r.int();
      qLat[i] = a;
      qLon[i] = b;
      this.lat[i] = a / Q;
      this.lon[i] = b / Q;
    }
    this.from = new Uint32Array(m);
    this.to = new Uint32Array(m);
    this.kind = new Uint8Array(m);
    this.len = new Float64Array(m);
    this.geoStart = new Uint32Array(m + 1);
    const gLat: number[] = [];
    const gLon: number[] = [];
    let from = 0;
    for (let e = 0; e < m; e++) {
      from += r.uint();
      const to = from + r.int();
      if (from >= n || to < 0 || to >= n) throw new Error('Walk graph edge out of range');
      this.from[e] = from;
      this.to[e] = to;
      this.kind[e] = r.uint();
      const k = r.uint();
      this.geoStart[e] = gLat.length;
      let pa = qLat[from]!;
      let pb = qLon[from]!;
      let prev: LatLon = { lat: this.lat[from]!, lon: this.lon[from]! };
      let length = 0;
      for (let j = 0; j < k; j++) {
        pa += r.int();
        pb += r.int();
        const p = { lat: pa / Q, lon: pb / Q };
        gLat.push(p.lat);
        gLon.push(p.lon);
        length += haversine(prev, p);
        prev = p;
      }
      this.len[e] = length + haversine(prev, { lat: this.lat[to]!, lon: this.lon[to]! });
    }
    this.geoStart[m] = gLat.length;
    this.geoLat = Float64Array.from(gLat);
    this.geoLon = Float64Array.from(gLon);

    // Both directions of every edge, grouped by node.
    const degree = new Uint32Array(n + 1);
    for (let e = 0; e < m; e++) {
      degree[this.from[e]!]!++;
      degree[this.to[e]!]!++;
    }
    this.adjStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i]! + degree[i]!;
    this.adjEdge = new Uint32Array(2 * m);
    const fill = this.adjStart.slice(0, n);
    for (let e = 0; e < m; e++) {
      this.adjEdge[fill[this.from[e]!]!++] = e;
      this.adjEdge[fill[this.to[e]!]!++] = e;
    }

    // Every edge in each grid cell its segments cross.
    for (let e = 0; e < m; e++) {
      const pts = this.points(e);
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
    this.length = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.done = new Uint32Array(n);
  }

  static decode(bytes: Uint8Array | ArrayBuffer): WalkGraph {
    return new WalkGraph(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  /** An edge's shape from its first node to its last. */
  points(e: number): LatLon[] {
    const out: LatLon[] = [{ lat: this.lat[this.from[e]!]!, lon: this.lon[this.from[e]!]! }];
    for (let j = this.geoStart[e]!; j < this.geoStart[e + 1]!; j++) {
      out.push({ lat: this.geoLat[j]!, lon: this.geoLon[j]! });
    }
    out.push({ lat: this.lat[this.to[e]!]!, lon: this.lon[this.to[e]!]! });
    return out;
  }

  /** The nearest place on a walkable way, if one is within `max` metres. */
  snap(p: LatLon, max = 300): WalkHit | undefined {
    const span = Math.ceil(max / 111_000 / CELL / Math.cos(p.lat * DEG)) + 1;
    const cy = Math.floor((p.lat + 90) / CELL);
    const cx = Math.floor((p.lon + 180) / CELL);
    const seen = new Set<number>();
    const kx = 111_320 * Math.cos(p.lat * DEG);
    const ky = 110_540;
    let best: WalkHit | undefined;
    for (let y = cy - span; y <= cy + span; y++) {
      for (let x = cx - span; x <= cx + span; x++) {
        for (const e of this.cells.get(cellKey(y, x)) ?? []) {
          if (seen.has(e)) continue;
          seen.add(e);
          // Segments from the first node through the inner points to the last node,
          // in metres around p; `along` is measured the same way and scaled to the
          // edge's true length at the end.
          const g0 = this.geoStart[e]!;
          const g1 = this.geoStart[e + 1]!;
          let aLat = this.lat[this.from[e]!]!;
          let aLon = this.lon[this.from[e]!]!;
          let along = 0;
          for (let j = g0; j <= g1; j++) {
            const bLat = j < g1 ? this.geoLat[j]! : this.lat[this.to[e]!]!;
            const bLon = j < g1 ? this.geoLon[j]! : this.lon[this.to[e]!]!;
            const ax = (aLon - p.lon) * kx;
            const ay = (aLat - p.lat) * ky;
            const dx = (bLon - aLon) * kx;
            const dy = (bLat - aLat) * ky;
            const seg = Math.hypot(dx, dy);
            const t = seg === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (seg * seg)));
            const offset = Math.hypot(ax + t * dx, ay + t * dy);
            if (offset <= max && (!best || offset < best.offset)) {
              best = {
                edge: e,
                along: along + t * seg,
                offset,
                point: { lat: aLat + t * (bLat - aLat), lon: aLon + t * (bLon - aLon) },
              };
            }
            along += seg;
            aLat = bLat;
            aLon = bLon;
          }
        }
      }
    }
    if (best) best.along = Math.max(0, Math.min(best.along, this.len[best.edge]!));
    return best;
  }

  private factor(e: number): number {
    return KIND_COST[walkWay(this.kind[e]!)] ?? 1;
  }

  private settle(
    node: number,
    cost: number,
    length: number,
    prev: number,
    heap: Heap,
    estimate = 0,
  ) {
    if (this.stamp[node] === this.run && this.cost[node]! <= cost) return;
    this.stamp[node] = this.run;
    this.cost[node] = cost;
    this.length[node] = length;
    this.prev[node] = prev;
    heap.push(node, cost + estimate);
  }

  /** Starts a search at a point on an edge: both ends of that edge. */
  private seed(start: WalkHit, heap: Heap, goal?: LatLon) {
    this.run++;
    const e = start.edge;
    const f = this.factor(e);
    const rest = this.len[e]! - start.along;
    const a = this.from[e]!;
    const b = this.to[e]!;
    this.settle(a, start.along * f, start.along, -1, heap, goal ? this.straight(a, goal) : 0);
    this.settle(b, rest * f, rest, -1, heap, goal ? this.straight(b, goal) : 0);
  }

  /** Expands the cheapest node; returns it, or -1 when it was already done. */
  private step(heap: Heap): number {
    const node = heap.pop();
    if (this.done[node] === this.run) return -1;
    this.done[node] = this.run;
    const c = this.cost[node]!;
    const l = this.length[node]!;
    for (let i = this.adjStart[node]!; i < this.adjStart[node + 1]!; i++) {
      const e = this.adjEdge[i]!;
      const other = this.from[e] === node ? this.to[e]! : this.from[e]!;
      if (this.done[other] === this.run) continue;
      this.settle(other, c + this.len[e]! * this.factor(e), l + this.len[e]!, e, heap);
    }
    return node;
  }

  /** The way from a reached edge end to a point on that edge. */
  private finish(target: WalkHit, start: WalkHit): WalkDistance | undefined {
    const e = target.edge;
    const f = this.factor(e);
    let best: WalkDistance | undefined;
    const consider = (cost: number, length: number) => {
      if (!best || cost < best.cost) best = { cost, length };
    };
    const a = this.from[e]!;
    const b = this.to[e]!;
    if (this.done[a] === this.run) {
      consider(this.cost[a]! + target.along * f, this.length[a]! + target.along);
    }
    if (this.done[b] === this.run) {
      const rest = this.len[e]! - target.along;
      consider(this.cost[b]! + rest * f, this.length[b]! + rest);
    }
    if (e === start.edge) {
      const d = Math.abs(target.along - start.along);
      consider(d * f, d);
    }
    if (!best) return undefined;
    const off = start.offset + target.offset;
    return { cost: best.cost + off, length: best.length + off };
  }

  /**
   * Walking from one point on the ways to each of `targets` (also points on
   * the ways), as far as `max` metres of level pavement; undefined where a
   * target is further.
   */
  distances(
    start: WalkHit,
    targets: readonly WalkHit[],
    max: number,
  ): (WalkDistance | undefined)[] {
    const heap = new Heap();
    this.seed(start, heap);
    while (heap.size > 0 && heap.peekKey() <= max) this.step(heap);
    return targets.map((t) => {
      const d = this.finish(t, start);
      return d && d.cost <= max ? d : undefined;
    });
  }

  /** The best walk between two points, along the ways (undefined off the network). */
  route(a: LatLon, b: LatLon, maxSnap = 300): WalkRoute | undefined {
    const start = this.snap(a, maxSnap);
    const end = this.snap(b, maxSnap);
    if (!start || !end) return undefined;
    // A*: a straight line never overestimates a walk, so the first way found is the best.
    const goal = end.point;
    const astar = new Heap();
    this.seed(start, astar, goal);
    let best: WalkDistance | undefined =
      start.edge === end.edge ? this.finish(end, start) : undefined;
    while (astar.size > 0) {
      if (best && astar.peekKey() >= best.cost - start.offset - end.offset) break;
      const node = astar.pop();
      if (this.done[node] === this.run) continue;
      this.done[node] = this.run;
      if (node === this.from[end.edge] || node === this.to[end.edge]) {
        const d = this.finish(end, start);
        if (d && (!best || d.cost < best.cost)) best = d;
      }
      const c = this.cost[node]!;
      const l = this.length[node]!;
      for (let i = this.adjStart[node]!; i < this.adjStart[node + 1]!; i++) {
        const e = this.adjEdge[i]!;
        const other = this.from[e] === node ? this.to[e]! : this.from[e]!;
        if (this.done[other] === this.run) continue;
        const nc = c + this.len[e]! * this.factor(e);
        this.settle(other, nc, l + this.len[e]!, e, astar, this.straight(other, goal));
      }
    }
    if (!best) return undefined;
    return { ...best, ...this.trace(start, end, a, b) };
  }

  private straight(node: number, p: LatLon): number {
    return haversine({ lat: this.lat[node]!, lon: this.lon[node]! }, p);
  }

  /** The points of the best walk found by the last route() call, and its pavements. */
  private trace(
    start: WalkHit,
    end: WalkHit,
    a: LatLon,
    b: LatLon,
  ): { path: LatLon[]; kerb: number[] } {
    // Built from the end back; kerbs[i] is the step between tail[i] and tail[i + 1].
    const tail: LatLon[] = [b, end.point];
    const kerbs: number[] = [0];
    const add = (points: readonly LatLon[], kerb: number) => {
      for (const p of points) {
        tail.push(p);
        kerbs.push(kerb);
      }
    };
    const kerbOf = (edge: number) => walkKerb(this.kind[edge]!);
    const e = end.edge;
    const f = this.factor(e);
    // Which end of the last edge did the walk come in by, or did it stay on one edge?
    const viaFrom =
      this.done[this.from[e]!] === this.run
        ? this.cost[this.from[e]!]! + end.along * f
        : Number.POSITIVE_INFINITY;
    const viaTo =
      this.done[this.to[e]!] === this.run
        ? this.cost[this.to[e]!]! + (this.len[e]! - end.along) * f
        : Number.POSITIVE_INFINITY;
    const direct =
      e === start.edge ? Math.abs(end.along - start.along) * f : Number.POSITIVE_INFINITY;
    if (direct <= viaFrom && direct <= viaTo) {
      const along = this.slice(e, start.along, end.along);
      return dedupe([a, ...along, b], [0, ...along.slice(1).map(() => kerbOf(e)), 0]);
    }
    let node: number;
    if (viaFrom <= viaTo) {
      add(this.slice(e, end.along, 0).slice(1), kerbOf(e));
      node = this.from[e]!;
    } else {
      add(this.slice(e, end.along, this.len[e]!).slice(1), kerbOf(e));
      node = this.to[e]!;
    }
    for (;;) {
      const pe = this.prev[node]!;
      if (pe < 0) break;
      // Walking back over the edge that brought us here.
      const forward = this.to[pe] === node;
      const pts = this.points(pe);
      if (forward) pts.reverse();
      add(pts.slice(1), kerbOf(pe));
      node = forward ? this.from[pe]! : this.to[pe]!;
    }
    // node is an end of the start edge: walk from the start point to it.
    const toEnd = node === this.from[start.edge] ? 0 : this.len[start.edge]!;
    add(this.slice(start.edge, start.along, toEnd).reverse().slice(1), kerbOf(start.edge));
    add([a], 0);
    // The same steps the other way round.
    return dedupe(tail.reverse(), kerbs.reverse());
  }

  /** Points of edge e from `a0` to `a1` metres along it (either direction). */
  private slice(e: number, a0: number, a1: number): LatLon[] {
    const pts = this.points(e);
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1]! + haversine(pts[j - 1]!, pts[j]!));
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
}

/** A path without points repeated, and the pavement of each of its steps. */
function dedupe(points: LatLon[], kerbs: number[]): { path: LatLon[]; kerb: number[] } {
  const path: LatLon[] = [];
  const kerb: number[] = [];
  points.forEach((p, i) => {
    const last = path[path.length - 1];
    if (!last) path.push(p);
    else if (Math.abs(last.lat - p.lat) > 1e-7 || Math.abs(last.lon - p.lon) > 1e-7) {
      path.push(p);
      kerb.push(kerbs[i - 1] ?? 0);
    }
  });
  return { path, kerb };
}
