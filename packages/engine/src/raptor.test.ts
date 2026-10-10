import { describe, expect, it } from 'vitest';
import { buildBundle } from './bundle.ts';
import { toCsv } from './csv.ts';
import { SIGA_FARES_2026 } from './fares.ts';
import { parseGtfs } from './gtfs.ts';
import { Network } from './network.ts';
import {
  bestOf,
  hasView,
  isBusStation,
  isScenicWalk,
  itineraryCost,
  longEndWalks,
  outdoes,
  paretoFilter,
  Planner,
  DEFAULT_PLAN_OPTIONS,
  ROUTE_PREFERENCES,
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
    // Without it, no bus leaves from E itself: walking all the way is what is left.
    expect(plan(0).map((it) => it.rides)).toEqual([0]);
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

  it('walks up to the start of a trail from the stop its path leads to, never straight over the hill', () => {
    // A trailhead 1.7 km up the hill north of B, nearest E and F as the crow flies; its
    // only path comes down to D: 3.6 km, beyond any usual walk to a bus.
    const off = (p: LatLon, east: number, north: number): LatLon => ({
      lat: p.lat + north / 110_574,
      lon: p.lon + east / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
    });
    const trailhead = off(STOPS.B, 0, 1700);
    const above = { lat: trailhead.lat, lon: STOPS.D.lon };
    const walk = WalkGraph.decode(
      encodeWalkGraph({
        nodes: [trailhead, above, STOPS.D, STOPS.A],
        edges: [
          { from: 0, to: 1, kind: WALK_STREET, points: [] },
          { from: 1, to: 2, kind: WALK_STREET, points: [] },
          { from: 3, to: 2, kind: WALK_STREET, points: [] },
        ],
      }),
    );
    const paths = new Planner(net, walk);
    const to = { ...trailhead, name: 'Trail' };
    const [best] = paths.plan({ from: place('A'), to, date: WEEKDAY, time: at(7, 50) });
    const last = best!.legs.at(-1) as WalkLeg;
    expect(last.kind).toBe('walk');
    expect(last.from.stop).toBe(stopIndex(net, 'D'));
    expect(last.distance).toBeGreaterThan(3500);
    expect(haversine(last.path!.at(-1)!, trailhead)).toBeLessThan(1);
    expect(last.path!.some((p) => haversine(p, above) < 2)).toBe(true);
    // At the pace of the walk, not of the crow's 1.1 km.
    expect(last.end - last.start).toBeGreaterThan(2800);
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
 * Lines from P to Q, 3 km apart (or Q as far east as `qLon`): each with its name, the
 * minutes after midnight its buses leave and how many minutes they take.
 */
function linesFromPtoQ(
  lines: readonly [name: string, starts: number[], minutes: number][],
  qLon = -16.918,
) {
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
        ['Q', 'Q', 32.65, qLon, 'FNC'],
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

describe('walking', () => {
  const onFoot = (it: Itinerary) =>
    it.legs.reduce((t, l) => t + (l.kind === 'walk' ? l.end - l.start : 0), 0);

  it('walks all the way when no bus goes, even a couple of kilometres', () => {
    // No buses at the weekend; E to G is 2.2 km.
    const results = planner.plan({
      from: place('E'),
      to: place('G'),
      date: SATURDAY,
      time: at(9, 0),
    });
    expect(results.map((it) => it.rides)).toEqual([0]);
    expect(results[0]!.walkDistance).toBeGreaterThan(2000);
  });

  it('takes a bus to the bus rather than a long walk to it, and offers the walk too', () => {
    // From C the 3 to G is a long walk away at F; the 2 goes to E, round the corner from F,
    // and gets there as soon: more than five minutes on foot is worth a change of bus.
    const from = { ...STOPS.C, name: 'C' };
    const results = planner.plan({ from, to: place('G'), date: WEEKDAY, time: at(9, 0) });
    const best = results[0]!;
    expect(rides(best).map(routeOf)).toEqual(['2', '3']);
    const walk = results.find((it) => rides(it).map(routeOf).join() === '3');
    expect(walk).toBeDefined();
    expect(onFoot(walk!)).toBeGreaterThan(10 * 60);
    expect(onFoot(best)).toBeLessThan(onFoot(walk!) - 5 * 60);
    expect(best.arrive).toBe(walk!.arrive);
  });
});

describe('a change of bus on foot', () => {
  it('walks round by the streets, not across the ravine', () => {
    // Line 1 from A down to B, line 2 from C on to D. B and C are 300 m apart as the crow
    // flies, but the only way between them goes round a ravine: 900 m, 12 minutes.
    const x = (east: number) => -16.95 + east / 93_800;
    const at0 = (h: number, m: number) =>
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    const feed = parseGtfs({
      'agency.txt': toCsv(
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
        [['T', 'Test', 'https://example.com', 'Atlantic/Madeira']],
      ),
      'stops.txt': toCsv(
        ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'],
        [
          ['A', 'A', 32.65, x(-3000), 'FNC'],
          ['B', 'B', 32.65, x(0), 'FNC'],
          ['C', 'C', 32.65, x(300), 'FNC'],
          ['D', 'D', 32.65, x(3300), 'FNC'],
        ],
      ),
      'routes.txt': toCsv(
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
        [
          ['1', 'T', '1', 'A - B', 3],
          ['2', 'T', '2', 'C - D', 3],
        ],
      ),
      'trips.txt': toCsv(
        ['route_id', 'service_id', 'trip_id'],
        [
          ['1', 'WK', 'one'],
          ['2', 'WK', 'two20'],
          ['2', 'WK', 'two40'],
        ],
      ),
      'stop_times.txt': toCsv(
        ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
        [
          ['one', at0(9, 0), at0(9, 0), 'A', 1],
          ['one', at0(9, 10), at0(9, 10), 'B', 2],
          ['two20', at0(9, 20), at0(9, 20), 'C', 1],
          ['two20', at0(9, 30), at0(9, 30), 'D', 2],
          ['two40', at0(9, 40), at0(9, 40), 'C', 1],
          ['two40', at0(9, 50), at0(9, 50), 'D', 2],
        ],
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
    const ravine = new Network(
      buildBundle([{ feed, source: { name: 'test' } }], { demo: true, fares: SIGA_FARES_2026 })
        .bundle,
    );
    const stop = (id: string) => ravine.stops.findIndex((st) => st.id === id);
    const pt = (east: number, north = 0): LatLon => ({
      lat: 32.65 + north / 110_574,
      lon: x(east),
    });
    const streets = WalkGraph.decode(
      encodeWalkGraph({
        nodes: [pt(-3000), pt(0), pt(0, 300), pt(300, 300), pt(300), pt(3300)],
        edges: [
          { from: 0, to: 1, kind: WALK_STREET, points: [] },
          { from: 1, to: 2, kind: WALK_STREET, points: [] },
          { from: 2, to: 3, kind: WALK_STREET, points: [] },
          { from: 3, to: 4, kind: WALK_STREET, points: [] },
          { from: 4, to: 5, kind: WALK_STREET, points: [] },
        ],
      }),
    );
    const request = {
      from: { ...ravine.stops[stop('A')]!, name: 'A', stops: [stop('A')] },
      to: { ...ravine.stops[stop('D')]!, name: 'D', stops: [stop('D')] },
      date: WEEKDAY,
      time: at(8, 55),
      options: { stopWalk: 0, longWalk: 0 },
    };
    // As the crow flies, the 09:20 would be made; round the ravine only the 09:40.
    const crow = new Planner(ravine).plan(request).find((it) => it.rides === 2)!;
    expect(rides(crow)[1]!.start).toBe(at(9, 20));
    const best = new Planner(ravine, streets).plan(request).find((it) => it.rides === 2)!;
    expect(rides(best)[1]!.start).toBe(at(9, 40));
    const change = best.legs.find(
      (l): l is WalkLeg => l.kind === 'walk' && l.from.stop !== undefined,
    )!;
    expect(change.distance).toBeGreaterThan(880);
    expect(change.end - change.start).toBeGreaterThan(11 * 60);
  });
});

describe('a walk with a view', () => {
  // P and Q 2 km apart: a promenade along the sea between them, and a road behind it a
  // little shorter.
  const Q_LON = -16.9286;
  const shore = (lon: number): LatLon => ({ lat: 32.6494, lon });
  const promenade = () =>
    WalkGraph.decode(
      encodeWalkGraph({
        nodes: [
          { lat: 32.65, lon: -16.95 },
          { lat: 32.65, lon: Q_LON },
        ],
        edges: [
          { from: 0, to: 1, kind: WALK_STREET, points: [] },
          {
            from: 0,
            to: 1,
            kind: WALK_STREET,
            points: [shore(-16.945), shore(-16.94), shore(-16.935)],
            scenic: true,
          },
        ],
      }),
    );
  const plan = (starts: number[], options = {}) => {
    const { net, from, to, line } = linesFromPtoQ([['X', starts, 10]], Q_LON);
    const results = new Planner(net, promenade()).plan({
      from: { lat: from.lat, lon: from.lon, name: 'P' },
      to: { lat: to.lat, lon: to.lon, name: 'Q' },
      date: WEEKDAY,
      time: at(9),
      options,
    });
    return { results, line };
  };

  it('goes along the sea, not the road behind it, and is always on offer', () => {
    // The bus at 09:05 is there at 09:15, long before the walk: the best, the walk next.
    const { results, line } = plan([9 * 60 + 5]);
    expect(line(results[0]!)).toEqual(['X']);
    const walk = results[1]!;
    expect(isScenicWalk(walk)).toBe(true);
    const leg = walk.legs[0] as WalkLeg;
    expect(leg.scenic).toBeGreaterThan(leg.distance * 0.9);
    expect(leg.path!.some((p) => p.lat < 32.6496)).toBe(true);
    expect(walk.duration).toBeLessThanOrEqual(35 * 60);
  });

  it('is the best way when the bus is no sooner, and not for those who would rather ride', () => {
    // The bus at 09:20 is there at 09:30, a few minutes after the walk.
    expect(isScenicWalk(plan([9 * 60 + 20]).results[0]!)).toBe(true);
    const lessWalking = { ...ROUTE_PREFERENCES.lessWalking };
    const { results, line } = plan([9 * 60 + 20], lessWalking);
    expect(line(results[0]!)).toEqual(['X']);
    expect(results.some(isScenicWalk)).toBe(true);
  });

  /** Walking all the way: `distance` m in `minutes`, `view` m of it with a view. */
  const walking = (distance: number, minutes: number, view: number, up = 0, straight = distance) =>
    ({
      key: 'walk',
      rides: 0,
      transfers: 0,
      depart: at(9),
      arrive: at(9) + minutes * 60,
      duration: minutes * 60,
      walkDistance: distance,
      legs: [
        {
          kind: 'walk',
          from: { name: 'A', lat: 32.65, lon: -16.95 },
          to: { name: 'B', lat: 32.65, lon: -16.95 + straight / 93_800 },
          start: at(9),
          end: at(9) + minutes * 60,
          distance,
          scenic: view,
          up,
        },
      ],
    }) as unknown as Itinerary;

  it('is short, mostly with a view, not steep and not roundabout', () => {
    expect(isScenicWalk(walking(2000, 30, 1300, 90))).toBe(true);
    expect(isScenicWalk(walking(2600, 40, 2000))).toBe(false); // too long
    expect(isScenicWalk(walking(2000, 30, 800))).toBe(false); // too little with a view
    expect(isScenicWalk(walking(2000, 30, 1300, 200))).toBe(false); // too steep
    expect(isScenicWalk(walking(2000, 30, 1300, 0, 1000))).toBe(false); // round a ravine
    // A short walk may bend.
    expect(isScenicWalk(walking(700, 10, 500, 20, 420))).toBe(true);
    expect(hasView(walking(700, 10, 500).legs[0] as WalkLeg)).toBe(true);
    expect(hasView(walking(700, 10, 200).legs[0] as WalkLeg)).toBe(false);
  });
});

describe('the best of the options', () => {
  it('is the express that gets there a few minutes after the slow bus', () => {
    // The bus round the coast takes an hour; the one on the Via Rápida leaves 40
    // minutes later and gets there 10 minutes after it.
    const { net, from, to, line } = linesFromPtoQ([
      ['Coast', [9 * 60], 60],
      ['VR', [9 * 60 + 40], 30],
    ]);
    const results = new Planner(net)
      .plan({ from, to, date: WEEKDAY, time: at(8, 55) })
      .filter((it) => it.rides > 0);
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

describe('the best of the options, arriving by a time', () => {
  /** An option of `rides` buses for `cash` €, with `walk` seconds on foot. */
  const option = (depart: number, arrive: number, rides: number, cash: number, walk: number) =>
    ({
      key: `${depart}|${arrive}|${rides}|${cash}|${walk}`,
      depart,
      arrive,
      duration: arrive - depart,
      rides,
      transfers: Math.max(0, rides - 1),
      walkDistance: Math.round(walk * 1.25),
      fare: { cash, knownGiro: cash, rides: [] },
      legs: [{ kind: 'walk', start: depart, end: depart + walk }],
    }) as unknown as Itinerary;

  it('is the much quicker way that leaves a little earlier', () => {
    // Funchal → Tabua by 20:00 (the owner's phone, 6 October 2026): the 200 and the 336
    // leave at 18:04 and get there at 19:09; the 350 and the 221 leave at 18:17, take half
    // an hour longer and end with a 22-minute walk. The later one used to be "the best".
    const quick = option(at(18, 4), at(19, 9), 2, 4.6, 14 * 60);
    const slow = option(at(18, 17), at(19, 51), 2, 4.6, 33 * 60);
    expect(bestOf([slow, quick], DEFAULT_PLAN_OPTIONS, true)).toBe(quick);
    // Leaving much earlier for it (and walking as much), the later one stays the best.
    const early = option(at(17, 40), at(18, 45), 2, 4.6, 33 * 60);
    expect(bestOf([slow, early], DEFAULT_PLAN_OPTIONS, true)).toBe(slow);
  });

  it('is so in a whole search too', () => {
    const { net, from, to, line } = linesFromPtoQ([
      ['Slow', [18 * 60 + 17], 94],
      ['Quick', [18 * 60 + 4], 65],
    ]);
    const results = new Planner(net).plan({
      from,
      to,
      date: WEEKDAY,
      time: at(20),
      arriveBy: true,
    });
    expect(results.filter((it) => it.rides > 0).map(line)).toEqual([['Quick'], ['Slow']]);
  });

  it('is never a way another one outdoes in every respect', () => {
    // Options at random: there no later (or leaving no earlier), no longer, with no more
    // changes, fare or walking than the best — and better in one — there is none.
    let seed = 7;
    const random = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    for (let round = 0; round < 400; round++) {
      const items = Array.from({ length: 2 + random(6) }, () => {
        const depart = at(8) + random(120) * 60;
        const arrive = depart + (20 + random(100)) * 60;
        return option(depart, arrive, 1 + random(3), [2.6, 4.6, 6.6][random(3)]!, random(40) * 60);
      });
      for (const arriveBy of [false, true]) {
        const best = bestOf(items, DEFAULT_PLAN_OPTIONS, arriveBy)!;
        expect(items.filter((it) => outdoes(it, best, arriveBy))).toEqual([]);
      }
    }
  });

  it('is never outdone in what the planner offers', () => {
    const ids = Object.keys(STOPS) as (keyof typeof STOPS)[];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        for (const time of [at(7), at(8), at(9, 30), at(13), at(19)]) {
          for (const arriveBy of [false, true]) {
            const results = planner.plan({
              from: place(a),
              to: place(b),
              date: WEEKDAY,
              time,
              arriveBy,
            });
            const [best, ...others] = results;
            if (!best) continue;
            expect(others.filter((it) => outdoes(it, best, arriveBy))).toEqual([]);
          }
        }
      }
    }
  });
});

describe('buses already gone', () => {
  // From A to D the 1 leaves every half hour and takes 30 minutes.
  const byTen = { from: place('A'), to: place('D'), date: WEEKDAY, time: at(10), arriveBy: true };
  const buses = (its: Itinerary[]) => its.filter((it) => it.rides > 0);

  it('are no option arriving by a time', () => {
    expect(buses(planner.plan(byTen)).some((it) => it.depart < at(9))).toBe(true);
    // At 09:15 only the 09:30 is left; at 09:45 nothing gets there by 10:00 any more.
    const left = buses(planner.plan({ ...byTen, notBefore: at(9, 15) }));
    expect(left.map((it) => it.depart)).toEqual([at(9, 30)]);
    expect(buses(planner.plan({ ...byTen, notBefore: at(9, 45) }))).toEqual([]);
  });

  it('leaving at a time gone, are looked for from now', () => {
    const results = planner.plan({
      from: place('A'),
      to: place('D'),
      date: WEEKDAY,
      time: at(7),
      notBefore: at(9, 10),
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((it) => it.depart >= at(9, 10))).toBe(true);
  });
});

describe('the first buses of a later day', () => {
  // Friday 9 October 2026: the 1 runs on weekdays, from 06:00 to 20:00.
  const FRIDAY = '2026-10-09';

  it('are those of the next day a bus goes, from its first bus', () => {
    const late = { from: place('A'), to: place('D'), date: FRIDAY, time: at(21) };
    expect(planner.plan(late).filter((it) => it.rides > 0)).toEqual([]);
    // No bus on Saturday or Sunday: Monday from 06:00.
    const ahead = planner.planAhead(late);
    expect(ahead?.date).toBe('2026-10-12');
    expect(Math.min(...ahead!.itineraries.map((it) => it.depart))).toBe(at(6));
    expect(ahead!.itineraries.every((it) => it.rides > 0)).toBe(true);
  });

  it('arriving by a time, are those there by that time that day', () => {
    const ahead = planner.planAhead({
      from: place('A'),
      to: place('D'),
      date: SATURDAY,
      time: at(9),
      arriveBy: true,
    });
    expect(ahead?.date).toBe('2026-10-12');
    expect(ahead!.itineraries.every((it) => it.arrive <= at(9))).toBe(true);
  });

  it('are none when no bus goes there within the week', () => {
    // From A to G only on weekdays too; a week of nothing is asked for with one day.
    expect(
      planner.planAhead({ from: place('A'), to: place('G'), date: FRIDAY, time: at(21) }, 1),
    ).toBeUndefined();
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
    // or two for 4.60 € leaving at 13:41 (short walks to and from both).
    const threeBuses = option(at(14, 8), at(16, 42), 2, 6.6, 4 * 60);
    const twoBuses = option(at(13, 41), at(16, 42), 1, 4.6, 5 * 60);
    expect(itineraryCost(twoBuses)).toBeLessThan(itineraryCost(threeBuses));
  });

  it('takes a bus nearer the door over more than five minutes on foot', () => {
    // Funchal → Tabua at dawn, both there at 08:09: 40 minutes down to the 207 and the 222
    // for 4.60 €, or the 110 from round the corner, then the 207 and the 222 for 6.60 €.
    const walkDown = option(at(5, 56), at(8, 9), 1, 4.6, 43 * 60);
    const busToIt = option(at(6, 9), at(8, 9), 2, 6.6, 8 * 60);
    expect(itineraryCost(busToIt)).toBeLessThan(itineraryCost(walkDown));
    // Up to five minutes on foot is no long walk.
    expect(longEndWalks(option(at(6), at(7), 1, 2.6, 5 * 60))).toBe(0);
    expect(longEndWalks(option(at(6), at(7), 1, 2.6, 12 * 60))).toBe(7 * 60);
  });

  it('counts a climb on foot as worse than the level', () => {
    const level = option(at(9), at(10), 1, 2.6, 4 * 60);
    const uphill = { ...level, legs: [{ ...level.legs[0]!, up: 80 }] } as Itinerary;
    expect(itineraryCost(uphill) - itineraryCost(level)).toBe(80 * 6);
  });

  it('still prefers getting there much sooner', () => {
    // The express and half an hour on foot, an hour earlier than the bus to the door.
    const expressAndWalk = option(at(13, 41), at(15, 30), 1, 4.6, 35 * 60);
    const toTheDoor = option(at(13, 41), at(16, 42), 1, 4.6, 12 * 60);
    expect(itineraryCost(expressAndWalk)).toBeLessThan(itineraryCost(toTheDoor));
  });

  const prefer = (p: keyof typeof ROUTE_PREFERENCES) => ({
    ...DEFAULT_PLAN_OPTIONS,
    ...ROUTE_PREFERENCES[p],
  });

  it('with fewer transfers, takes the direct bus over a change that saves twenty minutes', () => {
    const change = option(at(9), at(10, 10), 1, 4.6, 10 * 60);
    const direct = option(at(9), at(10, 30), 0, 2.6, 10 * 60);
    expect(itineraryCost(change, prefer('best'))).toBeLessThan(
      itineraryCost(direct, prefer('best')),
    );
    expect(itineraryCost(direct, prefer('fewerTransfers'))).toBeLessThan(
      itineraryCost(change, prefer('fewerTransfers')),
    );
    // Both stay on offer: only which one comes first changes.
    expect(paretoFilter([change, direct], prefer('fewerTransfers').transferPenalty)).toHaveLength(
      2,
    );
  });

  it('with less walking, takes the bus to the door over a long walk much sooner', () => {
    const walkMore = option(at(9), at(9, 50), 1, 4.6, 25 * 60);
    const walkLess = option(at(9), at(10, 30), 1, 4.6, 5 * 60);
    expect(itineraryCost(walkMore, prefer('best'))).toBeLessThan(
      itineraryCost(walkLess, prefer('best')),
    );
    expect(itineraryCost(walkLess, prefer('lessWalking'))).toBeLessThan(
      itineraryCost(walkMore, prefer('lessWalking')),
    );
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

describe('more bus, less walking', () => {
  /**
   * The 207 down from X past Cruz, on the hill, to Ribeira Brava's bus station, 370 m
   * on; the 222 on to Tabua from the station. On foot from Cruz one is at the station
   * sooner than the 207, and both make the 222.
   */
  function ribeiraBrava() {
    const time = (h: number, m: number) =>
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    const feed = parseGtfs({
      'agency.txt': toCsv(
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
        [['T', 'Test', 'https://example.com', 'Atlantic/Madeira']],
      ),
      'stops.txt': toCsv(
        ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'],
        [
          ['X', 'Campanário', 32.6667, -17.03, 'RBR'],
          ['C', 'Cruz Ribeira Brava', 32.671482, -17.060921, 'RBR'],
          ['S', 'Estacao Ribeira Brava', 32.673209, -17.064304, 'RBR'],
          ['T', 'Reta Tabua', 32.6779, -17.0781, 'RBR'],
        ],
      ),
      'routes.txt': toCsv(
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
        [
          ['207', 'T', '207', 'Funchal - Ribeira Brava', 3],
          ['222', 'T', '222', 'Ribeira Brava - Furna', 3],
        ],
      ),
      'trips.txt': toCsv(
        ['route_id', 'service_id', 'trip_id'],
        [
          ['207', 'WK', 'a'],
          ['222', 'WK', 'b'],
        ],
      ),
      'stop_times.txt': toCsv(
        ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
        [
          ['a', time(7, 20), time(7, 20), 'X', 1],
          ['a', time(7, 42), time(7, 42), 'C', 2],
          ['a', time(7, 50), time(7, 50), 'S', 3],
          ['b', time(8, 0), time(8, 0), 'S', 1],
          ['b', time(8, 6), time(8, 6), 'T', 2],
        ],
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
      return { ...net.stops[i]!, name: net.stops[i]!.name, stops: [i] };
    };
    return { net, stop };
  }

  it('stays on the bus to the station the next one leaves from', () => {
    const { net, stop } = ribeiraBrava();
    const [best] = new Planner(net).plan({
      from: stop('X'),
      to: stop('T'),
      date: WEEKDAY,
      time: at(7, 0),
      options: { stopWalk: 0, longWalk: 0 },
    });
    const legs = best!.legs;
    // The 207 to the station and the 222 from there, no 370 m down the hill on foot.
    expect(legs.map((l) => (l.kind === 'ride' ? net.routes[l.route]!.short : 'walk'))).toEqual([
      '207',
      '222',
    ]);
    const [first, second] = legs as RideLeg[];
    expect(first!.to.name).toBe('Estacao Ribeira Brava');
    expect(first!.end).toBe(at(7, 50));
    expect(second!.from.stop).toBe(first!.to.stop);
    expect(second!.wait).toBe(10 * 60);
    expect(best!.walkDistance).toBe(0);
    expect(best!.arrive).toBe(at(8, 6));
  });

  it('still walks the last bit when riding on would get there later', () => {
    const { net, stop } = ribeiraBrava();
    // Right by the station: on foot from Cruz at 07:48, by the 207 only at 07:50.
    const station = stop('S');
    const results = new Planner(net).plan({
      from: stop('X'),
      to: { lat: station.lat, lon: station.lon, name: 'By the station' },
      date: WEEKDAY,
      time: at(7, 0),
      options: { stopWalk: 0, longWalk: 0 },
    });
    const ride = results[0]!.legs.find((l): l is RideLeg => l.kind === 'ride')!;
    expect(ride.to.name).toBe('Cruz Ribeira Brava');
    expect(results[0]!.arrive).toBeLessThan(at(7, 50));
  });
});

describe('changing buses at a big station', () => {
  const time = (t: number) =>
    `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String((t / 60) % 60).padStart(2, '0')}:00`;
  /**
   * The 200 from Funchal (F) by Murteira (M), on the hill, down to Ribeira Brava's bus
   * station (S); the 322 from Campanário (R) by M and S on to Tabua (T). Ten more
   * lines leave S. `back`: the other way, the 322 T → S → M and the 200 S → M → F.
   */
  function boaMorte(o: { stationAt200?: number; back?: boolean } = {}) {
    const stops: (string | number)[][] = [
      ['F', 'Hospital', 32.6497, -16.9145, 'FNC'],
      ['R', 'Campanário', 32.6667, -17.03, 'RBR'],
      ['M', 'Murteira, Boa Morte', 32.6705, -17.0605, 'RBR'],
      ['S', 'Estacao Ribeira Brava', 32.673209, -17.064304, 'RBR'],
      ['T', 'Reta Zimbreiros, Tabua', 32.6779, -17.0781, 'RBR'],
    ];
    const routes: (string | number)[][] = [
      ['200', 'T', '200', 'Funchal - Ribeira Brava', 3],
      ['322', 'T', '322', 'Campanário - Ponta do Sol', 3],
    ];
    const trips: string[][] = [
      ['200', 'WK', 'a'],
      ['322', 'WK', 'b'],
    ];
    const run = (trip: string, calls: [string, number][]) =>
      calls.map(([s, t], k) => [trip, time(t), time(t), s, k + 1]);
    const times: (string | number)[][] = o.back
      ? [
          ...run('b', [
            ['T', at(13, 0)],
            ['S', at(13, 11)],
            ['M', at(13, 16)],
            ['R', at(13, 31)],
          ]),
          ...run('a', [
            ['S', at(13, 20)],
            ['M', at(13, 22)],
            ['F', at(13, 43)],
          ]),
        ]
      : [
          ...run('a', [
            ['F', at(13, 7)],
            ['M', at(13, 28)],
            ['S', o.stationAt200 ?? at(13, 30)],
          ]),
          ...run('b', [
            ['R', at(13, 20)],
            ['M', at(13, 35)],
            ['S', at(13, 40)],
            ['T', at(13, 51)],
          ]),
        ];
    for (let k = 1; k <= 10; k++) {
      routes.push([`L${k}`, 'T', `${100 + k}`, `Line ${k}`, 3]);
      trips.push([`L${k}`, 'WK', `l${k}`]);
      times.push([`l${k}`, time(at(9, k)), time(at(9, k)), 'S', 1]);
      times.push([`l${k}`, time(at(9, 30 + k)), time(at(9, 30 + k)), 'R', 2]);
    }
    const feed = parseGtfs({
      'agency.txt': toCsv(
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
        [['T', 'Test', 'https://example.com', 'Atlantic/Madeira']],
      ),
      'stops.txt': toCsv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'], stops),
      'routes.txt': toCsv(
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
        routes,
      ),
      'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], trips),
      'stop_times.txt': toCsv(
        ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
        times,
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
      return { ...net.stops[i]!, name: net.stops[i]!.name, stops: [i] };
    };
    const plan = (from: string, to: string) =>
      new Planner(net).plan({
        from: stop(from),
        to: stop(to),
        date: WEEKDAY,
        time: at(13, 0),
        options: { stopWalk: 0, longWalk: 0 },
      })[0]!;
    const changeAt = (it: Itinerary) => {
      const [first, second] = it.legs.filter((l): l is RideLeg => l.kind === 'ride');
      return { off: first!.to.name, on: second!.from.name, wait: second!.wait };
    };
    return { plan, changeAt };
  }

  it('changes at the bus station rather than on the hill, getting there as soon', () => {
    const { plan, changeAt } = boaMorte();
    const best = plan('F', 'T');
    expect(changeAt(best)).toEqual({
      off: 'Estacao Ribeira Brava',
      on: 'Estacao Ribeira Brava',
      wait: 10 * 60,
    });
    expect(best.walkDistance).toBe(0);
    expect(best.arrive).toBe(at(13, 51));
  });

  it('stays on the hill when the next bus leaves the station before the first gets there', () => {
    // The 200 at the station at 13:39, the 322 away from it at 13:40: no time to change.
    const { plan, changeAt } = boaMorte({ stationAt200: at(13, 39) });
    const best = plan('F', 'T');
    expect(changeAt(best).on).toBe('Murteira, Boa Morte');
    expect(best.arrive).toBe(at(13, 51));
  });

  it('changes at the bus station the other way round too', () => {
    // T → S → M on the 322, S → M → F on the 200: off the 322 at the station, on the 200 there.
    const { plan, changeAt } = boaMorte({ back: true });
    const best = plan('T', 'F');
    expect(changeAt(best).off).toBe('Estacao Ribeira Brava');
    expect(changeAt(best).on).toBe('Estacao Ribeira Brava');
  });
});

describe('changing buses in the city', () => {
  const time = (t: number) =>
    `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String((t / 60) % 60).padStart(2, '0')}:00`;
  /**
   * Funchal: the 200 from the hospital (H) down to the Marina (M) and up to its terminal
   * at Campo da Barca (C); the 380 from C back down past the Palácio (P), 150 m from M,
   * and west (W). Twenty more lines pass C and P, both busy stops of the city.
   */
  function funchal(busy = true) {
    const stops: (string | number)[][] = [
      ['H', 'Bairro do Hospital', 32.6484, -16.9223, 'FNC'],
      ['M', 'Marina', 32.6457, -16.9095, 'FNC'],
      ['P', 'Palácio São Lourenço', 32.64686, -16.91017, 'FNC'],
      ['C', 'Auto Silo Campo da Barca', 32.65306, -16.90192, 'FNC'],
      ['W', 'Hotel Miramar', 32.6372, -16.9375, 'FNC'],
    ];
    const routes: (string | number)[][] = [
      ['200', 'T', '200', 'Funchal - Ribeira Brava', 3],
      ['380', 'T', '380', 'Funchal - Calheta', 3],
    ];
    const trips: string[][] = [
      ['200', 'WK', 'a'],
      ['380', 'WK', 'b'],
    ];
    const run = (trip: string, calls: [string, number][]) =>
      calls.map(([s, t], k) => [trip, time(t), time(t), s, k + 1]);
    const times: (string | number)[][] = [
      ...run('a', [
        ['H', at(9, 0)],
        ['M', at(9, 5)],
        ['C', at(9, 12)],
      ]),
      ...run('b', [
        ['C', at(9, 20)],
        ['P', at(9, 27)],
        ['W', at(9, 40)],
      ]),
    ];
    for (let k = 1; k <= (busy ? 20 : 0); k++) {
      routes.push([`L${k}`, 'T', `${100 + k}`, `Line ${k}`, 3]);
      trips.push([`L${k}`, 'WK', `l${k}`]);
      times.push(
        ...run(`l${k}`, [
          ['C', at(7, k)],
          ['P', at(7, 30 + k)],
        ]),
      );
    }
    const feed = parseGtfs({
      'agency.txt': toCsv(
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
        [['T', 'Test', 'https://example.com', 'Atlantic/Madeira']],
      ),
      'stops.txt': toCsv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'], stops),
      'routes.txt': toCsv(
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
        routes,
      ),
      'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], trips),
      'stop_times.txt': toCsv(
        ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
        times,
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
    const city = new Network(
      buildBundle([{ feed, source: { name: 'test' } }], { demo: true, fares: SIGA_FARES_2026 })
        .bundle,
    );
    const stop = (id: string) => {
      const i = city.stops.findIndex((s) => s.id === id);
      return { ...city.stops[i]!, name: city.stops[i]!.name, stops: [i] };
    };
    const best = new Planner(city).plan({
      from: stop('H'),
      to: stop('W'),
      date: WEEKDAY,
      time: at(8, 55),
      options: { stopWalk: 0, longWalk: 0 },
    })[0]!;
    const [first, second] = best.legs.filter((l): l is RideLeg => l.kind === 'ride');
    return { best, off: first!.to.name, on: second!.from.name };
  }

  it('is made on the way, not at the terminal the next bus comes back from', () => {
    // Off the 200 at the Marina and a short walk to the 380 at the Palácio, rather than up
    // to Campo da Barca and back down the same streets on the 380.
    const { best, off, on } = funchal();
    expect(off).toBe('Marina');
    expect(on).toBe('Palácio São Lourenço');
    expect(best.arrive).toBe(at(9, 40));
    expect(best.walkDistance).toBeLessThan(250);
  });
});

describe('isBusStation', () => {
  it('knows the bus stations by the names people use', () => {
    for (const name of ['Estacao Ribeira Brava', 'Estação Machico', 'São Vicente - Central']) {
      expect(isBusStation(name), name).toBe(true);
    }
  });

  it('is not fooled by other stations and centres', () => {
    for (const name of [
      'Estação Rádio Madeira',
      'Antes Estação de Serviço, Camacha',
      'Central Barreiros',
      'Central, Loreto',
      'Avenida Calouste Gulbenkian-Estação',
      'Ribeira Brava - Debaixo Rocha',
    ]) {
      expect(isBusStation(name), name).toBe(false);
    }
  });
});
