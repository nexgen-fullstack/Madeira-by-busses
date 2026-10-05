import { describe, expect, it } from 'vitest';
import { buildBundle, projectServices, type BService } from './bundle.ts';
import { toCsv } from './csv.ts';
import { SIGA_FARES_2026 } from './fares.ts';
import { parseGtfs, type GtfsFiles } from './gtfs.ts';
import { Network } from './network.ts';
import { at, fixtureBundle, fixtureFiles, WEEKDAY } from './test-fixtures.ts';
import { addDays, weekday } from './time.ts';

function feed(extra: Partial<GtfsFiles> = {}): GtfsFiles {
  return {
    'agency.txt': toCsv(
      ['agency_name', 'agency_url', 'agency_timezone'],
      [['Aerobus Madeira', 'https://example.com', 'Atlantic/Madeira']],
    ),
    'stops.txt': toCsv(
      ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
      [
        ['X', 'Aeroporto', 32.6941, -16.7745],
        ['Y', 'Caniço', 32.65, -16.84],
        ['Z', 'Funchal', 32.6469, -16.9086],
      ],
    ),
    'routes.txt': toCsv(
      ['route_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'],
      [['AERO', 'Aerobus', 'Airport – Funchal', 3, '#ff8800']],
    ),
    'trips.txt': toCsv(
      ['route_id', 'service_id', 'trip_id', 'trip_headsign'],
      [
        ['AERO', 'S', 'slow', 'Funchal'],
        ['AERO', 'S', 'fast', 'Funchal'],
      ],
    ),
    // "fast" starts later but arrives earlier (overtakes); Y has no times on "slow".
    'stop_times.txt': toCsv(
      ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
      [
        ['slow', '10:00:00', '10:00:00', 'X', 1],
        ['slow', '', '', 'Y', 2],
        ['slow', '11:00:00', '11:00:00', 'Z', 3],
        ['fast', '10:10:00', '10:10:00', 'X', 1],
        ['fast', '10:20:00', '10:20:00', 'Y', 2],
        ['fast', '10:40:00', '10:40:00', 'Z', 3],
      ],
    ),
    'calendar_dates.txt': toCsv(['service_id', 'date', 'exception_type'], [['S', '20261007', 1]]),
    ...extra,
  };
}

describe('buildBundle', () => {
  it('splits overtaking trips into FIFO patterns and interpolates missing times', () => {
    const { bundle, report } = buildBundle([{ feed: parseGtfs(feed()), source: { name: 't' } }], {
      demo: false,
      fares: SIGA_FARES_2026,
    });
    expect(bundle.patterns).toHaveLength(2);
    expect(report.splitPatterns).toBe(1);
    expect(report.interpolatedTimes).toBe(1);
    const slow = bundle.patterns.find((p) => p.trips[0]![3] === 'slow')!;
    const yArrival = slow.profiles[0]![2]!;
    expect(yArrival).toBeGreaterThan(0);
    expect(yArrival).toBeLessThan(3600);
  });

  it('flags the Aerobus, normalises colours and guesses municipalities', () => {
    const { bundle, report } = buildBundle([{ feed: parseGtfs(feed()), source: { name: 't' } }], {
      demo: false,
      fares: SIGA_FARES_2026,
    });
    expect(bundle.routes[0]!.aerobus).toBe(true);
    expect(bundle.routes[0]!.color).toBe('FF8800');
    expect(bundle.stops.map((s) => s.muni)).toEqual(['SCR', 'SCR', 'FNC']);
    expect(report.guessedMunicipalities).toBe(3);
    expect(bundle.validity).toEqual({ from: '2026-10-07', to: '2026-10-07' });
  });

  it('expands frequency-based trips', () => {
    const files = feed({
      'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], [['AERO', 'S', 'fast']]),
      'frequencies.txt': toCsv(
        ['trip_id', 'start_time', 'end_time', 'headway_secs'],
        [['fast', '08:00:00', '09:00:00', 1200]],
      ),
    });
    const { bundle, report } = buildBundle([{ feed: parseGtfs(files), source: { name: 't' } }], {
      demo: false,
      fares: SIGA_FARES_2026,
    });
    expect(report.expandedFrequencyTrips).toBe(3);
    expect(bundle.patterns[0]!.trips.map((t) => t[1])).toEqual([at(8), at(8, 20), at(8, 40)]);
  });

  it('prefixes ids when merging feeds and survives a JSON round trip', () => {
    const { bundle } = buildBundle(
      [
        { feed: parseGtfs(feed()), source: { name: 'a' }, prefix: 'a:' },
        { feed: parseGtfs(feed()), source: { name: 'b' }, prefix: 'b:' },
      ],
      { demo: false, fares: SIGA_FARES_2026 },
    );
    expect(bundle.stops.map((s) => s.id)).toEqual(['a:X', 'a:Y', 'a:Z', 'b:X', 'b:Y', 'b:Z']);
    const net = new Network(JSON.parse(JSON.stringify(bundle)));
    expect(net.departures([0], WEEKDAY, at(9)).map((d) => d.tripId)).toEqual(['a:slow', 'a:fast']);
  });

  it('shares travel-time profiles between trips', () => {
    const bundle = fixtureBundle();
    const r1 = bundle.patterns.find((p) => bundle.routes[p.route]!.short === '1')!;
    expect(r1.trips.length).toBe(29);
    expect(r1.profiles).toHaveLength(1);
  });
});

