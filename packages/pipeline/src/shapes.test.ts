import { describe, expect, it } from 'vitest';
import {
  decodeWalkGraphData,
  encodePolyline,
  encodeWalkGraph,
  haversine,
  type LatLon,
} from '@madeirabus/engine';
import {
  BACKWARD,
  BOTH_WAYS,
  driveKind,
  FORWARD,
  laneSide,
  reverseDriveKind,
  roadClass,
  roadDirection,
  roadSide,
} from './drive.ts';
import { checkShapes, offRoadStretches } from './checkShapes.ts';
import { RoadRouter, simplifySided } from './shapes.ts';
import { buildWalkGraph, type OsmWay } from './walk.ts';

/**
 *   P ──────────▶ Q      a one-way road east, ~940 m
 *    ╲           ╱
 *     ╲── T ────╱        a slower two-way road round by T
 */
const P = { lat: 32.65, lon: -16.9 };
const Q = { lat: 32.65, lon: -16.89 };
const T = { lat: 32.655, lon: -16.895 };
const WAYS: OsmWay[] = [
  { id: 1, nodes: [1, 2], geometry: [P, Q], tags: { highway: 'secondary', oneway: 'yes' } },
  { id: 2, nodes: [1, 3], geometry: [P, T], tags: { highway: 'residential' } },
  { id: 3, nodes: [3, 2], geometry: [T, Q], tags: { highway: 'residential' } },
];
const router = () => {
  const { graph } = buildWalkGraph(WAYS, {
    kindOf: (tags) => driveKind(tags),
    reverse: reverseDriveKind,
    minComponent: 0,
  });
  // Through the file format, as the build reads drive.bin.
  return new RoadRouter(decodeWalkGraphData(encodeWalkGraph(graph)));
};
/** Stops by the one-way road, 10 m north of it. */
const nearP = { lat: 32.65009, lon: -16.8985 };
const nearQ = { lat: 32.65009, lon: -16.8915 };

const parts = (kind: number | undefined) =>
  kind === undefined
    ? undefined
    : { dir: roadDirection(kind), cls: roadClass(kind), side: roadSide(kind) };

describe('drive kinds', () => {
  it('reads classes, one-way rules and roads buses may not take', () => {
    expect(parts(driveKind({ highway: 'primary' }))).toMatchObject({ dir: BOTH_WAYS, cls: 1 });
    expect(parts(driveKind({ highway: 'residential', oneway: 'yes' }))).toMatchObject({
      dir: FORWARD,
      cls: 4,
    });
    expect(parts(driveKind({ highway: 'residential', oneway: '-1' }))).toMatchObject({
      dir: BACKWARD,
      cls: 4,
    });
    expect(parts(driveKind({ highway: 'service', junction: 'roundabout' }))).toMatchObject({
      dir: FORWARD,
      cls: 5,
    });
    expect(
      parts(driveKind({ highway: 'tertiary', oneway: 'yes', 'oneway:bus': 'no' })),
    ).toMatchObject({ dir: BOTH_WAYS, cls: 3 });
    expect(driveKind({ highway: 'service', service: 'parking_aisle' })).toBeUndefined();
    expect(driveKind({ highway: 'residential', access: 'private' })).toBeUndefined();
    expect(parts(driveKind({ highway: 'residential', access: 'no', bus: 'yes' }))).toMatchObject({
      dir: BOTH_WAYS,
      cls: 4,
    });
    expect(driveKind({ highway: 'footway' })).toBeUndefined();
    const oneWay = driveKind({ highway: 'residential', oneway: 'yes' })!;
    expect(roadDirection(reverseDriveKind(oneWay))).toBe(BACKWARD);
    expect(reverseDriveKind(reverseDriveKind(oneWay))).toBe(oneWay);
    const twoWay = driveKind({ highway: 'secondary', lanes: '2' })!;
    expect(reverseDriveKind(twoWay)).toBe(twoWay);
  });

  it('keeps a bus in the centre of the right lane', () => {
    // A lane each way: half a lane right of the middle (1.6–1.75 m).
    expect(roadSide(driveKind({ highway: 'primary', lanes: '2' })!)).toBeGreaterThanOrEqual(1.6);
    expect(roadSide(driveKind({ highway: 'primary', lanes: '2' })!)).toBeLessThanOrEqual(1.75);
    // The width of the road shares out among its lanes.
    expect(laneSide({ highway: 'residential', lanes: '2', width: '6' }, 4, BOTH_WAYS)).toBe(1.5);
    // Two lanes each way: the outer lane, a lane and a half from the middle.
    expect(laneSide({ highway: 'primary', lanes: '4' }, 1, BOTH_WAYS)).toBeCloseTo(4.9, 1);
    // A one-way street of one lane: the middle of the road.
    expect(laneSide({ highway: 'residential', oneway: 'yes' }, 4, FORWARD)).toBe(0);
    // The expressway's carriageways are mapped one way each: not shifted again.
    expect(laneSide({ highway: 'trunk', oneway: 'yes', lanes: '2' }, 0, FORWARD)).toBe(0);
    // A one-way street of two lanes: the right one.
    expect(laneSide({ highway: 'secondary', oneway: 'yes', lanes: '2' }, 2, FORWARD)).toBe(1.6);
    // A narrow road shared both ways: a little right of its middle.
    expect(laneSide({ highway: 'service', lanes: '1' }, 5, BOTH_WAYS)).toBeCloseTo(0.7, 1);
  });
});

