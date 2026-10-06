import { haversine, Network, type LatLon, type NetworkBundle } from '@madeirabus/engine';

/**
 * Lines off the roads: every line of a bundle checked against the roads buses
 * drive on, a point every few metres. Where a line runs further than a road's
 * width from every road it crosses grass, gardens or houses on the map — a
 * shape cut short across a bend, a stop joined by a straight line, a feed's
 * shape drawn beside the road.
 */

/** Further than this from every road, a line is off the road (m). */
export const OFF_ROAD = 10;
/** A point every so many metres along each line is checked. */
const STEP = 5;

export interface Stretch {
  /** Metres along the line where it leaves the road and where it is back. */
  start: number;
  end: number;
  /** Furthest from a road (m). */
  worst: number;
  /** The middle of the stretch, to find it on the map. */
  at: LatLon;
}

/** Points along a polyline every `step` metres, with how far along each is. */
function samples(points: readonly LatLon[], step: number): { p: LatLon; along: number }[] {
  const out: { p: LatLon; along: number }[] = [];
  let along = 0;
  points.forEach((b, i) => {
    const a = points[i - 1];
    if (a) {
      const d = haversine(a, b);
      const n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        out.push({
          p: { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) },
          along: along + t * d,
        });
      }
      along += d;
    } else {
      out.push({ p: b, along: 0 });
    }
  });
  return out;
}

/** The stretches of a line further than `limit` metres from every road. */
export function offRoadStretches(
  points: readonly LatLon[],
  distance: (p: LatLon) => number,
  limit = OFF_ROAD,
  step = STEP,
): Stretch[] {
  const out: Stretch[] = [];
  let open: { start: number; worst: number; points: { p: LatLon; along: number }[] } | undefined;
  let last = 0;
  for (const s of samples(points, step)) {
    const d = distance(s.p);
    if (d > limit) {
      open ??= { start: last, worst: 0, points: [] };
      open.worst = Math.max(open.worst, d);
      open.points.push(s);
    } else if (open) {
      out.push(close(open, s.along));
      open = undefined;
    }
    last = s.along;
  }
  if (open) out.push(close(open, last));
  return out;
}

function close(
  open: { start: number; worst: number; points: { p: LatLon; along: number }[] },
  end: number,
): Stretch {
  const mid = open.points[Math.floor(open.points.length / 2)]!;
  return { start: open.start, end, worst: open.worst, at: mid.p };
}

export interface OffRoad extends Stretch {
  route: string;
  headsign: string;
  /** The stops before and after the stretch. */
  from: string;
  to: string;
  shape: number;
}

/**
 * Every stretch of every line of a bundle further than `limit` metres from the
 * roads, longest first; `distance` gives a point's metres to the nearest road.
 */
export function checkShapes(
  bundle: NetworkBundle,
  distance: (p: LatLon) => number,
  limit = OFF_ROAD,
): OffRoad[] {
  const net = new Network(bundle);
  const seen = new Set<number>();
  const out: OffRoad[] = [];
  net.patterns.forEach((pattern, i) => {
    if (seen.has(pattern.shape)) return;
    seen.add(pattern.shape);
    const shape = net.shape(i);
    if (shape.length < 2) return;
    const { stops } = net.stopPositions(i);
    const stopAt = (along: number, after: boolean) => {
      let k = after ? stops.findIndex((s) => s >= along) : stops.findLastIndex((s) => s <= along);
      if (k < 0) k = after ? stops.length - 1 : 0;
      return net.stops[pattern.stops[k]!]!.name;
    };
    for (const s of offRoadStretches(shape, distance, limit)) {
      out.push({
        ...s,
        route: net.routes[pattern.route]!.short,
        headsign: pattern.headsign,
        from: stopAt(s.start, false),
        to: stopAt(s.end, true),
        shape: pattern.shape,
      });
    }
  });
  return out.sort((a, b) => b.end - b.start - (a.end - a.start));
}

/** The check as Markdown, for the build report. */
export function offRoadMarkdown(found: readonly OffRoad[], lines: number): string {
  const total = found.reduce((m, s) => m + s.end - s.start, 0);
  const rows = found.map(
    (s) =>
      `| ${s.route} | ${s.headsign} | ${s.from} → ${s.to} | ${Math.round(s.end - s.start)} | ${Math.round(s.worst)} | ${s.at.lat.toFixed(5)},${s.at.lon.toFixed(5)} |`,
  );
  return [
    '## Lines off the roads',
    '',
    found.length === 0
      ? `All ${lines} lines keep within ${OFF_ROAD} m of a road.`
      : `${found.length} stretches of ${lines} lines run further than ${OFF_ROAD} m from every road (${Math.round(total)} m in all).`,
    '',
    ...(found.length > 0
      ? [
          '| Line | Towards | Between the stops | Metres | Furthest (m) | Where |',
          '| --- | --- | --- | ---: | ---: | --- |',
          ...rows,
          '',
        ]
      : []),
  ].join('\n');
}
