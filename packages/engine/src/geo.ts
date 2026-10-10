/** Geometry helpers tuned for a small region (Madeira spans ~60 km), so a local
 * equirectangular projection is accurate to well under a metre per kilometre. */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Projects lat/lon to local metres around a reference latitude. */
function toLocal(p: LatLon, refLat: number): [number, number] {
  return [p.lon * DEG * EARTH_RADIUS_M * Math.cos(refLat * DEG), p.lat * DEG * EARTH_RADIUS_M];
}

/** Cumulative distance (m) at each vertex of a polyline; first entry is 0. */
export function cumulativeDistances(points: readonly LatLon[]): number[] {
  const out = new Array<number>(points.length);
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += haversine(points[i - 1]!, points[i]!);
    out[i] = acc;
  }
  return out;
}

export interface Projection {
  /** Distance along the polyline (m) of the closest point. */
  along: number;
  /** Distance from the query point to the polyline (m). */
  offset: number;
  /** Index of the segment [i, i+1] containing the closest point. */
  segment: number;
  point: LatLon;
}

/**
 * Projects a point onto a polyline. `fromSegment`/`toSegment` restrict the
 * search window, which keeps tracking stable on routes that loop back on
 * themselves (common on Madeira's hairpin roads).
 */
export function projectOnPolyline(
  points: readonly LatLon[],
  cumDist: readonly number[],
  p: LatLon,
  fromSegment = 0,
  toSegment = points.length - 2,
): Projection {
  if (points.length === 1) {
    return { along: 0, offset: haversine(points[0]!, p), segment: 0, point: points[0]! };
  }
  const lo = Math.max(0, fromSegment);
  const hi = Math.min(points.length - 2, toSegment);
  const [px, py] = toLocal(p, p.lat);
  let best: Projection | undefined;
  for (let i = lo; i <= hi; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const [ax, ay] = toLocal(a, p.lat);
    const [bx, by] = toLocal(b, p.lat);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const offset = Math.hypot(px - cx, py - cy);
    if (!best || offset < best.offset) {
      const segLen = cumDist[i + 1]! - cumDist[i]!;
      best = {
        along: cumDist[i]! + t * segLen,
        offset,
        segment: i,
        point: { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) },
      };
    }
  }
  return best!;
}

/** Farther than this (m) from a line, a pass of it is no place for a stop. */
const STOP_REACH = 200;
/** What leaving a stop off the line costs (m off it): one listed out of its order. */
const STOP_SKIP = 150;
/** The closest passes of a line looked at for each stop. */
const STOP_PASSES = 8;

/**
 * Where each of `stops`, in the order the bus calls at them, lies along a line (m, never
 * going back): the passes of the line that keep them in order closest to them overall. A
 * road the bus goes up and comes back down holds each stop on its own pass, and a stop
 * listed out of its order (the timetable calls at a stop of the way back on the way up)
 * is left where its neighbours put it, rather than pulling every stop after it onto the
 * way back.
 */
export function stopsAlong(
  points: readonly LatLon[],
  cumDist: readonly number[],
  stops: readonly LatLon[],
): number[] {
  if (stops.length === 0) return [];
  if (points.length < 2) return stops.map(() => 0);
  const last = points.length - 2;
  // Each stop's passes: the nearest point of each stretch of the line coming close to it.
  const passes = stops.map((s) => {
    const all: Projection[] = [];
    for (let i = 0; i <= last; i++) all.push(projectOnPolyline(points, cumDist, s, i, i));
    const near = all.filter(
      (p, i) =>
        p.offset <= STOP_REACH &&
        p.offset <= (all[i - 1]?.offset ?? Infinity) &&
        p.offset < (all[i + 1]?.offset ?? Infinity),
    );
    return near
      .sort((a, b) => a.offset - b.offset)
      .slice(0, STOP_PASSES)
      .sort((a, b) => a.along - b.along);
  });
  // The cheapest way through them in order (dynamic programming): each stop on one of its
  // passes, at or after the stop before it, or left off at a cost.
  const cost: number[][] = [];
  const back: ([number, number] | undefined)[][] = [];
  stops.forEach((_, i) => {
    cost.push([]);
    back.push([]);
    passes[i]!.forEach((p, c) => {
      let best = STOP_SKIP * i + p.offset;
      let from: [number, number] | undefined;
      for (let j = 0; j < i; j++) {
        passes[j]!.forEach((q, d) => {
          if (q.along > p.along) return;
          const via = cost[j]![d]! + STOP_SKIP * (i - j - 1) + p.offset;
          if (via < best) {
            best = via;
            from = [j, d];
          }
        });
      }
      cost[i]![c] = best;
      back[i]![c] = from;
    });
  });
  let end: [number, number] | undefined;
  let total = STOP_SKIP * stops.length;
  cost.forEach((row, i) =>
    row.forEach((v, c) => {
      const all = v + STOP_SKIP * (stops.length - 1 - i);
      if (all < total) {
        total = all;
        end = [i, c];
      }
    }),
  );
  const chosen: (Projection | undefined)[] = stops.map(() => undefined);
  for (let at = end; at; at = back[at[0]]![at[1]]) chosen[at[0]] = passes[at[0]]![at[1]];
  // A stop left off: its nearest point between the stops on either side of it.
  const out: number[] = [];
  stops.forEach((s, i) => {
    const prev = out[i - 1] ?? 0;
    let along = chosen[i]?.along;
    if (along === undefined) {
      const next = chosen.slice(i + 1).find((x) => x !== undefined);
      const p = projectOnPolyline(
        points,
        cumDist,
        s,
        segmentAt(cumDist, prev),
        next ? next.segment : last,
      );
      along = Math.min(p.along, next ? next.along : Infinity);
    }
    out.push(Math.max(prev, along));
  });
  return out;
}