describe('Network', () => {
  const net = new Network(fixtureBundle());

  it('lists departures with a last-trip flag', () => {
    const a = net.stops.findIndex((s) => s.id === 'A');
    const deps = net.departures([a], WEEKDAY, at(19, 45), 5);
    // The last route 1 bus, then the night bus at 24:30 of the same service day.
    expect(deps.map((d) => net.routes[d.route]!.short)).toEqual(['1', 'N']);
    expect(deps[0]!.time).toBe(at(20));
    expect(deps[0]!.last).toBe(true);
    expect(deps[1]!.time).toBe(at(24, 30));
  });

  it('searches stops without accents or case', () => {
    expect(net.searchStops('stop c')[0]!.name).toBe('Stop C');
    expect(net.searchStops('')).toEqual([]);
  });

  it('finds stops by words in any order, ignoring linking words', () => {
    const { bundle } = buildBundle(
      [
        {
          feed: parseGtfs(
            feed({
              'stops.txt': toCsv(
                ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
                [
                  ['X', 'Igreja Curral Freiras', 32.72, -16.97],
                  ['Y', 'Curral Romeiros', 32.67, -16.89],
                  ['Z', 'Avenida do Mar', 32.6469, -16.9086],
                ],
              ),
            }),
          ),
          source: { name: 't' },
        },
      ],
      { demo: false, fares: SIGA_FARES_2026 },
    );
    const real = new Network(bundle);
    const names = (q: string) => real.searchStops(q).map((g) => g.name);
    expect(names('Curral das Freiras')).toEqual(['Igreja Curral Freiras']);
    expect(names('curral')).toEqual(['Curral Romeiros', 'Igreja Curral Freiras']);
    expect(names('Av Mar')).toEqual(['Avenida do Mar']);
    expect(names('mar')).toEqual(['Avenida do Mar']);
  });
});

describe('projectServices', () => {
  // A feed whose official timetable ends on Friday 31 July 2026, as the
  // Horários do Funchal feed did. Holidays in its last eight weeks: 10 June
  // and 1 July, both Wednesdays, on which the Sunday service ran.
  const services = (): BService[] => {
    const saturdays: string[] = [];
    for (let d = '2026-06-06'; d <= '2026-07-31'; d = addDays(d, 7)) saturdays.push(d);
    return [
      {
        id: 'weekday',
        days: 0b0011111,
        start: '2026-04-13',
        end: '2026-07-31',
        add: [],
        rem: ['2026-06-10', '2026-07-01'],
      },
      {
        id: 'sunday',
        days: 1 << 6,
        start: '2026-04-13',
        end: '2026-07-31',
        add: ['2026-06-10', '2026-07-01'],
        rem: [],
      },
      // calendar_dates only, like the real feed's services.
      { id: 'saturday', days: 0, start: '', end: '', add: saturdays, rem: [] },
      {
        id: 'spring-only',
        days: 0b0011111,
        start: '2026-04-13',
        end: '2026-05-29',
        add: [],
        rem: [],
      },
    ];
  };
  const active = (s: BService, d: string) =>
    !s.rem.includes(d) &&
    (s.add.includes(d) || (d >= s.start && d <= s.end && (s.days & (1 << weekday(d))) !== 0));

  it('carries the weekly pattern forward and applies holidays', () => {
    const list = services();
    expect(projectServices(list, '2026-12-31')).toEqual({
      officialUntil: '2026-07-31',
      services: 3,
    });
    const [weekday_, sunday, saturday, spring] = list as [BService, BService, BService, BService];
    // Ordinary days follow the weekday the service used to run on.
    expect(active(weekday_, '2026-10-07')).toBe(true); // Wednesday
    expect(active(weekday_, '2026-10-10')).toBe(false); // Saturday
    expect(active(saturday, '2026-10-10')).toBe(true);
    expect(active(sunday, '2026-10-11')).toBe(true);
    // 5 October (Monday) and 15 August (Saturday) are holidays: Sunday service.
    expect(active(weekday_, '2026-10-05')).toBe(false);
    expect(active(sunday, '2026-10-05')).toBe(true);
    expect(active(saturday, '2026-08-15')).toBe(false);
    expect(active(sunday, '2026-08-15')).toBe(true);
    // The official dates are untouched.
    expect(active(weekday_, '2026-04-14')).toBe(true);
    expect(active(weekday_, '2026-07-01')).toBe(false);
    expect(active(saturday, '2026-07-25')).toBe(true);
    // A service that had already ended is not revived.
    expect(active(spring, '2026-10-07')).toBe(false);
    // Nothing runs past the projection horizon.
    expect(active(weekday_, '2027-01-04')).toBe(false);
  });

  it('leaves a current timetable alone', () => {
    const list = services();
    expect(projectServices(list, '2026-07-31')).toBeUndefined();
    expect(list).toEqual(services());
  });
});

describe('carrying a feed forward while another goes on', () => {
  it('projects each feed from its own last day', () => {
    // Horários do Funchal ends with November; the other operators' timetable runs into 2027.
    const ending = fixtureFiles();
    ending['calendar.txt'] = ending['calendar.txt']!.replace('20271231', '20261130');
    const going = fixtureFiles();
    going['calendar.txt'] = going['calendar.txt']!.replace('20271231', '20270630');
    const { bundle } = buildBundle(
      [
        { feed: parseGtfs(ending), source: { name: 'hf' }, prefix: 'hf:' },
        { feed: parseGtfs(going), source: { name: 'siga' }, prefix: 'siga:' },
      ],
      { demo: true, fares: SIGA_FARES_2026, extendUntil: '2027-02-01' },
    );
    expect(bundle.projected).toEqual({ officialUntil: '2026-11-30', until: '2027-02-01' });
    const hf = bundle.services.find((s) => s.id === 'hf:WK')!;
    expect(hf.end).toBe('2027-02-01');
    expect(bundle.services.find((s) => s.id === 'siga:WK')!.end).toBe('2027-06-30');
  });
});
