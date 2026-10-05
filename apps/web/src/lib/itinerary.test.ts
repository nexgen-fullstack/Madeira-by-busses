import { describe, expect, it } from 'vitest';
import type { BRoute, Itinerary, Network } from '@madeirabus/engine';
import { decodePlace, encodePlace, isExpress, optionTags } from './itinerary.ts';

const net = {
  stops: [
    { id: '00225', name: 'Funchal', lat: 32.6, lon: -16.9 },
    { id: 'hf:12', name: 'Funchal', lat: 32.62, lon: -16.92 },
  ],
} as unknown as Network;

describe('place URLs', () => {
  it('round-trips stops, named points and plain points', () => {
    expect(decodePlace(net, encodePlace({ stops: [0, 1], lat: 0, lon: 0 }), 'Me')).toMatchObject({
      name: 'Funchal',
      stops: [0, 1],
      kind: 'stop',
    });
    expect(
      decodePlace(net, encodePlace({ lat: 32.64, lon: -16.91, name: 'Hotel Mar~Sol' }), 'Me'),
    ).toEqual({
      name: 'Hotel Mar~Sol',
      lat: 32.64,
      lon: -16.91,
      kind: 'location',
    });
    expect(decodePlace(net, 'p:32.64,-16.91', 'Me')?.name).toBe('Me');
  });

  it('links to stops by their feed ids, which survive timetable updates', () => {
    expect(encodePlace({ stops: [1, 0], lat: 0, lon: 0 }, net)).toBe('i:hf:12,00225');
    expect(decodePlace(net, 'i:hf:12,00225', 'Me')?.stops).toEqual([1, 0]);
    // A stop gone from a newer timetable is skipped; none left means no place.
    expect(decodePlace(net, 'i:gone,00225', 'Me')?.stops).toEqual([0]);
    expect(decodePlace(net, 'i:gone', 'Me')).toBeUndefined();
  });

  it('rejects garbage', () => {
    expect(decodePlace(net, 's:99', 'Me')).toBeUndefined();
    expect(decodePlace(net, 'p:abc', 'Me')).toBeUndefined();
    expect(decodePlace(net, 'x', 'Me')).toBeUndefined();
  });
});

describe('express lines', () => {
  const route = (long: string) => ({ long }) as BRoute;

  it('knows the lines on the Via Rápida by their names', () => {
    expect(isExpress(route('Funchal - Ribeira Brava (Via Rápida)'))).toBe(true);
    expect(isExpress(route('Funchal - Ribeira Brava (Via Rápida até à Quinta Grande)'))).toBe(true);
    expect(isExpress(route('FUNCHAL - SÃO VICENTE (VIA RAPIDA)'))).toBe(true);
    expect(isExpress(route('Funchal - Câmara de Lobos - Ribeira Brava'))).toBe(false);
  });
});

describe('what each way is good at', () => {
  const way = (arrive: number, cash: number, walk: number, rides = 1) =>
    ({
      key: `${arrive}`,
      arrive,
      rides,
      fare: { cash, giro: cash - 0.5 },
      legs: [{ kind: 'walk', start: 0, end: walk }],
    }) as unknown as Itinerary;

  it('tells the fastest, the cheapest and the one with least walking besides the best', () => {
    const best = way(3600, 2.6, 25 * 60);
    const options = [best, way(3300, 4.6, 20 * 60), way(4000, 2, 24 * 60), way(3900, 4.6, 5 * 60)];
    expect(optionTags(options, 'cash')).toEqual(
      new Map([
        [1, ['fastest']],
        [2, ['cheapest']],
        [3, ['lessWalking']],
      ]),
    );
  });

  it('tells nothing the best already is, and walking all the way is no cheapest ride', () => {
    const options = [way(3000, 2, 5 * 60), way(3600, 2.6, 25 * 60), way(3500, 0, 30 * 60, 0)];
    expect(optionTags(options, 'cash').size).toBe(0);
  });
});
