import { haversine, type LatLon } from './geo.ts';
import { decodeWalkGraphData, Heap, type WalkGraphData } from './walk.ts';

/**
 * Driving a car on Madeira's roads, as a maps app does, beside the buses.
 *
 * The roads are the pipeline's drive.bin (the file buses are drawn along): every public
 * road with its class and its one-way rule, in the format of walk.bin; an edge's kind
 * packs its direction (0 both ways, 1 only from its first node to its last, 2 only the
 * other way) and its class: direction + class × 4 (+ the bus's lane × 32).
 */

/** Road classes, fastest first: motorway, primary, secondary, tertiary, minor, service, busway. */
export const ROAD_SPEED_KMH = [75, 50, 42, 35, 28, 14, 40];
export const BOTH_WAYS = 0;
export const FORWARD = 1;
export const BACKWARD = 2;
/** Which way a road may be driven (BOTH_WAYS, FORWARD or BACKWARD). */
export const roadDirection = (kind: number) => kind & 3;
/** The class of a road (an index of ROAD_SPEED_KMH). */
export const roadClass = (kind: number) => (kind >> 2) & 7;
/** How far right of the road's middle a bus drives, in the centre of its lane (m). */
export const roadSide = (kind: number) => (kind >> 5) / 10;

/** A busway: buses only. */
const BUSWAY = 6;
/** The fastest a car goes (m/s), for the search's straight-line estimate. */
const TOP_SPEED = ROAD_SPEED_KMH[0]! / 3.6;
/**
 * Corners, junctions, lights and the town's traffic: a drive takes about this much
 * longer than its roads at their speeds, and parking at the end this many seconds.
 */
const TRAFFIC = 1.15;
const PARKING = 90;
/** A point further than this from any road (m) is not driven to. */
const SNAP = 500;
const CELL = 0.004;
const cellKey = (iy: number, ix: number) => iy * 1_000_000 + ix;

export interface Drive {
  /** From the first point to the second, along the roads. */
  path: LatLon[];
  /** Metres. */
  length: number;
  seconds: number;
}

interface RoadHit {
  edge: number;
  /** Index of the segment of the edge's shape the point is nearest, and how far along it (0–1). */
  seg: number;
  t: number;
  point: LatLon;
  offset: number;
}

export class RoadGraph {
  private readonly data: WalkGraphData;
  /** Each edge's shape from its first node to its last, and its length (m). */
  private readonly shapes: LatLon[][];
  private readonly len: Float64Array;
  /** Metres per second; 0 where a car may not drive. */
  private readonly speed: Float64Array;
  private readonly dir: Uint8Array;
  private readonly adj: number[][];
  private readonly cells = new Map<number, number[]>();

  private constructor(data: WalkGraphData) {
    this.data = data;
    const m = data.edges.length;
    this.shapes = data.edges.map((e) => [data.nodes[e.from]!, ...e.points, data.nodes[e.to]!]);
    this.len = Float64Array.from(this.shapes, (s) =>
      s.slice(1).reduce((sum, p, i) => sum + haversine(s[i]!, p), 0),
    );
    this.speed = new Float64Array(m);
    this.dir = new Uint8Array(m);
    this.adj = data.nodes.map(() => []);
    data.edges.forEach((e, i) => {
      const cls = roadClass(e.kind);
      this.speed[i] = cls === BUSWAY ? 0 : (ROAD_SPEED_KMH[cls] ?? 28) / 3.6;
      this.dir[i] = roadDirection(e.kind);
      this.adj[e.from]!.push(i);
      this.adj[e.to]!.push(i);
      for (const p of this.shapes[i]!) {
        const key = cellKey(Math.floor(p.lat / CELL), Math.floor(p.lon / CELL));
        const list = this.cells.get(key);
        if (!list) this.cells.set(key, [i]);
        else if (list[list.length - 1] !== i) list.push(i);
      }
    });
  }

