import { describe, expect, it } from 'vitest';
import type { BPlace } from '@madeirabus/engine';
import { addressesFromOsm } from './addresses.ts';
import type { OsmElement } from './places.ts';

const places: BPlace[] = [
  { name: 'Ribeira Brava', lat: 32.67, lon: -17.065, kind: 'town' },
  { name: 'Funchal', lat: 32.65, lon: -16.91, kind: 'town' },
];
let id = 1;
const way = (name: string, lat: number, lon: number): OsmElement => ({
  type: 'way',
  id: id++,
  center: { lat, lon },
  tags: { highway: 'residential', name },
});
const house = (street: string, number: string, lat: number, lon: number): OsmElement => ({
  type: 'node',
  id: id++,
  lat,
  lon,
  tags: { 'addr:street': street, 'addr:housenumber': number },
});

describe('addressesFromOsm', () => {
  const book = addressesFromOsm(
    [
      way('Rua Padre Gil', 32.6716, -17.0655),
      way('Rua Padre Gil', 32.6721, -17.0656),
      // The same name in Funchal is another street.
      way('Rua Padre Gil', 32.6501, -16.9101),
      house('Rua Padre Gil', '12', 32.6717, -17.0654),
      house('Rua Padre Gil', '3', 32.672, -17.0657),
      // An address naming its building after the street belongs to the street.
      house('Rua Padre Gil 23A, Edifício Mar', '5', 32.6718, -17.0656),
      // A street known only from its addresses.
      house('Caminho Novo', '1', 32.6705, -17.064),
      // Porto Santo is left out.
      house('Rua Porto Santo', '1', 33.06, -16.34),
    ],
    places,
  );

  it('keeps streets of one name apart by place, each with its houses', () => {
    const padre = book.streets.filter((s) => s[0] === 'Rua Padre Gil');
    expect(padre.map((s) => book.areas[s[3]])).toEqual(['Funchal', 'Ribeira Brava']);
    const rb = padre[1]!;
    expect(rb[4]).toBe('3,5,12');
    // Each house is its offset from the street's point, in 1e-5 degrees.
    expect(rb[1] + rb[5][2]!).toBe(3267170);
    expect(rb[2] + rb[6][2]!).toBe(-1706540);
  });

  it('keeps streets known only by their addresses, and leaves Porto Santo out', () => {
    expect(book.streets.map((s) => s[0])).toEqual([
      'Caminho Novo',
      'Rua Padre Gil',
      'Rua Padre Gil',
    ]);
  });
});
