import { describe, expect, it } from 'vitest';
import type { Itinerary, Network } from '@madeirabus/engine';
import type { Direction } from './lines.ts';
import { itineraryContent, routeContent, WAY_TURQUOISE, WAY_YELLOW } from './mapContent.ts';

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
});