  static decode(bytes: Uint8Array | ArrayBuffer): RoadGraph {
    return new RoadGraph(
      decodeWalkGraphData(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    );
  }

  /** The nearest place on a road a car may drive, within SNAP metres. */
  private snap(p: LatLon): RoadHit | undefined {
    const span = Math.ceil(SNAP / 111_000 / CELL) + 1;
    const cy = Math.floor(p.lat / CELL);
    const cx = Math.floor(p.lon / CELL);
    const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
    const ky = 110_540;
    let best: RoadHit | undefined;
    const seen = new Set<number>();
    for (let y = cy - span; y <= cy + span; y++) {
      for (let x = cx - span; x <= cx + span; x++) {
        for (const e of this.cells.get(cellKey(y, x)) ?? []) {
          if (seen.has(e) || this.speed[e] === 0) continue;
          seen.add(e);
          const s = this.shapes[e]!;
          for (let j = 1; j < s.length; j++) {
            const a = s[j - 1]!;
            const b = s[j]!;
            const ax = (a.lon - p.lon) * kx;
            const ay = (a.lat - p.lat) * ky;
            const dx = (b.lon - a.lon) * kx;
            const dy = (b.lat - a.lat) * ky;
            const l2 = dx * dx + dy * dy;
            const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
            const offset = Math.hypot(ax + t * dx, ay + t * dy);
            if (offset <= SNAP && (!best || offset < best.offset)) {
              const point = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
              best = { edge: e, seg: j - 1, t, point, offset };
            }
          }
        }
      }
    }
    return best;
  }

  /** Metres along edge e from its first node to a hit on it. */
  private along(hit: RoadHit): number {
    const s = this.shapes[hit.edge]!;
    let d = 0;
    for (let j = 0; j < hit.seg; j++) d += haversine(s[j]!, s[j + 1]!);
    return d + haversine(s[hit.seg]!, hit.point);
  }

  /** Whether edge e may be driven from its first node to its last (`forward`) or back. */
  private allowed(e: number, forward: boolean): boolean {
    const d = this.dir[e]!;
    return this.speed[e]! > 0 && (d === BOTH_WAYS || (forward ? d === FORWARD : d === BACKWARD));
  }

  /** The shape of edge e between two distances along it, in the order driven. */
  private piece(e: number, from: number, to: number): LatLon[] {
    const s = this.shapes[e]!;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const out: LatLon[] = [];
    let d = 0;
    for (let j = 0; j < s.length - 1; j++) {
      const a = s[j]!;
      const b = s[j + 1]!;
      const l = haversine(a, b);
      const at = (x: number) => {
        const t = l > 0 ? (x - d) / l : 0;
        return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
      };
      if (d + l >= lo && d <= hi) {
        if (out.length === 0) out.push(at(Math.max(lo, d)));
        out.push(at(Math.min(hi, d + l)));
      }
      d += l;
    }
    return from <= to ? out : out.reverse();
  }

  /** The quickest drive between two points (undefined off the roads or with no way). */
  route(a: LatLon, b: LatLon): Drive | undefined {
    const start = this.snap(a);
    const end = this.snap(b);
    if (!start || !end) return undefined;
    const sAlong = this.along(start);
    const eAlong = this.along(end);
    const n = this.data.nodes.length;
    const time = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const heap = new Heap();
    const goal = end.point;
    const estimate = (node: number) => haversine(this.data.nodes[node]!, goal) / TOP_SPEED;
    const se = start.edge;
    const sf = this.data.edges[se]!;
    const reach = (node: number, t: number, edge: number) => {
      if (t >= time[node]!) return;
      time[node] = t;
      prev[node] = edge;
      heap.push(node, t + estimate(node));
    };
    // Off the start's edge by either end, as its one-way rule allows.
    if (this.allowed(se, false)) reach(sf.from, sAlong / this.speed[se]!, -1);
    if (this.allowed(se, true)) reach(sf.to, (this.len[se]! - sAlong) / this.speed[se]!, -1);
    let best = Infinity;
    // Along one edge only.
    if (se === end.edge && this.allowed(se, eAlong >= sAlong)) {
      best = Math.abs(eAlong - sAlong) / this.speed[se]!;
    }
    let bestVia: number | undefined;
    const ee = end.edge;
    const ef = this.data.edges[ee]!;
    const intoEnd = (node: number) => {
      if (node === ef.from && this.allowed(ee, true)) return eAlong / this.speed[ee]!;
      if (node === ef.to && this.allowed(ee, false))
        return (this.len[ee]! - eAlong) / this.speed[ee]!;
      return Infinity;
    };
    while (heap.size > 0) {
      if (heap.peekKey() >= best) break;
      const node = heap.pop();
      if (done[node]) continue;
      done[node] = 1;
      const last = time[node]! + intoEnd(node);
      if (last < best) {
        best = last;
        bestVia = node;
      }
      for (const e of this.adj[node]!) {
        const edge = this.data.edges[e]!;
        const forward = edge.from === node;
        if (!this.allowed(e, forward)) continue;
        const other = forward ? edge.to : edge.from;
        if (!done[other]) reach(other, time[node]! + this.len[e]! / this.speed[e]!, e);
      }
    }
    if (!Number.isFinite(best)) return undefined;
    // The way back from the end to the start, edge by edge.
    let path: LatLon[];
    if (bestVia === undefined) {
      path = this.piece(se, sAlong, eAlong);
    } else {
      const tail: LatLon[][] = [this.piece(ee, bestVia === ef.from ? 0 : this.len[ee]!, eAlong)];
      let node = bestVia;
      while (prev[node]! >= 0) {
        const e = prev[node]!;
        const edge = this.data.edges[e]!;
        const forward = edge.to === node;
        tail.push(forward ? this.shapes[e]! : [...this.shapes[e]!].reverse());
        node = forward ? edge.from : edge.to;
      }
      tail.push(this.piece(se, sAlong, node === sf.from ? 0 : this.len[se]!));
      path = tail.reverse().flat();
    }
    path = [a, start.point, ...path, end.point, b].filter(
      (p, i, all) => i === 0 || haversine(all[i - 1]!, p) > 0.5,
    );
    const length = path.slice(1).reduce((sum, p, i) => sum + haversine(path[i]!, p), 0);
    return { path, length, seconds: Math.round(best * TRAFFIC + PARKING) };
  }
}
