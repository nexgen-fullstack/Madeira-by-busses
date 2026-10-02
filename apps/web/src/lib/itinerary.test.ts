import { describe, expect, it } from 'vitest';
import type { Network } from '@madeirabus/engine';
import { decodePlace, encodePlace } from './itinerary.ts';

const net = {
  stops: [
    { name: 'Funchal', lat: 32.6, lon: -16.9 },
    { name: 'Funchal', lat: 32.62, lon: -16.92 },
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

  it('rejects garbage', () => {
    expect(decodePlace(net, 's:99', 'Me')).toBeUndefined();
    expect(decodePlace(net, 'p:abc', 'Me')).toBeUndefined();
    expect(decodePlace(net, 'x', 'Me')).toBeUndefined();
  });
});