/** The segment of a polyline a distance along it falls on. */
function segmentAt(cumDist: readonly number[], d: number): number {
  let i = 0;
  while (i + 2 < cumDist.length && cumDist[i + 1]! <= d) i++;
  return i;
}

/** Point at a given distance along a polyline (clamped to its ends). */
export function pointAlong(
  points: readonly LatLon[],
  cumDist: readonly number[],
  d: number,
): LatLon {
  if (d <= 0) return points[0]!;
  const total = cumDist[cumDist.length - 1]!;
  if (d >= total) return points[points.length - 1]!;
  let lo = 0;
  let hi = cumDist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const seg = cumDist[hi]! - cumDist[lo]!;
  const t = seg === 0 ? 0 : (d - cumDist[lo]!) / seg;
  const a = points[lo]!;
  const b = points[hi]!;
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
}

/** The part of a polyline between two distances along it. */
export function slicePolyline(
  points: readonly LatLon[],
  cumDist: readonly number[],
  from: number,
  to: number,
): LatLon[] {
  const out = [pointAlong(points, cumDist, from)];
  for (let i = 0; i < points.length; i++) {
    if (cumDist[i]! > from && cumDist[i]! < to) out.push(points[i]!);
  }
  out.push(pointAlong(points, cumDist, to));
  return out;
}

/** Google encoded polyline (precision 5). */
export function encodePolyline(points: readonly LatLon[]): string {
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    out += encodeValue(lat - prevLat) + encodeValue(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

export function decodePolyline(encoded: string): LatLon[] {
  const out: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  while (i < encoded.length) {
    for (let axis = 0; axis < 2; axis++) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    out.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return out;
}

/** Uniform grid index for "stops near a point" queries. */
export class GridIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly cellDeg: number;

  constructor(
    private readonly points: readonly LatLon[],
    cellMetres = 500,
  ) {
    this.cellDeg = cellMetres / 111_000;
    points.forEach((p, i) => {
      const key = this.key(p.lat, p.lon);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    });
  }

  private key(lat: number, lon: number): string {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }

  /** Indices within `radius` metres, nearest first. */
  within(p: LatLon, radius: number): { index: number; distance: number }[] {
    const latSpan = Math.ceil(radius / 111_000 / this.cellDeg);
    const lonSpan = Math.ceil(radius / (111_000 * Math.cos(p.lat * DEG)) / this.cellDeg);
    const cy = Math.floor(p.lat / this.cellDeg);
    const cx = Math.floor(p.lon / this.cellDeg);
    const out: { index: number; distance: number }[] = [];
    for (let y = cy - latSpan; y <= cy + latSpan; y++) {
      for (let x = cx - lonSpan; x <= cx + lonSpan; x++) {
        for (const i of this.cells.get(`${y}:${x}`) ?? []) {
          const distance = haversine(p, this.points[i]!);
          if (distance <= radius) out.push({ index: i, distance });
        }
      }
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** The `n` nearest indices regardless of radius (expanding search). */
  nearest(p: LatLon, n: number, maxRadius = 20_000): { index: number; distance: number }[] {
    for (let r = 500; r <= maxRadius; r *= 2) {
      const hits = this.within(p, r);
      if (hits.length >= n) return hits.slice(0, n);
    }
    return this.within(p, maxRadius).slice(0, n);
  }
}

/**
 * Walking time in seconds. Madeira is steep, so when both elevations are
 * known we scale the flat walking speed with Tobler's hiking function
 * (6·e^(-3.5·|slope+0.05|) km/h, normalised to 1 on the flat).
 */
export function walkSeconds(
  distance: number,
  speed: number,
  fromEle?: number,
  toEle?: number,
  detour = 1.25,
): number {
  const d = distance * detour;
  if (d === 0) return 0;
  let factor = 1;
  if (fromEle !== undefined && toEle !== undefined) {
    const slope = (toEle - fromEle) / d;
    const tobler = Math.exp(-3.5 * Math.abs(slope + 0.05));
    const flat = Math.exp(-3.5 * 0.05);
    factor = Math.max(0.15, tobler / flat);
  }
  return Math.round(d / (speed * factor));
}
