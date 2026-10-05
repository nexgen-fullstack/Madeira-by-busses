import { describe, expect, it } from 'vitest';
import type { Itinerary, Network } from '@madeirabus/engine';
import type { Direction } from './lines.ts';
import {
  itineraryContent,
  RIDE_COLORS,
  RIDE_END,
  RIDE_START,
  routeContent,
  WAY_TURQUOISE,
  WAY_YELLOW,
} from './mapContent.ts';

// Line 207 from Funchal to Ribeira Brava, and back with its stops across the road.
const stop = (name: string, lon: number, lat = 32.65) => ({ name, lat, lon });
const shapes = [
  [stop('', -16.91), stop('', -17.06)],
  [stop('', -17.06, 32.6501), stop('', -16.91, 32.6501)],
];
const net = {
  stops: [
    stop('Funchal', -16.91),
    stop('Câmara de Lobos', -16.97),
    stop('Ribeira Brava', -17.06),
    stop('Câmara de Lobos', -16.97, 32.6501),
    stop('Funchal', -16.91, 32.6501),
  ],
  routes: { 7: { short: '207' } },
  patterns: [
    { route: 7, stops: [0, 1, 2] },
    { route: 7, stops: [2, 3, 4] },
  ],
  shape: (p: number) => shapes[p]!,
  rideShape: (p: number) => shapes[p]!,
} as unknown as Network;
const there: Direction = { label: 'Funchal → Ribeira Brava', patterns: [0] };
const back: Direction = { label: 'Ribeira Brava → Funchal', patterns: [1] };
const fillOf = (c: ReturnType<typeof routeContent>, s: number) =>
  c.points.find((p) => p.stops?.[0] === s)?.fill;

describe('a line on the map', () => {
  it('draws the chosen way in yellow and the way back in turquoise, each on its side', () => {
    const c = routeContent(net, [there, back], 0);
    // The chosen way last, over the way back.
    expect(c.lines.map((l) => [l.color, l.side, l.arrows])).toEqual([
      [WAY_TURQUOISE, true, true],
      [WAY_YELLOW, true, true],
    ]);
    expect(c.lines[1]!.coords).toEqual(shapes[0]);
    // Each stop in the colour of its way; the terminus both share in the chosen one's.
    expect(fillOf(c, 1)).toBe(WAY_YELLOW);
    expect(fillOf(c, 3)).toBe(WAY_TURQUOISE);
    expect(fillOf(c, 2)).toBe(WAY_YELLOW);
    // A line opened is shown alone.
    expect(c.focus).toBeDefined();
  });

  it('turns the way back yellow when it is chosen, the camera staying', () => {
    const a = routeContent(net, [there, back], 0);
    const b = routeContent(net, [there, back], 1);
    expect(b.lines.map((l) => l.color)).toEqual([WAY_TURQUOISE, WAY_YELLOW]);
    expect(b.lines[1]!.coords).toEqual(shapes[1]);
    expect(fillOf(b, 3)).toBe(WAY_YELLOW);
    expect(b.fitKey).toBe(a.fitKey);
  });
});

describe('the variants of a line on the map', () => {
  // Back from Ribeira Brava along the coast; on Saturdays one bus by the Via Rápida
  // inland from Câmara de Lobos, rejoining the coast road at Funchal.
  const coast = [stop('', -17.06), stop('', -16.97), stop('', -16.91)];
  const inland = [stop('', -17.06), stop('', -16.97), stop('', -16.94, 32.66), stop('', -16.91)];
  const lines = {
    stops: [stop('Ribeira Brava', -17.06), stop('Funchal', -16.91)],
    patterns: [
      { route: 7, stops: [0, 1], trips: [[0, 36000, 0, 'weekday']] },
      { route: 7, stops: [0, 1], trips: [[1, 27000, 0, 'saturday']] },
    ],
    shape: (p: number) => (p === 0 ? coast : inland),
    isServiceActive: (service: number, date: string) => service === (date === '2026-10-10' ? 1 : 0),
  } as unknown as Network;
  const way: Direction = { label: 'Ribeira Brava → Funchal', patterns: [0, 1] };

  it('leaves out a variant on the days it does not run', () => {
    const monday = routeContent(lines, [way], 0, '2026-10-05');
    expect(monday.lines.map((l) => l.coords)).toEqual([coast]);
  });

  it('draws a variant only where it leaves the main road, with arrows', () => {
    const note = { title: 'Separate run', lines: ['Saturday: 07:30'] };
    const saturday = routeContent(lines, [way], 0, '2026-10-10', () => note);
    // Tapped, it tells when it runs; the main way says nothing.
    expect(saturday.lines.map((l) => l.note)).toEqual([undefined, note]);
    expect(saturday.lines).toHaveLength(2);
    const detour = saturday.lines[1]!;
    expect(detour).toMatchObject({ arrows: true, side: true, width: 3.5 });
    // From where it leaves the coast road to where it comes back to it.
    expect(Math.max(...detour.coords.map((c) => c.lat))).toBeCloseTo(32.66);
    expect(Math.min(...detour.coords.map((c) => c.lon))).toBeGreaterThan(-16.98);
    expect(Math.max(...detour.coords.map((c) => c.lon))).toBeLessThan(-16.9);
  });
});

describe('a route on the map', () => {
  const ride = (s: number) => ({ ...net.stops[s]!, stop: s });
  const it207 = {
    key: 'T1:0-2',
    depart: 36000,
    legs: [
      {
        kind: 'ride',
        route: 7,
        pattern: 0,
        boardPos: 0,
        alightPos: 2,
        from: ride(0),
        to: ride(2),
        stops: [{ stop: 0 }, { stop: 1 }, { stop: 2 }],
      },
    ],
  } as unknown as Itinerary;

  it('is neon yellow with arrows the way the bus goes', () => {
    const c = itineraryContent(net, it207);
    expect(c.lines).toEqual([
      { coords: shapes[0], color: WAY_YELLOW, width: 6, label: '207', arrows: true },
    ]);
  });

  it('is shown alone once chosen, not while it is only the first of the list', () => {
    expect(itineraryContent(net, it207).focus).toBeUndefined();
    const chosen = itineraryContent(net, it207, undefined, true).focus;
    expect(chosen).toBeDefined();
    // A step brought close up is still the same route.
    expect(itineraryContent(net, it207, 0, true).focus).toBe(chosen);
  });

  it('gives each bus its own colour, red where it is boarded and dark blue where left', () => {
    // There on the 207 and back on it: two buses, changing at Ribeira Brava.
    const back = { ...it207.legs[0]!, pattern: 1, from: ride(2), to: ride(4) };
    const twoBuses = { ...it207, legs: [it207.legs[0]!, back] } as Itinerary;
    const c = itineraryContent(net, twoBuses);
    expect(c.lines.map((l) => [l.color, l.arrows])).toEqual([
      [RIDE_COLORS[0], true],
      [RIDE_COLORS[1], true],
    ]);
    expect(RIDE_COLORS[0]).not.toBe(RIDE_COLORS[1]);
    const dots = c.points.filter((p) => p.kind === 'board' || p.kind === 'alight');
    expect(dots.map((p) => [p.kind, p.fill, p.stops?.[0]])).toEqual([
      ['board', RIDE_START, 0],
      ['alight', RIDE_END, 2],
      ['board', RIDE_START, 2],
      ['alight', RIDE_END, 4],
    ]);
  });
});
