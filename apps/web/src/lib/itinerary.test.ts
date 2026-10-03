import { describe, expect, it } from 'vitest';
import type { Network } from '@madeirabus/engine';
import { decodePlace, encodePlace } from './itinerary.ts';

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
