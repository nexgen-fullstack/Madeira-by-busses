import { haversine, type LatLon, type WalkGraphData } from '@madeirabus/engine';
import { BACKWARD, FORWARD, ROAD_SPEED_KMH } from './drive.ts';
import { pathLength, simplify } from './walk.ts';

/**
 * Lines along the roads. CAM and SIGA Rodoeste publish no shapes, so the
 * pipeline works out the way a bus most likely drives through a line's stops:
 * each stop is matched to the roads next to it, and the stops are chained by
 * the quickest ways between them so that the bus passes every stop in the
 * direction it drives and never turns round in the middle of a road (a hidden
 * Markov model solved with Viterbi, as map matching does with GPS points).
 */

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
}

/** Roads this close to a stop may be the one it stands on (m). */
const NEAR = 45;
/** A stop further than this from every road is joined by straight lines (m). */
const FAR = 150;
/** Seconds of driving a metre between a stop and its road is worth. */
const OFFSET_WEIGHT = 0.3;
/** Buses seldom stop on an expressway: a stop next to one is more likely on the road beside it (s). */
const EXPRESSWAY_STOP = 30;
/** The fastest a bus goes (m/s), for the A* estimate. */
const VMAX = ROAD_SPEED_KMH[0]! / 3.6;
const CELL = 0.0015;
const DEG = Math.PI / 180;
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

export interface ShapeStats {
  patterns: number;
  /** Stop-to-stop sections drawn along the roads. */
  routed: number;
  /** Sections left straight: a stop far from the roads, or no sensible way between two. */
  straight: number;
}

export class RoadRouter {
  readonly stats: ShapeStats = { patterns: 0, routed: 0, straight: 0 };
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  private readonly from: Uint32Array;
  private readonly to: Uint32Array;
  private readonly dir: Uint8Array;
  private readonly cls: Uint8Array;
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
  private readonly pathCache = new Map<string, LatLon[] | undefined>();

