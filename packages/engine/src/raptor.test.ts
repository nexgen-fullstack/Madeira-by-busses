import { describe, expect, it } from 'vitest';
import { buildBundle } from './bundle.ts';
import { toCsv } from './csv.ts';
import { SIGA_FARES_2026 } from './fares.ts';
import { parseGtfs } from './gtfs.ts';
import { Network } from './network.ts';
import {
  itineraryCost,
  paretoFilter,
  Planner,
  type Itinerary,
  type RideLeg,
  type WalkLeg,
} from './raptor.ts';
import { haversine, type LatLon } from './geo.ts';
import { at, fixtureNetwork, SATURDAY, STOPS, stopIndex, WEEKDAY } from './test-fixtures.ts';
import { encodeWalkGraph, WalkGraph, WALK_STREET } from './walk.ts';

const net = fixtureNetwork();
const planner = new Planner(net);
const place = (id: keyof typeof STOPS) => ({ ...STOPS[id], name: id, stops: [stopIndex(net, id)] });
const rides = (it: Itinerary) => it.legs.filter((l): l is RideLeg => l.kind === 'ride');
const routeOf = (l: RideLeg) => net.routes[l.route]!.short;

describe('Planner', () => {
  it('prefers the express when it leaves later and arrives earlier', () => {
    const [best] = planner.plan({
      from: place('A'),
      to: place('D'),
      date: WEEKDAY,
      time: at(7, 55),
    });
    expect(best).toBeDefined();
    expect(rides(best!).map(routeOf)).toEqual(['4X']);
    expect(best!.depart).toBe(at(8, 5));
    expect(best!.arrive).toBe(at(8, 20));
  });

  it('returns several departures in arrival order', () => {
    const results = planner.plan({
      from: place('A'),
      to: place('B'),
      date: WEEKDAY,
      time: at(9, 0),
    });
    // A and B are ~940 m apart, so walking is offered too.
    expect(results.some((r) => r.rides === 0)).toBe(true);
    const buses = results.filter((r) => r.rides > 0);
    expect(buses.length).toBeGreaterThanOrEqual(3);
    const departs = buses.map((r) => r.depart);
    expect(departs).toEqual([...departs].sort((a, b) => a - b));
    expect(departs[0]).toBe(at(9, 0));
    expect(departs[1]).toBe(at(9, 30));
  });

  it('finds a transfer and leaves as late as possible', () => {
    const [best] = planner.plan({
      from: place('A'),
      to: place('E'),
      date: WEEKDAY,
      time: at(7, 0),
      options: { longWalk: 0 },
    });
    const r = rides(best!);
    expect(r.map(routeOf)).toEqual(['1', '2']);
    expect(best!.transfers).toBe(1);
    // 07:00 from A reaches C at 07:20 and misses the 07:15; the 07:30 makes the 08:15.
    expect(r[0]!.start).toBe(at(7, 30));
    expect(r[1]!.start).toBe(at(8, 15));
    expect(r[1]!.wait).toBe(at(8, 15) - at(7, 50));
    expect(best!.arrive).toBe(at(8, 25));
  });

  it('offers a longer walk from the last stop when it beats waiting for the next bus', () => {
    // C → E is ~1.1 km: on foot from the 07:50 at C rather than waiting for the 08:15 to E.
    const results = planner.plan({
      from: place('A'),
      to: place('E'),
      date: WEEKDAY,
      time: at(7, 0),
    });
    const [best] = results;
    expect(rides(best!).map(routeOf)).toEqual(['1']);
    expect(best!.legs.map((l) => l.kind)).toEqual(['ride', 'walk']);
    expect(best!.legs[1]!.end - best!.legs[1]!.start).toBeGreaterThan(10 * 60);
    expect(best!.arrive).toBeLessThan(at(8, 25));
    // The two buses stay on offer for those who would rather not walk.
    expect(results.some((it) => rides(it).map(routeOf).join() === '1,2')).toBe(true);
  });

  it('keeps the usual walks when a long one gains nothing', () => {
    // A → D: the bus goes all the way; walking from C saves nothing worth the walk.
    const [best] = planner.plan({
      from: place('A'),
      to: place('D'),
      date: WEEKDAY,
      time: at(9, 0),
    });
    expect(best!.legs.map((l) => l.kind)).toEqual(['ride']);
  });

  it('walks between stops to make a connection', () => {
    const [best] = planner.plan({
      from: place('A'),
      to: place('G'),
      date: WEEKDAY,
      time: at(7, 0),
    });
    expect(best).toBeDefined();
    const kinds = best!.legs.map((l) => (l.kind === 'ride' ? routeOf(l) : 'walk'));
    expect(kinds).toEqual(['1', '2', 'walk', '3']);
    const walk = best!.legs[2] as WalkLeg;
    expect(walk.kind).toBe('walk');
    expect(walk.distance).toBeGreaterThan(150);
    expect(walk.distance).toBeLessThan(260);
  });

  it('also boards at stops a short walk from the chosen stop', () => {
    // E is only a terminus; the R3 bus to G leaves from F, ~200 m away.
    const plan = (stopWalk: number) =>
      planner.plan({
        from: place('E'),
        to: place('G'),
        date: WEEKDAY,
        time: at(9, 30),
        options: { stopWalk },
      });
    const [best] = plan(400);
    expect(best!.legs.map((l) => l.kind)).toEqual(['walk', 'ride']);
    expect(rides(best!).map(routeOf)).toEqual(['3']);
    expect((best!.legs[0] as WalkLeg).distance).toBeGreaterThan(150);
    // Without it, nothing leaves from E itself.
    expect(plan(0)).toEqual([]);
  });

  it('respects the service calendar', () => {
    const results = planner.plan({
      from: place('A'),
      to: place('D'),
      date: SATURDAY,
      time: at(9, 0),
    });
    expect(results.filter((r) => r.rides > 0)).toHaveLength(0);
  });

  it('runs trips after midnight from the previous service day', () => {
    // Friday 24:30 → Saturday 00:30.
    const results = planner.plan({
      from: place('A'),
      to: place('B'),
      date: SATURDAY,
      time: at(0, 10),
    });
    const first = results.find((r) => r.rides > 0);
    expect(first).toBeDefined();
    expect(rides(first!)[0]!.start).toBe(at(0, 30));
  });

  it('walks from a coordinate to the nearest stop, timed to catch the bus', () => {
    const from = { lat: STOPS.A.lat, lon: STOPS.A.lon - 0.003, name: 'Hotel' }; // ~280 m west of A
    const [best] = planner.plan({ from, to: place('D'), date: WEEKDAY, time: at(9, 50) });
    expect(best!.legs[0]!.kind).toBe('walk');
    const ride = rides(best!)[0]!;
    expect(ride.start).toBe(at(10, 0));
    expect(ride.wait).toBe(0);
    expect(best!.depart).toBe(ride.start - (best!.legs[0]!.end - best!.legs[0]!.start));
  });

  it('walks to the stop along the streets and brings the way to draw', () => {
    // A hotel 300 m north and 200 m east of stop A; the only street goes south
    // from it to the main road (A–B–C–D), then west to A: 500 m, not 360 m.
    const off = (p: LatLon, east: number, north: number): LatLon => ({
      lat: p.lat + north / 110_574,
      lon: p.lon + east / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
    });
    const hotel = off(STOPS.A, 200, 300);
    const corner = off(STOPS.A, 200, 0);
    const walk = WalkGraph.decode(
      encodeWalkGraph({
        nodes: [hotel, corner, STOPS.A, STOPS.B, STOPS.D],
        edges: [
          { from: 0, to: 1, kind: WALK_STREET, points: [] },
          { from: 1, to: 2, kind: WALK_STREET, points: [] },
          { from: 1, to: 3, kind: WALK_STREET, points: [] },
          { from: 3, to: 4, kind: WALK_STREET, points: [] },
        ],
      }),
    );
    const streets = new Planner(net, walk);
    const from = { ...hotel, name: 'Hotel' };
    const [best] = streets.plan({ from, to: place('D'), date: WEEKDAY, time: at(7, 50) });
    expect(rides(best!).map(routeOf)).toEqual(['4X']);
    const first = best!.legs[0] as WalkLeg;
    expect(first.kind).toBe('walk');
    expect(first.distance).toBeGreaterThan(495);
    expect(first.distance).toBeLessThan(510);
    expect(haversine(first.path![0]!, hotel)).toBeLessThan(1);
    expect(first.path!.some((p) => haversine(p, corner) < 2)).toBe(true);
    // As the crow flies it would have been ~360 m.
    const [straight] = planner.plan({ from, to: place('D'), date: WEEKDAY, time: at(7, 50) });
    expect((straight!.legs[0] as WalkLeg).path).toBeUndefined();
  });

  it('prices rides by municipality', () => {
    const [toC] = planner.plan({ from: place('A'), to: place('C'), date: WEEKDAY, time: at(9, 0) });
    expect(toC!.fare.giro).toBe(1.45);
    const [toD] = planner.plan({ from: place('A'), to: place('D'), date: WEEKDAY, time: at(9, 0) });
    expect(toD!.fare.giro).toBe(1.95);
    expect(toD!.fare.cash).toBe(2.6);
  });

  it('arrives by a time, leaving as late as possible', () => {
    const results = planner.plan({
      from: place('A'),
      to: place('D'),
      date: WEEKDAY,
      time: at(9, 0),
      arriveBy: true,
    });
    expect(results.length).toBeGreaterThan(1);
    expect(results.every((r) => r.arrive <= at(9, 0))).toBe(true);
    // The 08:30 gets to D at 09:00 sharp; the express at 08:05 is there by 08:20.
    expect(Math.max(...results.map((r) => r.depart))).toBe(at(8, 30));
    expect(results.some((r) => rides(r).map(routeOf).join() === '4X')).toBe(true);
  });

  it('finds the last connection of the day', () => {
    const last = planner.lastConnection({
      from: place('A'),
      to: place('D'),
      date: WEEKDAY,
      time: at(12, 0),
    });
    expect(last).toBeDefined();
    expect(rides(last!)[0]!.start).toBe(at(20, 0));
  });

  it('flags a tight transfer when the next bus is far off', () => {
    const [best] = planner.plan({
      from: place('A'),
      to: place('E'),
      date: WEEKDAY,
      time: at(7, 0),
      options: { minTransferTime: 60 },
    });
    // 07:30 → C 07:50 → R2 08:15: 25 min buffer, not risky.
    expect(best!.risky).toBe(false);
  });
});

