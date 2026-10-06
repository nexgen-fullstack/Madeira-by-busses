import { describe, expect, it } from 'vitest';
import { haversine, type LatLon } from './geo.ts';
import {
  encodeWalkGraph,
  WalkGraph,
  walkKerb,
  walkWay,
  WALK_STEPS,
  WALK_STREET,
  type WalkGraphData,
} from './walk.ts';

// Metres east (x) and north (y) of a corner of Funchal.
const LAT0 = 32.65;
const LON0 = -16.93;
const xy = (x: number, y: number): LatLon => ({
  lat: LAT0 + y / 110_574,
  lon: LON0 + x / (111_320 * Math.cos((LAT0 * Math.PI) / 180)),
});
const graph = (data: WalkGraphData) => WalkGraph.decode(encodeWalkGraph(data));

/** A town of 3×3 blocks, streets every 100 m; the east–west ones have a bend point. */
function town(): WalkGraphData {
  const nodes: LatLon[] = [];
  const id = (i: number, j: number) => i * 4 + j;
  for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) nodes.push(xy(i * 100, j * 100));
  const edges: WalkGraphData['edges'] = [];
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j <= 3; j++) {
      if (i < 3) {
        edges.push({
          from: id(i, j),
          to: id(i + 1, j),
          kind: WALK_STREET,
          points: [xy(i * 100 + 50, j * 100)],
        });
      }
      if (j < 3) edges.push({ from: id(i, j), to: id(i, j + 1), kind: WALK_STREET, points: [] });
    }
  }
  return { nodes, edges };
}

/** Is p on one of the town's streets (within a metre)? */
const onStreet = (p: LatLon) => {
  const x = (p.lon - LON0) * 111_320 * Math.cos((LAT0 * Math.PI) / 180);
  const y = (p.lat - LAT0) * 110_574;
  const near = (v: number) => Math.abs(v - Math.round(v / 100) * 100) < 1.5;
  return near(x) || near(y);
};

describe('WalkGraph', () => {
  it('stores the network compactly and reads it back', () => {
    const data = town();
    const bytes = encodeWalkGraph(data);
    const g = WalkGraph.decode(bytes);
    expect(g.nodeCount).toBe(16);
    expect(g.edgeCount).toBe(24);
    expect(bytes.length).toBeLessThan(200);
    for (let e = 0; e < g.edgeCount; e++) {
      for (const p of g.points(e)) expect(onStreet(p)).toBe(true);
    }
    expect(() => WalkGraph.decode(new Uint8Array([1, 2, 3, 4]))).toThrow('Not a walk graph');
  });

  it('meets a point at the nearest street', () => {
    const g = graph(town());
    const hit = g.snap(xy(150, 12))!;
    expect(hit.offset).toBeCloseTo(12, 0);
    expect(haversine(hit.point, xy(150, 0))).toBeLessThan(1.5);
    expect(g.snap(xy(150, 600), 100)).toBeUndefined();
  });

  it('walks round the blocks, not through them', () => {
    const g = graph(town());
    const a = xy(0, 0);
    const b = xy(300, 300);
    const r = g.route(a, b)!;
    expect(r.length).toBeGreaterThan(598);
    expect(r.length).toBeLessThan(602);
    expect(r.path[0]).toEqual(a);
    expect(r.path[r.path.length - 1]).toEqual(b);
    for (const p of r.path) expect(onStreet(p)).toBe(true);
    // Across a block: out to the street, round the corner and in again (20+50+100+50+20 m).
    const across = g.route(xy(150, 20), xy(150, 80))!;
    expect(across.length).toBeGreaterThan(236);
    expect(across.length).toBeLessThan(242);
  });

  it('stays on one street when both points are on it', () => {
    const g = graph(town());
    const r = g.route(xy(110, 100), xy(190, 100))!;
    // Coordinates are kept to about a metre.
    expect(r.length).toBeGreaterThan(79);
    expect(r.length).toBeLessThan(82);
    expect(r.path.length).toBeLessThanOrEqual(5);
  });

  it('goes round a ravine to the bridge', () => {
    // Two streets 80 m apart, joined only by a bridge 1 km away.
    const nodes = [xy(0, 0), xy(1000, 0), xy(0, 80), xy(1000, 80)];
    const g = graph({
      nodes,
      edges: [
        { from: 0, to: 1, kind: WALK_STREET, points: [] },
        { from: 2, to: 3, kind: WALK_STREET, points: [] },
        { from: 1, to: 3, kind: WALK_STREET, points: [] },
      ],
    });
    const start = g.snap(xy(0, 0))!;
    const across = g.snap(xy(0, 80))!;
    const along = g.snap(xy(300, 0))!;
    const [far, near] = g.distances(start, [across, along], 2500);
    expect(far!.length).toBeCloseTo(2080, -1);
    expect(near!.length).toBeCloseTo(300, 0);
    expect(g.distances(start, [across], 1000)[0]).toBeUndefined();
  });

  it('takes the stairs only when they save enough', () => {
    // From (0,0) to (0,100): 100 m of steps, or a street detour of 2×w + 100 m.
    const withDetour = (w: number) =>
      graph({
        nodes: [xy(0, 0), xy(0, 100), xy(w, 0), xy(w, 100)],
        edges: [
          { from: 0, to: 1, kind: WALK_STEPS, points: [] },
          { from: 0, to: 2, kind: WALK_STREET, points: [] },
          { from: 2, to: 3, kind: WALK_STREET, points: [] },
          { from: 3, to: 1, kind: WALK_STREET, points: [] },
        ],
      });
    const long = withDetour(60).route(xy(0, 0), xy(0, 100))!;
    expect(long.length).toBeCloseTo(100, 0); // steps: 160 m of effort against 220 m
    expect(long.cost).toBeCloseTo(160, 0);
    const short = withDetour(20).route(xy(0, 0), xy(0, 100))!;
    expect(short.length).toBeCloseTo(140, 0); // street: 140 m against 160 m of effort
  });

  it('tells where the pavements are along the roads, and still weighs the steps', () => {
    // A road with its pavement 3.5 m from its middle, then steps up to the target.
    const g = graph({
      nodes: [xy(0, 0), xy(100, 0), xy(100, 50)],
      edges: [
        { from: 0, to: 1, kind: WALK_STREET + 35 * 4, points: [] },
        { from: 1, to: 2, kind: WALK_STEPS, points: [] },
      ],
    });
    const r = g.route(xy(10, 5), xy(100, 45))!;
    expect(r.kerb).toHaveLength(r.path.length - 1);
    // The step onto the road, along it on its pavement, up the steps, off them.
    expect(r.kerb[0]).toBe(0);
    expect(r.kerb).toContain(3.5);
    expect(r.kerb.at(-1)).toBe(0);
    expect(walkKerb(WALK_STEPS + 35 * 4)).toBe(3.5);
    expect(walkWay(WALK_STEPS + 35 * 4)).toBe(WALK_STEPS);
    // The steps still count for more than their length.
    expect(r.cost).toBeGreaterThan(r.length + 20);
  });
});