  constructor(data: WalkGraphData) {
    const n = data.nodes.length;
    const m = data.edges.length;
    this.lat = Float64Array.from(data.nodes, (p) => p.lat);
    this.lon = Float64Array.from(data.nodes, (p) => p.lon);
    this.from = new Uint32Array(m);
    this.to = new Uint32Array(m);
    this.dir = new Uint8Array(m);
    this.cls = new Uint8Array(m);
    this.len = new Float64Array(m);
    this.speed = new Float64Array(m);
    this.shapes = [];
    this.cum = [];
    data.edges.forEach((e, i) => {
      this.from[i] = e.from;
      this.to[i] = e.to;
      this.dir[i] = e.kind % 4;
      this.cls[i] = Math.floor(e.kind / 4);
      this.speed[i] = (ROAD_SPEED_KMH[Math.floor(e.kind / 4)] ?? 25) / 3.6;
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

  /** The roads next to a stop, each with the ways a bus may drive past it. */
  private candidates(p: LatLon): Candidate[] {
    const key = `${p.lat},${p.lon}`;
    const cached = this.candidateCache.get(key);
    if (cached) return cached;
    const span = Math.ceil(FAR / 111_000 / CELL / Math.cos(p.lat * DEG)) + 1;
    const cy = Math.floor((p.lat + 90) / CELL);
    const cx = Math.floor((p.lon + 180) / CELL);
    const kx = 111_320 * Math.cos(p.lat * DEG);
    const ky = 110_540;
    const best = new Map<number, { along: number; offset: number; point: LatLon }>();
    for (let y = cy - span; y <= cy + span; y++) {
      for (let x = cx - span; x <= cx + span; x++) {
        for (const e of this.cells.get(cellKey(y, x)) ?? []) {
          if (best.has(e)) continue;
          const pts = this.shapes[e]!;
          const cum = this.cum[e]!;
          let hit: { along: number; offset: number; point: LatLon } | undefined;
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
                along: cum[j - 1]! + t * (cum[j]! - cum[j - 1]!),
                offset,
                point: { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) },
              };
            }
          }
          if (hit && hit.offset <= FAR) best.set(e, hit);
        }
      }
    }
    const sorted = [...best].sort((a, b) => a[1].offset - b[1].offset);
    // The nearest road always; others close by too (a stop between two parallel streets).
    const chosen = sorted.filter(([, h], i) => i === 0 || (h.offset <= NEAR && i < 4));
    const out: Candidate[] = [];
    for (const [edge, h] of chosen) {
      if (this.dir[edge] !== BACKWARD) out.push({ edge, ...h, forward: true });
      if (this.dir[edge] !== FORWARD) out.push({ edge, ...h, forward: false });
    }
    this.candidateCache.set(key, out);
    return out;
  }

  /** What standing at a candidate costs the matching (s). */
  private emission(c: Candidate): number {
    return c.offset * OFFSET_WEIGHT + (this.cls[c.edge] === 0 ? EXPRESSWAY_STOP : 0);
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
      Math.max(0, haversine({ lat: this.lat[node]!, lon: this.lon[node]! }, goal) - 2 * FAR) / VMAX;
    const exit = src.forward ? this.to[src.edge]! : this.from[src.edge]!;
    const first = src.forward
      ? this.secs(src.edge, this.len[src.edge]! - src.along)
      : this.secs(src.edge, src.along);
    this.settle(exit, first, -1, src.forward, heap, h(exit));
    const entries = targets.map((t) => this.entry(t));
    let bestFound = Math.min(...out);
    while (heap.size > 0) {
      const key = heap.peekKey();
      if (key > limit || key > bestFound + 180) break;
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

  /** The road from one candidate to the next, as points (undefined without a way). */
  private path(src: Candidate, dst: Candidate, goal: LatLon, limit: number): LatLon[] | undefined {
    const key = `${src.edge}/${src.along.toFixed(1)}/${src.forward}>${dst.edge}/${dst.along.toFixed(1)}/${dst.forward}`;
    if (this.pathCache.has(key)) return this.pathCache.get(key);
    let result: LatLon[] | undefined;
    const [secs] = this.drive(src, [dst], goal, limit);
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
      if (directSecs <= viaRoads) {
        result = this.slice(src.edge, src.along, dst.along);
      } else {
        // Back from the target's entry node to the source's exit node.
        const tail: LatLon[] = this.slice(
          dst.edge,
          dst.forward ? 0 : this.len[dst.edge]!,
          dst.along,
        );
        const chain: LatLon[][] = [];
        let node = en.node;
        for (let guard = 0; guard < 100_000; guard++) {
          const e = this.prevEdge[node]!;
          if (e < 0) break;
          const fwd = this.prevForward[node] === 1;
          chain.push(fwd ? this.shapes[e]! : [...this.shapes[e]!].reverse());
          node = fwd ? this.from[e]! : this.to[e]!;
        }
        const head = this.slice(src.edge, src.along, src.forward ? this.len[src.edge]! : 0);
        result = [...head, ...chain.reverse().flat(), ...tail];
      }
    }
    this.pathCache.set(key, result);
    return result;
  }

  /**
   * The way along the roads through the stops, or undefined when too few of
   * them are near a road to tell.
   */
  shape(stops: readonly LatLon[]): LatLon[] | undefined {
    this.stats.patterns++;
    const n = stops.length;
    if (n < 2) return undefined;
    const cands = stops.map((s) => this.candidates(s));
    // Viterbi over the candidates, in chains broken where two stops have no way between them.
    const choice: (number | undefined)[] = new Array(n).fill(undefined);
    let chainStart = 0;
    let score: number[] = cands[0]!.map((c) => this.emission(c));
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
      const straight = haversine(stops[i - 1]!, stops[i]!);
      const limit = (straight * 4 + 1500) / 8;
      const next = cur.map(() => Infinity);
      const from = cur.map(() => -1);
      if (prev.length > 0 && cur.length > 0 && straight > 0.5) {
        prev.forEach((p, a) => {
          if (!Number.isFinite(score[a]!)) return;
          const secs = this.drive(p, cur, stops[i]!, limit);
          secs.forEach((s, b) => {
            const total = score[a]! + s + this.emission(cur[b]!);
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
      } else {
        closeChain(i - 1);
        chainStart = i;
        back[i] = [];
        score = cur.map((c) => this.emission(c));
      }
    }
    closeChain(n - 1);

    const out: LatLon[] = [];
    const push = (pts: readonly LatLon[]) => {
      for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.lat - p.lat) > 1e-7 || Math.abs(last.lon - p.lon) > 1e-7) {
          out.push(p);
        }
      }
    };
    let routed = 0;
    for (let i = 0; i < n; i++) {
      const c = choice[i] !== undefined ? cands[i]![choice[i]!] : undefined;
      const prev = i > 0 && choice[i - 1] !== undefined ? cands[i - 1]![choice[i - 1]!] : undefined;
      if (i === 0) {
        push([c?.point ?? stops[0]!]);
        continue;
      }
      const straight = haversine(stops[i - 1]!, stops[i]!);
      let piece: LatLon[] | undefined;
      if (c && prev && back[i]?.length) {
        piece = this.path(prev, c, stops[i]!, (straight * 4 + 1500) / 8);
        // A way much longer than the stops are apart is a wrong road, not a detour.
        if (piece && pathLength(piece) > straight * 4 + 1500) piece = undefined;
      }
      if (piece) {
        routed++;
        this.stats.routed++;
        push(piece);
      } else {
        this.stats.straight++;
        push([c?.point ?? stops[i]!]);
      }
    }
    if (routed === 0) return undefined;
    return simplify(out, 2);
  }
}