/**
 * Lines from P to Q, 3 km apart: each with its name, the minutes after midnight its
 * buses leave and how many minutes they take.
 */
function linesFromPtoQ(lines: readonly [name: string, starts: number[], minutes: number][]) {
  const stopTimes: (string | number)[][] = [];
  const trips: string[][] = [];
  const time = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  for (const [route, starts, minutes] of lines) {
    starts.forEach((t0, h) => {
      const id = `${route}${h}`;
      trips.push([route, 'WK', id]);
      stopTimes.push(
        [id, time(t0), time(t0), 'P', 1],
        [id, time(t0 + minutes), time(t0 + minutes), 'Q', 2],
      );
    });
  }
  const feed = parseGtfs({
    'agency.txt': toCsv(
      ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
      [['T', 'Test', 'https://example.com', 'Atlantic/Madeira']],
    ),
    'stops.txt': toCsv(
      ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'],
      [
        ['P', 'P', 32.65, -16.95, 'FNC'],
        ['Q', 'Q', 32.65, -16.918, 'FNC'],
      ],
    ),
    'routes.txt': toCsv(
      ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      lines.map(([name]) => [name, 'T', name, `P - Q (${name})`, 3]),
    ),
    'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], trips),
    'stop_times.txt': toCsv(
      ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
      stopTimes,
    ),
    'calendar.txt': toCsv(
      [
        'service_id',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'start_date',
        'end_date',
      ],
      [['WK', 1, 1, 1, 1, 1, 0, 0, '20260101', '20271231']],
    ),
  });
  const net = new Network(
    buildBundle([{ feed, source: { name: 'test' } }], { demo: true, fares: SIGA_FARES_2026 })
      .bundle,
  );
  const stop = (id: string) => {
    const i = net.stops.findIndex((s) => s.id === id);
    return { ...net.stops[i]!, stops: [i] };
  };
  const line = (it: Itinerary) =>
    it.legs.flatMap((l) => (l.kind === 'ride' ? [net.routes[l.route]!.short] : []));
  return { net, from: stop('P'), to: stop('Q'), line };
}

