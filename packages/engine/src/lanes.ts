import { haversine, pointAlong, type LatLon } from './geo.ts';

/**
 * Lines on their side of the road. A line's points follow the middle of the
 * roads it takes, as OpenStreetMap draws them; each step from one point to the
 * next carries how far right of that middle the line runs — a bus in the
 * centre of its lane (traffic keeps right), a walk on the pavement — and the
 * map draws the line moved over by that much, in metres, so it stays in its
 * lane however close the map comes.
 */

/**
 * The sides of a line's steps as text, in decimetres, runs of one side
 * written once with how many steps: "16*12,0*3,14" is 1.6 m for twelve steps,
 * none for three, 1.4 m for one. Empty when no step is moved.
 */
export function encodeSides(sides: readonly number[]): string {
  if (sides.every((s) => Math.round(s * 10) === 0)) return '';
  const runs: string[] = [];
  let i = 0;
  while (i < sides.length) {
    const dm = Math.round(sides[i]! * 10);
    let j = i + 1;
    while (j < sides.length && Math.round(sides[j]! * 10) === dm) j++;
    runs.push(j - i === 1 ? String(dm) : `${dm}*${j - i}`);
    i = j;
  }
  return runs.join(',');
}

/** The sides of `steps` steps from `encodeSides` text (metres; none where it says nothing). */
export function decodeSides(text: string | undefined, steps: number): number[] {
  const out: number[] = [];
  for (const run of (text ?? '').split(',')) {
    if (!run) continue;
    const [dm, count = '1'] = run.split('*');
    const side = Number(dm) / 10;
    for (let k = Number(count); k > 0 && out.length < steps; k--) out.push(side);
  }
  while (out.length < steps) out.push(0);
  return out;
}

/** The part of a line between two distances along it, with the sides of its steps. */
export function sliceSided(
  points: readonly LatLon[],
  cumDist: readonly number[],
  sides: readonly number[],
  from: number,
  to: number,
): { points: LatLon[]; sides: number[] } {
  // The step a distance falls in, the last whose start lies before it.
  const stepAt = (d: number) => {
    let i = 0;
    while (i < points.length - 2 && cumDist[i + 1]! < d) i++;
    return i;
  };
  const out = [pointAlong(points, cumDist, from)];
  const outSides: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (cumDist[i]! > from && cumDist[i]! < to) {
      out.push(points[i]!);
      outSides.push(sides[i - 1] ?? 0);
    }
  }
  out.push(pointAlong(points, cumDist, to));
  outSides.push(sides[stepAt(to)] ?? 0);
  return { points: out, sides: outSides };
}

/** A sharper turn than this (cosine of the angle between the steps) is cut off on its outside. */
const SHARP = -0.2;

/**
 * A line moved right of itself by each step's side (metres; left when
 * negative). Where two steps on the same side meet, the corner is mitred, cut
 * off on the outside of a sharp turn; where a step on no side meets one that
 * is moved, the corner goes with the moved one; where two sides differ, it
 * goes halfway, so the line eases from one lane to the other.
 */
