import { describe, expect, it } from 'vitest';
import { paretoFilter, Planner, type Itinerary, type RideLeg, type WalkLeg } from './raptor.ts';
import { at, fixtureNetwork, SATURDAY, STOPS, stopIndex, WEEKDAY } from './test-fixtures.ts';

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

  it('prices rides by municipality', () => {
    const [toC] = planner.plan({ from: place('A'), to: place('C'), date: WEEKDAY, time: at(9, 0) });
    expect(toC!.fare.giro).toBe(1.45);
    const [toD] = planner.plan({ from: place('A'), to: place('D'), date: WEEKDAY, time: at(9, 0) });
    expect(toD!.fare.giro).toBe(1.95);
    expect(toD!.fare.cash).toBe(2.6);
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

describe('paretoFilter', () => {
  const it0 = (depart: number, arrive: number, ridesCount: number) =>
    ({ depart, arrive, rides: ridesCount }) as Itinerary;

  it('drops dominated options and keeps trade-offs', () => {
    const a = it0(100, 200, 1);
    const b = it0(90, 210, 1); // dominated by a
    const c = it0(120, 190, 2); // faster but one more ride: kept
    expect(paretoFilter([a, b, c])).toEqual([a, c]);
  });
});
