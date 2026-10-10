import { describe, expect, it } from 'vitest';
import type { Trail } from '@madeirabus/engine';
import { trailRegion } from './trails.ts';

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
