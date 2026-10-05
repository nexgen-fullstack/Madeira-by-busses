import { describe, expect, it } from 'vitest';
import { decodeWalkGraphData, encodeWalkGraph, haversine } from '@madeirabus/engine';
import { driveKind, reverseDriveKind } from './drive.ts';
import { RoadRouter } from './shapes.ts';
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

describe('drive kinds', () => {
  it('reads classes, one-way rules and roads buses may not take', () => {
    expect(driveKind({ highway: 'primary' })).toBe(4);
    expect(driveKind({ highway: 'residential', oneway: 'yes' })).toBe(17);
    expect(driveKind({ highway: 'residential', oneway: '-1' })).toBe(18);
    expect(driveKind({ highway: 'service', junction: 'roundabout' })).toBe(21);
    expect(driveKind({ highway: 'tertiary', oneway: 'yes', 'oneway:bus': 'no' })).toBe(12);
    expect(driveKind({ highway: 'service', service: 'parking_aisle' })).toBeUndefined();
    expect(driveKind({ highway: 'residential', access: 'private' })).toBeUndefined();
    expect(driveKind({ highway: 'residential', access: 'no', bus: 'yes' })).toBe(16);
    expect(driveKind({ highway: 'footway' })).toBeUndefined();
    expect(reverseDriveKind(17)).toBe(18);
    expect(reverseDriveKind(16)).toBe(16);
  });
});

describe('lines along the roads', () => {
  it('follows the road between the stops', () => {
    const shape = router().shape([nearP, nearQ])!;
    expect(shape).toBeDefined();
    // Along the one-way road, never round by T.
    expect(shape.every((p) => haversine(p, { lat: 32.65, lon: p.lon }) < 5)).toBe(true);
    expect(shape.some((p) => haversine(p, T) < 50)).toBe(false);
  });

  it('never drives the wrong way down a one-way road', () => {
    const shape = router().shape([nearQ, nearP])!;
    expect(shape).toBeDefined();
    // Q's stop to P's: on to Q, round by T and back along the road from P.
    expect(shape.some((p) => haversine(p, T) < 5)).toBe(true);
    expect(haversine(shape[0]!, nearQ)).toBeLessThan(15);
    expect(haversine(shape[shape.length - 1]!, nearP)).toBeLessThan(15);
  });

  it('leaves stops far from every road to straight lines', () => {
    const r = router();
    const far = { lat: 32.7, lon: -16.8 };
    expect(r.shape([far, { lat: 32.71, lon: -16.8 }])).toBeUndefined();
    expect(r.stats.straight).toBe(1);
  });
});
