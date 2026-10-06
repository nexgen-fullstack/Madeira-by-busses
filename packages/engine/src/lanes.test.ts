import { describe, expect, it } from 'vitest';
import { cumulativeDistances, decodePolyline, haversine, type LatLon } from './geo.ts';
import { decodeSides, encodeSides, offsetPolyline, pavementSides, sliceSided } from './lanes.ts';
import { Network } from './network.ts';
import { fixtureBundle } from './test-fixtures.ts';

// Metres east (x) and north (y) of a corner of Funchal.
const LAT0 = 32.65;
const LON0 = -16.93;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
const xy = (x: number, y: number): LatLon => ({ lat: LAT0 + y / KY, lon: LON0 + x / KX });
const metres = (p: LatLon) => [(p.lon - LON0) * KX, (p.lat - LAT0) * KY] as const;

describe('sides of a line', () => {
  it('writes runs of one side once', () => {
    const sides = [1.6, 1.6, 1.6, 0, 0, 1.4];
    expect(encodeSides(sides)).toBe('16*3,0*2,14');
    expect(decodeSides('16*3,0*2,14', 6)).toEqual(sides);
    expect(encodeSides([0, 0])).toBe('');
    expect(decodeSides('', 3)).toEqual([0, 0, 0]);
    expect(decodeSides(undefined, 2)).toEqual([0, 0]);
    // Never more or fewer steps than the line has.
    expect(decodeSides('16*5', 3)).toEqual([1.6, 1.6, 1.6]);
  });

  it('cuts a part out of a line with the sides of its steps', () => {
    const points = [xy(0, 0), xy(100, 0), xy(200, 0), xy(300, 0)];
    const part = sliceSided(points, cumulativeDistances(points), [1, 2, 3], 50, 250);
    expect(part.points).toHaveLength(4);
    expect(part.sides).toEqual([1, 2, 3]);
    // Within one step.
    expect(sliceSided(points, cumulativeDistances(points), [1, 2, 3], 120, 180).sides).toEqual([2]);
  });
});

describe('a line moved into its lane', () => {
  it('runs the given metres right of the road', () => {
    // East along a road: its right is south.
    const lane = offsetPolyline([xy(0, 0), xy(50, 0), xy(100, 0)], [1.6, 1.6]);
    for (const p of lane) expect(metres(p)[1]).toBeCloseTo(-1.6, 1);
    // West: north.
    const back = offsetPolyline([xy(100, 0), xy(0, 0)], [1.6]);
    for (const p of back) expect(metres(p)[1]).toBeCloseTo(1.6, 1);
  });

  it('keeps its distance round a corner', () => {
    // East, then a left turn north: the right lane takes the outside of the corner.
    const lane = offsetPolyline([xy(0, 0), xy(100, 0), xy(100, 100)], [2, 2]);
    const [x, y] = metres(lane[1]!);
    expect(x).toBeCloseTo(102, 1);
    expect(y).toBeCloseTo(-2, 1);
  });

  it('eases from a lane to the middle of a one-way street', () => {
    const lane = offsetPolyline([xy(0, 0), xy(100, 0), xy(200, 0)], [1.6, 0]);
    expect(metres(lane[0]!)[1]).toBeCloseTo(-1.6, 1);
    expect(metres(lane[2]!)[1]).toBeCloseTo(0, 1);
  });

  it('leaves a line with no sides as it is', () => {
    const points = [xy(0, 0), xy(100, 0)];
    expect(offsetPolyline(points, [0])).toEqual(points);
  });
});

describe('a walk on the pavement', () => {
  it('keeps right, but along the stop’s street on the stop’s side', () => {
    // From a door north of an east–west street, along it to a corner, then south down
    // another street to a stop on its east side.
    const path = [xy(0, 10), xy(0, 0), xy(100, 0), xy(100, -100), xy(105, -100)];
    const kerb = [0, 4, 3, 0];
    const sides = pavementSides(path, kerb);
    // Starting north of the street, walking east: on the left, the north pavement.
    expect(sides[1]).toBe(-4);
    // Walking south with the stop on the east: on the left, the stop's pavement.
    expect(sides[2]).toBe(-3);
    expect(sides[0]).toBe(0);
    expect(sides[3]).toBe(0);
  });
});

describe('a ride in its lane', () => {
  it('starts and ends where its stops meet the lane', () => {
    const bundle = fixtureBundle();
    const plain = new Network(bundle);
    // The same ride with and without its lanes known.
    expect(plain.rideLane(0, 0, 1)).toEqual(plain.rideShape(0, 0, 1));
    bundle.shapeSides = bundle.shapes.map((s) => `20*${decodePolyline(s).length - 1}`);
    const net = new Network(bundle);
    const lane = net.rideLane(0, 0, 1);
    const axis = net.rideShape(0, 0, 1);
    expect(haversine(lane[0]!, axis[0]!)).toBeCloseTo(2, 1);
    expect(haversine(lane.at(-1)!, axis.at(-1)!)).toBeCloseTo(2, 1);
    expect(net.lane(0).length).toBeGreaterThanOrEqual(net.shape(0).length);
  });
});
