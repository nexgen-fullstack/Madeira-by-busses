import { describe, expect, it } from 'vitest';
import { haversine, type LatLon } from './geo.ts';
import { RoadGraph } from './roads.ts';
import {
  BIKE_PROFILE,
  encodeWalkGraph,
  WalkGraph,
  WALK_PATH,
  WALK_STEPS,
  WALK_STREET,
} from './walk.ts';

// A block in Funchal: A — B along the sea, B — C up the hill, C — D back, D — A down.
const at = (dx: number, dy: number): LatLon => ({
  lat: 32.648 + dy * 1e-3,
  lon: -16.91 + dx * 1e-3,
});
const [A, B, C, D] = [at(0, 0), at(2, 0), at(2, 1), at(0, 1)];
/** A road's kind: its direction (0 both ways, 1 forward, 2 back) and class. */
const road = (dir: number, cls: number) => dir + cls * 4;

describe('driving a car', () => {
  const roads = (ab: number) =>
    RoadGraph.decode(
      encodeWalkGraph({
        nodes: [A, B, C, D],
        edges: [
          { from: 0, to: 1, kind: ab, points: [] },
          { from: 1, to: 2, kind: road(0, 4), points: [] },
          { from: 2, to: 3, kind: road(0, 4), points: [] },
          { from: 3, to: 0, kind: road(0, 4), points: [] },
        ],
      }),
    );

  it('takes the road straight there at its speed', () => {
    const drive = roads(road(0, 1)).route(A, B)!;
    expect(drive.length).toBeCloseTo(haversine(A, B), 0);
    // 188 m at 50 km/h, with the traffic and the parking.
    expect(drive.seconds).toBeGreaterThan(90);
    expect(drive.seconds).toBeLessThan(120);
  });

  it('goes round the block against a one-way street, and never on a busway', () => {
    for (const kind of [road(2, 1), road(0, 6)]) {
      const drive = roads(kind).route(A, B)!;
      // Up D, along C, down to B: three sides of the block.
      expect(drive.length).toBeGreaterThan(haversine(A, B) + 2 * haversine(B, C) - 1);
      expect(drive.path.some((p) => haversine(p, C) < 1)).toBe(true);
    }
    // With the one-way street, back is straight along it.
    expect(roads(road(2, 1)).route(B, A)!.length).toBeCloseTo(haversine(A, B), 0);
  });
});

describe('riding a bike', () => {
  // Steps straight up from A to D, or a street round by B and C.
  const graph = WalkGraph.decode(
    encodeWalkGraph({
      nodes: [A, B, C, D],
      edges: [
        { from: 0, to: 3, kind: WALK_STEPS, points: [], up: 20 },
        { from: 0, to: 1, kind: WALK_STREET, points: [] },
        { from: 1, to: 2, kind: WALK_STREET, points: [], up: 20 },
        { from: 2, to: 3, kind: WALK_PATH, points: [] },
      ],
    }),
  );

  it('walks up the steps but rides round by the streets', () => {
    expect(graph.route(A, D)!.length).toBeCloseTo(haversine(A, D), -1);
    const ride = graph.route(A, D, 300, 1, BIKE_PROFILE)!;
    expect(ride.length).toBeGreaterThan(3 * haversine(A, D));
    expect(ride.up).toBeCloseTo(20, 0);
  });

  it('starts by the steps on the street, not on them', () => {
    // A point on the steps, nearer them than the street.
    const onSteps = { lat: A.lat + 2e-4, lon: A.lon + 2e-5 };
    expect(graph.route(onSteps, C, 300, 1, BIKE_PROFILE)).toBeDefined();
  });
});