describe('the best of the options', () => {
  it('is the express that gets there a few minutes after the slow bus', () => {
    // The bus round the coast takes an hour; the one on the Via Rápida leaves 40
    // minutes later and gets there 10 minutes after it.
    const { net, from, to, line } = linesFromPtoQ([
      ['Coast', [9 * 60], 60],
      ['VR', [9 * 60 + 40], 30],
    ]);
    const results = new Planner(net).plan({ from, to, date: WEEKDAY, time: at(8, 55) });
    expect(results.map(line)).toEqual([['VR'], ['Coast']]);
    expect(results[0]!.depart).toBe(at(9, 40));
  });

  it('is still the slow bus when the express gets there much later', () => {
    const { net, from, to, line } = linesFromPtoQ([
      ['Coast', [9 * 60], 60],
      ['VR', [9 * 60 + 50], 30],
    ]);
    const results = new Planner(net).plan({ from, to, date: WEEKDAY, time: at(8, 55) });
    expect(results.map(line)[0]).toEqual(['Coast']);
  });

  it('may be the way on other lines, when that is cheaper and as quick', () => {
    // The Aerobus (dearer) gets there a minute before the town bus.
    const { net, from, to, line } = linesFromPtoQ([
      ['Aerobus', [8 * 60], 20],
      ['Town', [8 * 60], 21],
    ]);
    const results = new Planner(net).plan({ from, to, date: WEEKDAY, time: at(7, 55) });
    expect(results.map(line)).toEqual([['Town'], ['Aerobus']]);
    expect(results[0]!.alternative).toBeUndefined();
    expect(results[1]!.alternative).toBe(true);
  });
});