/** The signed distance of `p` right of the line through a and b (m). */
function rightOf(a: LatLon, b: LatLon, p: LatLon): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const ky = 110_540;
  const dx = (b.lon - a.lon) * kx;
  const dy = (b.lat - a.lat) * ky;
  const px = (p.lon - a.lon) * kx;
  const py = (p.lat - a.lat) * ky;
  return -(dx * py - dy * px) / Math.hypot(dx, dy);
}

describe('lines along the roads', () => {
  it('follows the road between the stops', () => {
    const shape = router().shape([nearP, nearQ])!;
    expect(shape).toBeDefined();
    // Along the one-way road, never round by T.
    expect(shape.points.every((p) => haversine(p, { lat: 32.65, lon: p.lon }) < 5)).toBe(true);
    expect(shape.points.some((p) => haversine(p, T) < 50)).toBe(false);
    // A one-way street of one lane: the bus in its middle.
    expect(shape.sides.every((s) => s === 0)).toBe(true);
    expect(shape.sides).toHaveLength(shape.points.length - 1);
  });

  it('never drives the wrong way down a one-way road', () => {
    const shape = router().shape([nearQ, nearP])!;
    expect(shape).toBeDefined();
    // Q's stop to P's: on to Q, round by T and back along the road from P.
    expect(shape.points.some((p) => haversine(p, T) < 5)).toBe(true);
    expect(haversine(shape.points[0]!, nearQ)).toBeLessThan(15);
    expect(haversine(shape.points[shape.points.length - 1]!, nearP)).toBeLessThan(15);
    // Round by T on the two-way road: in its right lane.
    expect(Math.max(...shape.sides)).toBeGreaterThan(1);
  });

  it('leaves stops far from every road to straight lines', () => {
    const r = router();
    const far = { lat: 32.7, lon: -16.8 };
    expect(r.shape([far, { lat: 32.71, lon: -16.8 }])).toBeUndefined();
    expect(r.stats.straight).toBe(1);
  });

  it('puts a line drawn beside the road on the road, in its lane', () => {
    // Drawn 12 m south of the road from P round by T, the way back to P.
    const drawn = [
      { lat: 32.65009, lon: -16.89 },
      { lat: 32.65509, lon: -16.895 },
      { lat: 32.65009, lon: -16.9 },
    ];
    const r = router();
    const line = r.match(drawn)!;
    expect(line).toBeDefined();
    expect(r.stats.matched).toBe(1);
    // On the roads by T, not 10 m beside them.
    const onRoad = (p: LatLon) =>
      Math.min(...[[Q, T] as const, [T, P] as const].map(([a, b]) => Math.abs(rightOf(a, b, p))));
    expect(Math.max(...line.points.map(onRoad))).toBeLessThan(1);
    expect(line.sides.every((s) => s > 1)).toBe(true);
  });

  it('keeps a line drawn where no road goes as it is', () => {
    const r = router();
    expect(
      r.match([
        { lat: 32.7, lon: -16.8 },
        { lat: 32.71, lon: -16.8 },
      ]),
    ).toBeUndefined();
    expect(r.stats.kept).toBe(1);
  });

  it('simplifies each side apart', () => {
    const points = [0, 1, 2, 3, 4].map((i) => ({ lat: 32.65, lon: -16.9 + i * 0.0001 }));
    const line = simplifySided({ points, sides: [1.6, 1.6, 0, 0] }, 2);
    expect(line.points).toEqual([points[0], points[2], points[4]]);
    expect(line.sides).toEqual([1.6, 0]);
  });
});

describe('lines off the roads', () => {
  it('finds the stretches far from every road', () => {
    // A line east along the parallel; the road leaves it for 100 m in the middle.
    const line = [
      { lat: 32.65, lon: -16.9 },
      { lat: 32.65, lon: -16.896 },
    ];
    const distance = (p: LatLon) => (p.lon > -16.8985 && p.lon < -16.8975 ? 30 : 2);
    const found = offRoadStretches(line, distance);
    expect(found).toHaveLength(1);
    expect(found[0]!.end - found[0]!.start).toBeGreaterThan(90);
    expect(found[0]!.end - found[0]!.start).toBeLessThan(110);
    expect(found[0]!.worst).toBe(30);
  });

  it('names the line and the stops around each stretch', () => {
    const bundle = {
      format: 'madeirabus.network',
      version: 1,
      stops: [
        { id: 'a', name: 'Alfa', lat: 32.65, lon: -16.9, muni: 'FNC' },
        { id: 'b', name: 'Beta', lat: 32.65, lon: -16.896, muni: 'FNC' },
      ],
      routes: [{ short: '45' }],
      shapes: [] as string[],
      patterns: [{ route: 0, headsign: 'Beta', stops: [0, 1], shape: 0, profiles: [], trips: [] }],
    };
    // The shape between the two stops, straight along the parallel.
    bundle.shapes.push(encodePolyline([bundle.stops[0]!, bundle.stops[1]!]));
    const found = checkShapes(bundle as never, (p) =>
      p.lon > -16.8985 && p.lon < -16.8975 ? 30 : 2,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ route: '45', headsign: 'Beta', from: 'Alfa', to: 'Beta' });
  });
});
