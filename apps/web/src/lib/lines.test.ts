import { describe, expect, it } from 'vitest';
import type { Network } from '@madeirabus/engine';
import { lineGroups, lineOf } from './lines.ts';

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
