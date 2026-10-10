import { describe, expect, it } from 'vitest';
import { decodePolyline, haversine, trailMinutes } from '@madeirabus/engine';
import { buildTrails, joinWays, kindOf, splitName, trailLinesOf } from './trails.ts';

const at = (dx: number, dy = 0) => ({ lat: 32.75 + dy * 1e-3, lon: -16.9 + dx * 1e-3 });

describe('the hiking trails', () => {
  it('takes the waymark number out of the name and tells the kind', () => {
    expect(splitName({ ref: 'PR 6', name: 'PR 6 - Levada das 25 Fontes' })).toEqual({
      ref: 'PR 6',
      name: 'Levada das 25 Fontes',
    });
    expect(splitName({ ref: 'PR 13.1', name: 'PR 13.1' }).name).toBe('PR 13.1');
    expect(kindOf('PR 6.1', 'Levada do Risco')).toBe('pr');
    expect(kindOf('LC', 'Levada do Curral')).toBe('levada');
    expect(kindOf('VBR', 'Vereda Boca do Risco')).toBe('vereda');
    expect(kindOf(undefined, 'Passeio Marítimo')).toBe('other');
  });

  it('joins the ways end to end whichever way each is drawn; a gap starts a new line', () => {
    const lines = joinWays([
      [at(0), at(1)],
      [at(2), at(1)],
      [at(2), at(3)],
      [at(9), at(10)],
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.map((p) => Math.round((p.lon + 16.9) * 1e3))).toEqual([0, 1, 2, 3]);
  });

  it('walks at 4 km an hour, 300 m an hour up and 500 down', () => {
    // 6 km and 300 m up: an hour and a half on the level, an hour up: 1.5 h + 0.5 h.
    expect(trailMinutes(6000, 300, 0)).toBe(120);
    // Level: just the distance.
    expect(trailMinutes(4000, 0, 0)).toBe(60);
  });

  it('builds the PR trails first by their number, each with its shape and start', () => {
    const route = (id: number, ref: string, name: string, ways: ReturnType<typeof at>[][]) => ({
      type: 'relation',
      id,
      tags: { ref, name },
      members: ways.map((w) => ({ type: 'way', geometry: w })),
    });
    const file = buildTrails([
      route(1, 'LC', 'Levada do Curral', [[at(0), at(10)]]),
      route(2, 'PR 10', 'PR 10 - Levada do Furado', [[at(0, 5), at(10, 5)]]),
      route(3, 'PR 6', 'PR 6 - Levada das 25 Fontes', [[at(0, 9), at(10, 9), at(0, 9.1)]]),
      route(4, 'X', 'Too short', [[at(0), at(0.2)]]),
    ]);
    expect(file.trails.map((t) => t.id)).toEqual(['pr6', 'pr10', 'osm-1']);
    const pr6 = file.trails[0]!;
    expect(pr6).toMatchObject({ ref: 'PR 6', kind: 'pr', roundtrip: true });
    expect(pr6.start).toEqual([32.759, -16.9]);
    const line = decodePolyline(pr6.lines[0]!);
    expect(haversine(line[0]!, at(0, 9))).toBeLessThan(2);
  });

  it('starts and ends where it leaves the road, and is no trail when it is mostly road', () => {
    // A street of a village (500 m), the path up the hill (1.5 km), a street crossed (30 m),
    // the path on, and a road for 600 m in the middle of it all.
    const way = (ref: number, ...points: ReturnType<typeof at>[]) => ({
      type: 'way',
      ref,
      geometry: points,
    });
    const rel = {
      type: 'relation',
      id: 9,
      tags: { ref: 'PR 2', name: 'PR 2 - Vereda do Urzal' },
      members: [
        way(1, at(0), at(5)),
        way(2, at(5), at(20)),
        way(3, at(20), at(20.3)),
        way(4, at(20.3), at(30)),
        way(5, at(30), at(37)),
        way(6, at(37), at(50)),
      ],
    };
    const tags = new Map([
      [1, { highway: 'residential' }],
      [2, { highway: 'path' }],
      [3, { highway: 'residential' }],
      [4, { highway: 'path' }],
      [5, { highway: 'tertiary' }],
      [6, { highway: 'path' }],
    ]);
    const { lines } = trailLinesOf(rel, tags);
    const ends = lines.map((l) =>
      [l[0]!, l[l.length - 1]!].map((p) => Math.round((p.lon + 16.9) * 1e4)),
    );
    expect(ends).toEqual([
      [50, 300],
      [370, 500],
    ]);
    // Without the ways' tags, all of it.
    expect(trailLinesOf(rel).lines).toHaveLength(1);
    // Mostly a road: none.
    const road = new Map([...tags].map(([k]) => [k, { highway: 'secondary' }]));
    road.set(2, { highway: 'path' });
    expect(
      buildTrails([rel, ...[...road].map(([id, t]) => ({ type: 'way', id, tags: t }))]).trails,
    ).toEqual([]);
  });
});
