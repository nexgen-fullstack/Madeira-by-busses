import { describe, expect, it } from 'vitest';
import { encodePolyline, haversine, type LatLon, type Trail } from '@madeirabus/engine';
import { reversedTrail, trailBranches, trailLines, trailRegion } from './trails.ts';

const at = (lat: number, lon: number) => ({ start: [lat, lon] }) as unknown as Trail;

describe('where a trail starts', () => {
  it('lists it by the region of the island it starts in', () => {
    // PR 6 at Rabaçal, PR 8 at Baía d'Abra, PR 9 at Queimadas, PR 1 at Pico do Areeiro.
    expect(trailRegion(at(32.7546, -17.1325))).toBe('west');
    expect(trailRegion(at(32.7433, -16.701))).toBe('east');
    expect(trailRegion(at(32.7848, -16.9016))).toBe('north');
    expect(trailRegion(at(32.7356, -16.9286))).toBe('mountains');
    // Levada dos Tornos above Funchal.
    expect(trailRegion(at(32.6702, -16.8899))).toBe('funchal');
  });
});

/** A trail along points (lat, lon), from the first to the last. */
const trail = (id: string, ...points: [number, number][]) => {
  const line: LatLon[] = points.map(([lat, lon]) => ({ lat, lon }));
  return {
    id,
    name: id,
    kind: 'levada',
    osm: 1,
    length: 1000,
    up: 100,
    down: 20,
    low: 500,
    high: 600,
    roundtrip: false,
    start: points[0]!,
    end: points.at(-1)!,
    lines: [encodePolyline(line)],
  } as Trail;
};

describe('a trail walked from its end', () => {
  it('starts at its end, goes down what it climbed, its line the other way', () => {
    const t = trail('a', [32.7, -16.9], [32.7, -16.89], [32.71, -16.89]);
    const r = reversedTrail(t);
    expect([r.start, r.end, r.up, r.down]).toEqual([t.end, t.start, 20, 100]);
    expect(trailLines(r)[0]).toEqual([...trailLines(t)[0]!].reverse());
  });
});

describe('the other trails met on the way', () => {
  // A levada 2 km east along 32.70.
  const main = trail('main', [32.7, -16.9], [32.7, -16.88]);
  it('turn off where they cross or join it, each to where it ends', () => {
    // One crossing it in the middle, north to south: both ways from the crossing.
    const across = trail('across', [32.71, -16.89], [32.69, -16.89]);
    // One coming down from the north and ending on it: walked from it, it is walked backwards.
    const joins = trail('joins', [32.71, -16.885], [32.7, -16.885]);
    // One along the same path, and one far away: none.
    const along = trail('along', [32.7, -16.899], [32.7, -16.881]);
    const far = trail('far', [32.8, -16.9], [32.8, -16.88]);
    const found = trailBranches(main, [main, across, joins, along, far]);
    expect(found.map((b) => [b.trail.id, b.reversed, b.rejoins])).toEqual([
      ['across', true, false],
      ['across', false, false],
      ['joins', true, false],
    ]);
    // Each from the crossing on the levada to the other trail's end.
    for (const b of found) {
      expect(Math.abs(b.coords[0]!.lat - 32.7)).toBeLessThan(0.0003);
      expect(Math.abs(b.coords.at(-1)!.lat - 32.7)).toBeGreaterThan(0.009);
    }
    expect(haversine(found[2]!.coords.at(-1)!, { lat: 32.71, lon: -16.885 })).toBeLessThan(1);
  });

  it('come back onto it when they are another way between two of its places', () => {
    const detour = trail('detour', [32.7, -16.895], [32.705, -16.89], [32.7, -16.885]);
    const [b] = trailBranches(main, [detour]);
    expect(b).toMatchObject({ rejoins: true, reversed: false });
  });
});
