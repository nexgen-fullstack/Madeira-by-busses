import { describe, expect, it } from 'vitest';
import { WalkGraph, encodeWalkGraph, WALK_PATH, WALK_STEPS, WALK_STREET } from '@madeirabus/engine';
import { buildWalkGraph, walkKind, type OsmWay } from './walk.ts';

const way = (id: number, nodes: number[], tags: Record<string, string>, lon0 = -16.9): OsmWay => ({
  id,
  nodes,
  // Nodes 1 m × id apart along a parallel, so the same id is the same place.
  geometry: nodes.map((n) => ({ lat: 32.65, lon: lon0 + n * 0.0001 })),
  tags,
});

describe('walkKind', () => {
  it('knows where people may walk and how', () => {
    expect(walkKind({ highway: 'residential' })).toBe(WALK_STREET);
    expect(walkKind({ highway: 'footway' })).toBe(WALK_STREET);
    expect(walkKind({ highway: 'steps' })).toBe(WALK_STEPS);
    expect(walkKind({ highway: 'path' })).toBe(WALK_PATH);
    // The expressway, private ways and footways marked "use the pavement".
    expect(
      walkKind({ highway: 'trunk', motorroad: 'yes', foot: 'no', ref: 'VR1' }),
    ).toBeUndefined();
    expect(walkKind({ highway: 'service', access: 'private' })).toBeUndefined();
    expect(walkKind({ highway: 'service', access: 'private', foot: 'yes' })).toBe(WALK_STREET);
    expect(walkKind({ highway: 'primary', foot: 'use_sidepath' })).toBeUndefined();
    expect(walkKind({ highway: 'motorway' })).toBeUndefined();
    // Road tunnels through the mountains, but not a short underpass.
    expect(walkKind({ highway: 'primary', tunnel: 'yes' }, 1800)).toBeUndefined();
    expect(walkKind({ highway: 'primary', tunnel: 'yes' }, 80)).toBe(WALK_STREET);
  });
});

describe('buildWalkGraph', () => {
  it('joins ways at shared nodes and merges plain bends', () => {
    // A street 1–2–3–4–5 crossed at 3 by 10–3–11, and a lone footway far away.
    const ways = [
      way(1, [1, 2, 3], { highway: 'residential' }),
      way(2, [3, 4, 5], { highway: 'residential' }),
      {
        ...way(3, [10, 3, 11], { highway: 'footway' }),
        geometry: [
          { lat: 32.6501, lon: -16.8997 },
          { lat: 32.65, lon: -16.8997 },
          { lat: 32.6499, lon: -16.8997 },
        ],
      },
      way(4, [20, 21], { highway: 'footway' }, -16.5),
      way(5, [30, 31], { highway: 'motorway' }),
    ];
    const { graph, stats } = buildWalkGraph(ways, { minComponent: 15 });
    expect(stats.walkable).toBe(4);
    // Junction 3 with four arms; 1 and 5 and 10 and 11 are dead ends.
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(4);
    expect(stats.droppedComponents).toBe(1);
    const g = WalkGraph.decode(encodeWalkGraph(graph));
    const r = g.route({ lat: 32.65, lon: -16.8999 }, { lat: 32.65, lon: -16.8995 })!;
    expect(r.length).toBeCloseTo(37.5, 0);
  });
});