export function offsetPolyline(points: readonly LatLon[], sides: readonly number[]): LatLon[] {
  if (points.length < 2 || sides.every((s) => s === 0)) return points.slice();
  const lat0 = points[0]!.lat;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const xy = points.map((p) => [p.lon * kx, p.lat * ky] as const);
  // Each step's direction (a step of no length takes its neighbour's).
  const dirs: ([number, number] | undefined)[] = [];
  for (let i = 0; i + 1 < xy.length; i++) {
    const dx = xy[i + 1]![0] - xy[i]![0];
    const dy = xy[i + 1]![1] - xy[i]![1];
    const len = Math.hypot(dx, dy);
    dirs.push(len > 1e-6 ? [dx / len, dy / len] : undefined);
  }
  for (let i = 1; i < dirs.length; i++) dirs[i] ??= dirs[i - 1];
  for (let i = dirs.length - 2; i >= 0; i--) dirs[i] ??= dirs[i + 1];
  if (!dirs[0]) return points.slice();
  const toLatLon = (x: number, y: number): LatLon => ({ lat: y / ky, lon: x / kx });
  // The right of a step heading (dx, dy) is (dy, -dx).
  const moved = (i: number, d: number, side: number): LatLon => {
    const [dx, dy] = dirs[d]!;
    return toLatLon(xy[i]![0] + dy * side, xy[i]![1] - dx * side);
  };
  const out: LatLon[] = [moved(0, 0, sides[0] ?? 0)];
  for (let i = 1; i < points.length - 1; i++) {
    const a = sides[i - 1] ?? 0;
    const b = sides[i] ?? 0;
    if (a === 0 && b === 0) {
      out.push(points[i]!);
      continue;
    }
    if (a === 0 || b === 0) {
      out.push(a === 0 ? moved(i, i, b) : moved(i, i - 1, a));
      continue;
    }
    const [d1x, d1y] = dirs[i - 1]!;
    const [d2x, d2y] = dirs[i]!;
    const side = (a + b) / 2;
    const cos = d1x * d2x + d1y * d2y;
    // Turning towards the side the line is moved to: the inside of the bend.
    const cross = d1x * d2y - d1y * d2x;
    const inside = cross < 0 === side > 0;
    if (cos < SHARP && !inside) {
      out.push(moved(i, i - 1, a), moved(i, i, b));
      continue;
    }
    // The mitre: along the sum of the two normals, as far as keeps the side from both steps.
    const nx = d1y + d2y;
    const ny = -d1x - d2x;
    const nlen = Math.hypot(nx, ny);
    if (nlen < 1e-6) {
      out.push(moved(i, i - 1, a));
      continue;
    }
    const along = Math.min(Math.abs(side) * 2.5, Math.abs(side) / (nlen / 2)) * Math.sign(side);
    out.push(toLatLon(xy[i]![0] + (nx / nlen) * along, xy[i]![1] + (ny / nlen) * along));
  }
  const last = points.length - 1;
  out.push(moved(last, last - 1, sides[last - 1] ?? 0));
  return out;
}

/** A turn sharper than this (degrees) is a corner: another street. */
const CORNER = 50;

/**
 * Which way a walk keeps to the pavement on each step along a road: the
 * kerb's distance (metres, from `kerb`), right of the way one walks — but
 * along the street it starts on, on the side of the place it starts from, and
 * along the street it ends on, on the side of the place it goes to: a walk to
 * a bus stop comes along the stop's own pavement, not across the road.
 */
export function pavementSides(path: readonly LatLon[], kerb: readonly number[]): number[] {
  const sides = kerb.map((k) => k);
  const steps = kerb.length;
  if (steps === 0 || path.length !== steps + 1) return sides;
  const lat0 = path[0]!.lat;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const vec = (a: LatLon, b: LatLon) => [(b.lon - a.lon) * kx, (b.lat - a.lat) * ky] as const;
  const heading = (i: number) => {
    const [dx, dy] = vec(path[i]!, path[i + 1]!);
    return Math.atan2(dx, dy);
  };
  const turn = (i: number, j: number) => {
    let d = Math.abs(heading(i) - heading(j)) * (180 / Math.PI);
    if (d > 180) d = 360 - d;
    return d;
  };
  /** The side of `p` from step i: 1 right, -1 left, 0 on the road's line. */
  const sideOf = (i: number, p: LatLon) => {
    const [dx, dy] = vec(path[i]!, path[i + 1]!);
    const [px, py] = vec(path[i]!, p);
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return 0;
    const cross = (dx * py - dy * px) / len;
    return Math.abs(cross) < 1 ? 0 : cross < 0 ? 1 : -1;
  };
  const onRoad = (i: number) => (kerb[i] ?? 0) > 0;
  /** From step `first` on in direction `by`, the steps of one street, on side `sign`. */
  const along = (first: number, by: 1 | -1, sign: number) => {
    for (let i = first; i >= 0 && i < steps && onRoad(i); i += by) {
      sides[i] = sign * kerb[i]!;
      const next = i + by;
      if (next < 0 || next >= steps || !onRoad(next) || turn(i, next) > CORNER) break;
    }
  };
  const firstRoad = kerb.findIndex((k) => k > 0);
  const lastRoad = kerb.findLastIndex((k) => k > 0);
  if (firstRoad < 0) return sides;
  const start = sideOf(firstRoad, path[0]!);
  if (start !== 0) along(firstRoad, 1, start);
  const end = sideOf(lastRoad, path[path.length - 1]!);
  if (end !== 0) along(lastRoad, -1, end);
  return sides;
}

/** The length of a line (m). */
export function lineLength(points: readonly LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1]!, points[i]!);
  return d;
}
