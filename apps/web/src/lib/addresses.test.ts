import { describe, expect, it } from 'vitest';
import { AddressIndex } from './addresses.ts';

const index = new AddressIndex({
  v: 1,
  areas: ['Ribeira Brava', 'Funchal'],
  streets: [
    ['Rua Padre Gil', 3267160, -1706550, 0, '3,5,12', [40, 20, 10], [-20, -10, 10]],
    ['Rua da Carreira', 3264890, -1691150, 1, '10,11,104', [0, 1, 2], [0, 1, 2]],
    ['Rua da Carreira de Cima', 3281300, -1724720, 0, '', [], []],
  ],
});

describe('AddressIndex', () => {
  it('finds a street, slips of the finger too, with its place', () => {
    expect(index.search('padre gil').map((h) => [h.name, h.area])).toEqual([
      ['Rua Padre Gil', 'Ribeira Brava'],
    ]);
    expect(index.search('Rua Pedre Gil')[0]?.name).toBe('Rua Padre Gil');
  });

  it('puts the point on the house with the number typed', () => {
    const [hit] = index.search('Rua Padre Gil, 12');
    expect(hit).toMatchObject({ name: 'Rua Padre Gil 12', number: '12' });
    expect(hit!.lat).toBeCloseTo(32.6717, 5);
    expect(hit!.lon).toBeCloseTo(-17.0654, 5);
    expect(index.search('Rua Padre Gil 12')[0]?.number).toBe('12');
  });

  it('uses the nearest number on the same side when the one typed is not mapped', () => {
    const [hit] = index.search('rua da carreira 98');
    expect(hit).toMatchObject({ name: 'Rua da Carreira 98', near: '104' });
  });

  it('offers the whole street and its numbers after "Street,"', () => {
    expect(index.search('Rua Padre Gil, ').map((h) => h.name)).toEqual([
      'Rua Padre Gil',
      'Rua Padre Gil 3',
      'Rua Padre Gil 5',
      'Rua Padre Gil 12',
    ]);
    expect(index.search('Rua Padre Gil, 1').map((h) => h.name)).toEqual(['Rua Padre Gil 12']);
  });
});
