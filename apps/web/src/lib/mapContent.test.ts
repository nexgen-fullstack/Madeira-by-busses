import { describe, expect, it } from 'vitest';
import type { Itinerary, Network } from '@madeirabus/engine';
import type { Direction } from './lines.ts';
import {
  BIKE_GREEN,
  CAR_BLUE,
  itineraryContent,
  FLAG_FOOT,
  RIDE_COLORS,
  RIDE_WIDTH,
  routeContent,
  RUN_WIDTH,
  travelContent,
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
  lane: (p: number) => shapes[p]!,
  rideShape: (p: number) => shapes[p]!,
  rideLane: (p: number) => shapes[p]!,
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

describe('the two ways of a line on one road', () => {
  it('puts each stop on its way, to its side, heading the way its bus goes', () => {
    const c = routeContent(net, [there, back], 0);
    const at = (s: number) => c.points.find((p) => p.stops?.[0] === s)!;
    // Westward there (270°), eastward back (90°): each drawn on its own right.
    expect(at(1).heading).toBe(270);
    expect(at(3).heading).toBe(90);
    // On the line itself, not the pavement it is mapped on.
    expect(at(3).lat).toBeCloseTo(32.6501, 6);
  });

  it('draws the ways apart only where they share a road, not on one-way streets', () => {
    // Back through Câmara de Lobos by a street 200 m north, one way, then the coast again.
    const loop = [
      stop('', -17.06, 32.6501),
      stop('', -16.98, 32.6501),
      stop('', -16.98, 32.652),
      stop('', -16.96, 32.652),
      stop('', -16.96, 32.6501),
      stop('', -16.91, 32.6501),
    ];
    const oneWay = {
      ...net,
      lane: (p: number) => (p === 0 ? shapes[0]! : loop),
    } as unknown as Network;
    const c = routeContent(oneWay, [there, back], 0);
    const backLines = c.lines.filter((l) => l.color === WAY_TURQUOISE);
    expect(backLines.map((l) => l.side)).toEqual([true, false, true]);
    // The street of its own in the middle, from the coast road and back to it.
    const street = backLines[1]!.coords;
    expect(Math.max(...street.map((p) => p.lat))).toBeCloseTo(32.652, 4);
    expect(street[0]!.lat).toBeCloseTo(32.6501, 3);
    // The way there is alone on the coast road along that street: in the middle there too.
    const thereLines = c.lines.filter((l) => l.color === WAY_YELLOW);
    expect(thereLines.map((l) => l.side)).toEqual([true, false, true]);
  });

  it('keeps a line crossing the other way back on one side of the road', () => {
    // The way back crosses the way there's road (north to south) once.
    const across = [stop('', -16.95, 32.66), stop('', -16.95, 32.64)];
    const cross = {
      ...net,
      lane: (p: number) => (p === 0 ? shapes[0]! : across),
    } as unknown as Network;
    const c = routeContent(cross, [there, back], 0);
    expect(c.lines.map((l) => l.side)).toEqual([false, false]);
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
    lane: (p: number) => (p === 0 ? coast : inland),
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
    // With no way back on its roads, in the middle of them.
    expect(detour).toMatchObject({ arrows: true, side: false, width: RUN_WIDTH });
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
      {
        coords: shapes[0],
        color: WAY_YELLOW,
        width: RIDE_WIDTH,
        label: '207',
        arrows: true,
        // Tapped, its card: which bus, and the next ones from where it is boarded.
        route: 7,
        pattern: 0,
        board: 0,
      },
    ]);
  });

  it('is shown alone once chosen, not while it is only the first of the list', () => {
    expect(itineraryContent(net, it207).focus).toBeUndefined();
    const chosen = itineraryContent(net, it207, undefined, true).focus;
    expect(chosen).toBeDefined();
    // A step brought close up is still the same route.
    expect(itineraryContent(net, it207, 0, true).focus).toBe(chosen);
  });

  it('gives each bus its own colour, its flags on its side of the road', () => {
    // There on the 207 and back on it: two buses, changing at Ribeira Brava.
    const back = { ...it207.legs[0]!, pattern: 1, from: ride(2), to: ride(4) };
    const twoBuses = { ...it207, legs: [it207.legs[0]!, back] } as Itinerary;
    const c = itineraryContent(net, twoBuses);
    expect(c.lines.map((l) => [l.color, l.arrows])).toEqual([
      [RIDE_COLORS[0], true],
      [RIDE_COLORS[1], true],
    ]);
    expect(RIDE_COLORS[0]).not.toBe(RIDE_COLORS[1]);
    // A start flag where each bus is boarded and a chequered one where it is left, standing
    // where the bus runs (the way back runs across the road from its stops).
    const flags = c.points.filter((p) => p.kind === 'board' || p.kind === 'alight');
    expect(flags.map((p) => [p.kind, p.fill, p.stops?.[0], p.lat])).toEqual([
      ['board', FLAG_FOOT, 0, shapes[0]![0]!.lat],
      ['alight', FLAG_FOOT, 2, shapes[0]![1]!.lat],
      ['board', FLAG_FOOT, 2, shapes[1]![0]!.lat],
      ['alight', FLAG_FOOT, 4, shapes[1]![1]!.lat],
    ]);
    // The chequered flag says where the journey ends: no pin over it.
    expect(c.points.some((p) => p.kind === 'destination')).toBe(false);
  });

  it('stands the flags a little apart where one bus is left and the next boarded', () => {
    // Left at Ribeira Brava and on from the same pole by another bus.
    const onward = [shapes[0]![1]!, stop('', -17.1)];
    const sameStop = {
      ...net,
      rideLane: (p: number) => (p === 0 ? shapes[0]! : onward),
    } as unknown as Network;
    const next = { ...it207.legs[0]!, pattern: 1, from: ride(2), to: ride(4) };
    const c = itineraryContent(sameStop, { ...it207, legs: [it207.legs[0]!, next] } as Itinerary);
    const change = c.points.filter((p) => p.stops?.[0] === 2);
    expect(change.map((p) => [p.kind, p.pair])).toEqual([
      ['alight', true],
      ['board', true],
    ]);
    // One stop, one name.
    expect(change.map((p) => p.label)).toEqual(['Ribeira Brava', undefined]);
    // Where the journey starts, nothing to share.
    expect(c.points.find((p) => p.stops?.[0] === 0)?.pair).toBeUndefined();
  });

  it('walks to the very spot where the bus is boarded', () => {
    const walk = {
      kind: 'walk',
      from: { name: 'Hotel', lat: 32.64, lon: -16.9 },
      to: ride(0),
      path: [stop('', -16.9, 32.64), stop('Funchal', -16.91)],
    };
    const c = itineraryContent(net, { ...it207, legs: [walk, it207.legs[0]!] } as Itinerary);
    expect(c.lines[0]!.coords.at(-1)).toEqual(shapes[0]![0]);
  });

  it('walks along the pavement, not down the middle of the road', () => {
    // From a door north of the road, 300 m west along it to the stop, its pavement 3 m out.
    const walk = {
      kind: 'walk',
      from: { name: 'Hotel', lat: 32.6502, lon: -16.9068 },
      to: ride(0),
      path: [
        stop('', -16.9068, 32.6502),
        stop('', -16.9068),
        stop('', -16.91),
        stop('Funchal', -16.91, 32.65001),
      ],
      kerb: [0, 3, 0],
    };
    const c = itineraryContent(net, { ...it207, legs: [walk, it207.legs[0]!] } as Itinerary);
    const along = c.lines[0]!.coords.slice(1, 3);
    // On the north pavement, the door's side of the road: about 3 m north of its middle.
    for (const p of along) expect((p.lat - 32.65) * 110_540).toBeCloseTo(3, 0);
  });
});

describe('a way by car, on foot or by bike', () => {
  const path = [stop('', -16.91), stop('', -16.95), stop('', -16.97)];
  it('draws a car in blue with arrows, a walk as dots, from its start to the pin', () => {
    const car = travelContent({ mode: 'car', path, length: 6000, seconds: 600 });
    expect(car.lines).toMatchObject([{ color: CAR_BLUE, arrows: true }]);
    expect(car.points.map((p) => p.kind)).toEqual(['origin', 'destination']);
    expect(car.points[1]).toMatchObject({ lat: 32.65, lon: -16.97 });
    const walk = travelContent({ mode: 'walk', path, length: 6000, seconds: 4800 });
    expect(walk.lines).toMatchObject([{ dashed: true }]);
    // Each way fitted of its own, and the bike in green.
    expect(walk.fitKey).not.toBe(car.fitKey);
    const bike = travelContent({ mode: 'bike', path, length: 6000, seconds: 1500 });
    expect(bike.lines[0]!.color).toBe(BIKE_GREEN);
  });
});