describe('ways on other lines', () => {
  it('offers another line besides the best one', () => {
    // X takes 20 minutes, Y the slower road takes 35.
    const { net, from, to, line } = linesFromPtoQ([
      ['X', [8 * 60, 9 * 60, 10 * 60], 20],
      ['Y', [8 * 60 + 5, 9 * 60 + 5, 10 * 60 + 5], 35],
    ]);
    const results = new Planner(net).plan({
      from,
      to,
      date: WEEKDAY,
      time: at(7, 55),
      options: { maxResults: 1 },
    });
    expect(results.map(line)).toEqual([['X'], ['Y']]);
    expect(results[0]!.alternative).toBeUndefined();
    expect(results[1]!.alternative).toBe(true);
    expect(results[1]!.depart).toBe(at(8, 5));
  });
});

describe('paretoFilter', () => {
  const it0 = (depart: number, arrive: number, ridesCount: number) =>
    ({ depart, arrive, rides: ridesCount }) as Itinerary;

  it('drops dominated options and keeps trade-offs', () => {
    const a = it0(100, 200, 1);
    const b = it0(90, 210, 1); // dominated by a
    const c = it0(120, 190, 2); // faster but one more ride: kept
    expect(paretoFilter([a, b, c])).toEqual([a, c]);
  });

  it('only offers an extra transfer when it saves enough time', () => {
    const direct = it0(100, 1000, 1);
    const quicker = it0(100, 500, 2); // saves 500 s with one change: kept
    const marginal = it0(100, 900, 2); // saves 100 s: hidden
    const twoChanges = it0(100, 400, 3); // vs `quicker`: saves 100 s with one more change
    expect(paretoFilter([direct, quicker, marginal, twoChanges], 300)).toEqual([direct, quicker]);
    // Walking only is not a transfer.
    const walk = it0(100, 1050, 0);
    expect(paretoFilter([walk, direct], 300)).toEqual([walk, direct]);
  });
});

describe('itineraryCost', () => {
  const option = (depart: number, arrive: number, transfers: number, cash: number, walk: number) =>
    ({
      depart,
      arrive,
      duration: arrive - depart,
      rides: transfers + 1,
      transfers,
      fare: { cash, knownGiro: cash },
      legs: [{ kind: 'walk', start: depart, end: depart + walk }],
    }) as unknown as Itinerary;

  it('prefers fewer changes and a lower fare to leaving a little later', () => {
    // Levada Cavalo → Tabua, both at 16:42: three buses for 6.60 € leaving at 14:08,
    // or two for 4.60 € leaving at 13:41.
    const threeBuses = option(at(14, 8), at(16, 42), 2, 6.6, 12 * 60);
    const twoBuses = option(at(13, 41), at(16, 42), 1, 4.6, 20 * 60);
    expect(itineraryCost(twoBuses)).toBeLessThan(itineraryCost(threeBuses));
  });

  it('still prefers getting there much sooner', () => {
    // The express and half an hour on foot, an hour earlier than the bus to the door.
    const expressAndWalk = option(at(13, 41), at(15, 30), 1, 4.6, 35 * 60);
    const toTheDoor = option(at(13, 41), at(16, 42), 1, 4.6, 12 * 60);
    expect(itineraryCost(expressAndWalk)).toBeLessThan(itineraryCost(toTheDoor));
  });

  it('puts the best option first, then the others by arrival', () => {
    const results = planner.plan({
      from: place('A'),
      to: place('D'),
      date: WEEKDAY,
      time: at(7, 55),
    });
    const costs = results.map((it) => itineraryCost(it));
    expect(costs[0]).toBe(Math.min(...costs.slice(0, results.length)));
    const arrivals = results.slice(1).map((it) => it.arrive);
    expect(arrivals).toEqual([...arrivals].sort((a, b) => a - b));
  });
});
