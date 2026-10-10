import { describe, expect, it } from 'vitest';
import type { Network } from '@madeirabus/engine';
import { lineNetwork } from '../test/network.ts';
import { expresswayStretches, lineGroups, lineOf } from './lines.ts';

const route = (agency: number, short: string) => ({ agency, short });
const pattern = (r: number, trips: number, stops = 10) => ({
  route: r,
  trips: Array.from({ length: trips }),
  stops: Array.from({ length: stops }),
});

// Variants of 181 published as separate routes, as Horários do Funchal does.
const net = {
  routes: [route(0, '181'), route(0, '2'), route(0, '181'), route(1, '2'), route(0, '10')],
  patterns: [
    pattern(0, 3, 40), // the long main route
    pattern(1, 5),
    pattern(2, 9), // a short local shuttle with more trips
    pattern(3, 1),
    pattern(4, 2),
  ],
} as unknown as Network;

describe('lineGroups', () => {
  it('groups variants by operator and number, main variant first', () => {
    expect(lineGroups(net).map((g) => [g.agency, g.short, g.routes])).toEqual([
      [0, '2', [1]],
      [0, '10', [4]],
      [0, '181', [0, 2]],
      [1, '2', [3]],
    ]);
  });

  it('finds the line of a variant', () => {
    expect(lineOf(net, 2)).toEqual([0, 2]);
    expect(lineOf(net, 3)).toEqual([3]);
    expect(lineOf(net, 99)).toEqual([]);
  });
});

describe('expresswayStretches', () => {
  // 110 out of Centro, as if it took the Via Rápida from Escola to Barreira.
  const real = lineNetwork();
  const out = real.patterns.findIndex(
    (p) => p.stops.length === 4 && real.stops[p.stops[0]!]!.name === 'Centro',
  );
  real.bundle.shapeExpressways = real.bundle.shapes.map((_, i) =>
    i === real.patterns[out]!.shape ? [1, 3] : [],
  );

  it('tells between which stops a line runs on it, and how far', () => {
    const [x, ...more] = expresswayStretches(real, out);
    expect(more).toEqual([]);
    expect(x).toMatchObject({ from: 1, to: 3 });
    expect(x!.metres).toBeCloseTo(667, -1);
  });

  it('keeps to a ride, and leaves out a short bit of it', () => {
    expect(expresswayStretches(real, out, 1, 3)).toMatchObject([{ from: 1, to: 3 }]);
    expect(expresswayStretches(real, out, 0, 2)).toEqual([]);
  });
});
