import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBundle,
  parseGtfs,
  SIGA_FARES_2026,
  toCsv,
  type GtfsFeed,
  type GtfsStopTime,
} from '@madeirabus/engine';
import { buildTimetableFeed, namesPlace, parseCell, parseRow } from './build.ts';
import { calendarFor, datesOf, isSchoolDay, runsOn } from './calendar.ts';
import { loadSiga, loadTimetables } from './load.ts';
import { cleanVariantName, headsignOf, kindFor, lineNameOf } from './observed.ts';
import type { SigaData, SigaDayVariant, SigaVariant, TimetableFile } from './types.ts';

const hm = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;

/** A road along the coast: stops 1 km apart, A … F. */
const STOPS: SigaData['stops'] = {
  A: ['Alpha', 32.65, -16.9, '3103'],
  B: ['ER214', 32.65, -16.89, '3104'],
  C: ['Charlie', 32.65, -16.88, '3104'],
  D: ['Delta', 32.65, -16.87, '3104'],
  E: ['Echo', 32.65, -16.86, '3104'],
  F: ['Foxtrot', 32.65, -16.85, '3104'],
  X: ['Detour', 32.66, -16.88, '3104'],
};
const variant = (id: string, stops: [string, number][], extra: Partial<SigaVariant> = {}) => ({
  id,
  line: '702',
  name: 'Test',
  operator: 'CAM',
  stops,
  seen: '2026-10-04',
  ...extra,
});
const siga = (variants: SigaVariant[]): SigaData => ({
  routes: [
    {
      id: 1,
      agency: 3,
      operator: 'CAM',
      line: '702',
      name: 'Plain',
      stops: 6,
      duration: '00:50:00',
      directions: [0],
    },
    {
      id: 9,
      agency: 3,
      operator: 'CAM',
      line: '702',
      name: 'Unseen',
      stops: 6,
      duration: '01:10:00',
      directions: [0],
    },
  ],
  variants,
  stops: STOPS,
});
const sheet = (rows: string[], extra: Partial<TimetableFile['directions'][number]> = {}) =>
  ({
    line: '702',
    formerly: '113',
    operator: 'CAM',
    name: 'Alpha - Foxtrot',
    source: { pdf: 'https://example.com/702.pdf', checked: '2026-10-05' },
    notes: {
      x: { text: 'via Detour', via: true, pass: 'X' },
      E: { text: 'Expresso', variant: false },
      T: { text: 'Change bus', change: true },
      S: { text: 'School days only', school: 'school' },
      k: { text: 'On request', skip: true },
    },
    directions: [
      {
        to: 'Foxtrot',
        stops: [
          { name: 'Alpha', stop: 'A' },
          { name: 'Charlie', stop: 'C' },
          { name: 'Foxtrot', stop: 'F' },
        ],
        weekdays: rows,
        ...extra,
      },
    ],
  }) satisfies TimetableFile;
const PLAIN = variant('1:0', [
  ['A', 0],
  ['B', 10],
  ['C', 20],
  ['D', 30],
  ['E', 40],
  ['F', 50],
]);
const DETOUR = variant('2:0', [
  ['A', 0],
  ['B', 10],
  ['X', 25],
  ['C', 35],
  ['D', 45],
  ['E', 55],
  ['F', 65],
]);
const build = (file: TimetableFile, variants: SigaVariant[] = [PLAIN]) =>
  buildTimetableFeed([['702.json', file]], siga(variants), {
    from: '2026-10-05',
    to: '2026-10-11',
  });
const timesOf = (feed: GtfsFeed, tripId: string) =>
  feed.stopTimes
    .filter((st: GtfsStopTime) => st.trip_id === tripId)
    .map((st) => `${st.stop_id} ${hm(st.departure_time!)}`);

describe('printed timetable rows', () => {
  it('reads times, marks and gaps', () => {
    expect(parseCell('07:35 a E')).toEqual({ time: 455, marks: ['a', 'E'] });
    expect(parseCell('7.05')).toEqual({ time: 425, marks: [] });
    expect(parseCell(' - ')).toEqual({ marks: [] });
    expect(() => parseCell('7h')).toThrow('Not a time');
    const cells = parseRow('23:40 | - | 00:15', 3);
    expect(cells.map((c) => c.time)).toEqual([1420, undefined, 1455]);
    expect(() => parseRow('07:00 | 08:00', 1)).toThrow('2 cells for 1 places');
  });
});

describe('calendar', () => {
  it('knows the kinds of days, holidays and school terms of Madeira', () => {
    const weekdays = { type: 'weekdays' as const };
    expect(runsOn(weekdays, '2026-10-06')).toBe(true); // Tuesday
    expect(runsOn(weekdays, '2026-10-05')).toBe(false); // Implantação da República
    expect(runsOn({ type: 'sundays' }, '2026-10-05')).toBe(true);
    expect(runsOn({ type: 'saturdays' }, '2026-10-10')).toBe(true);
    expect(runsOn(weekdays, '2026-12-25', ['12-25'])).toBe(false);
    expect(isSchoolDay('2026-10-06')).toBe(true);
    expect(isSchoolDay('2026-12-22')).toBe(false); // Christmas break
    expect(runsOn({ type: 'weekdays', school: 'holidays' }, '2026-12-22')).toBe(true);
    expect(runsOn({ type: 'weekdays', school: 'school' }, '2026-12-22')).toBe(false);
    expect(runsOn({ type: 'weekdays', only: [2] }, '2026-10-07')).toBe(true); // Wednesday
    expect(runsOn({ type: 'weekdays', except: ['10-07'] }, '2026-10-07')).toBe(false);
  });

  it('writes a weekly pattern with exceptions', () => {
    const dates = datesOf({ type: 'weekdays' }, '2026-09-28', '2026-10-11');
    expect(dates).toHaveLength(9); // two weeks less the 5 October holiday
    const { calendar, added, removed } = calendarFor('S1', dates, '2026-09-28', '2026-10-11');
    expect(calendar?.days).toEqual([true, true, true, true, true, false, false]);
    expect(added).toEqual([]);
    expect(removed).toEqual(['2026-10-05']);
  });
});

describe('printed trips on SIGA variants', () => {
  it('gives every stop of the variant a time between the printed ones', () => {
    const { feed, lines } = build(sheet(['07:00 | 07:30 | 08:00']));
    expect(lines[0]).toMatchObject({ full: 1, outline: 0, skipped: [] });
    // Charlie is printed 10 minutes later than SIGA's run: the stops before it stretch.
    expect(timesOf(feed, 'CAM-702-0U1')).toEqual([
      'A 07:00',
      'B 07:15',
      'C 07:30',
      'D 07:40',
      'E 07:50',
      'F 08:00',
    ]);
    expect(feed.routes[0]).toMatchObject({ route_short_name: '113', line_id: '702' });
  });

  it('runs a printed departure to the end of the variant', () => {
    const { feed } = build(sheet(['07:00']));
    expect(timesOf(feed, 'CAM-702-0U1').at(-1)).toBe('F 07:50');
  });

  it('takes the variant that agrees with the marks', () => {
    const { feed } = build(sheet(['07:00 | 07:35 | 08:05', '09:00 x | 09:35 | 10:05']), [
      PLAIN,
      DETOUR,
    ]);
    expect(timesOf(feed, 'CAM-702-0U1')).not.toContain('X 07:25');
    expect(timesOf(feed, 'CAM-702-0U2').map((s) => s.split(' ')[0])).toContain('X');
  });

  it('learns the variant from a trip SIGA was seen running', () => {
    const seen = { ...DETOUR, start: '09:00', dates: ['2026-10-06'] }; // a Tuesday
    // Departure only: nothing but the sighting tells which way the 11:00 goes.
    const { feed } = build(sheet(['09:00', '11:00']), [PLAIN, seen]);
    expect(timesOf(feed, 'CAM-702-0U2').map((s) => s.split(' ')[0])).toContain('X');
  });

  it('keeps to the printed places when SIGA has not shown the variant', () => {
    const { feed, lines } = build(
      sheet(['07:00 x', '09:00 | 09:20 | 09:50'], { variants: { x: ['9:0'] } }),
      [DETOUR],
    );
    expect(lines[0]).toMatchObject({ full: 0, outline: 2, filled: 1 });
    // The unseen variant's running time from SIGA's route list.
    expect(timesOf(feed, 'CAM-702-0U1')).toEqual(['A 07:00', 'F 08:10']);
    // Without the detour's mark the trip does not take it, but from Charlie on every
    // known variant drives the same road: its stops are served.
    expect(timesOf(feed, 'CAM-702-0U2')).toEqual([
      'A 09:00',
      'C 09:20',
      'D 09:30',
      'E 09:40',
      'F 09:50',
    ]);
  });

  it('fills a stretch across a printed stop the variants loop round differently', () => {
    // Two ways from Alpha to Foxtrot through a loop at Delta's: one stops at Charlie before
    // the loop (X), the other after it. Only Charlie's place in the loop differs.
    const before = variant('3:0', [
      ['A', 0],
      ['B', 10],
      ['C', 20],
      ['X', 25],
      ['D', 30],
      ['E', 40],
      ['F', 50],
    ]);
    const after = variant('4:0', [
      ['A', 0],
      ['B', 10],
      ['X', 15],
      ['C', 20],
      ['D', 30],
      ['E', 40],
      ['F', 50],
    ]);
    const file: TimetableFile = {
      ...sheet(['09:00 E | 09:20 | 09:50']),
      notes: { E: { text: 'Expresso', variant: false } },
    };
    // Alpha is not in Funchal here: zone 3104.
    const data = siga([before, after]);
    data.stops = { ...STOPS, A: ['Alpha', 32.65, -16.9, '3104'] };
    const { feed } = buildTimetableFeed([['702.json', file]], data, {
      from: '2026-10-05',
      to: '2026-10-11',
    });
    expect(timesOf(feed, 'CAM-702-0U1').map((s) => s.split(' ')[0])).toEqual([
      'A',
      'B',
      'C',
      'X',
      'D',
      'E',
      'F',
    ]);
  });

  it('splits a trip where passengers change buses', () => {
    const { feed } = build(sheet(['07:00 | 07:25 T | 07:55']));
    // The first bus gets there a few minutes before the next one leaves.
    expect(timesOf(feed, 'CAM-702-0U1-1')).toEqual(['A 07:00', 'B 07:13', 'C 07:22']);
    expect(timesOf(feed, 'CAM-702-0U1-2')[0]).toBe('C 07:25');
  });

  it('leaves out what it cannot place and says why', () => {
    const { feed, lines } = build(sheet(['07:00 k', '08:00 q', '09:00 E', '07:00 | 06:50']));
    expect(feed.trips.map((t) => t.trip_id)).toEqual(['CAM-702-0U3', 'CAM-702-0U4']);
    expect(lines[0]!.skipped).toEqual([
      'Foxtrot, weekdays, row 1: k: On request',
      'Foxtrot, weekdays, row 2: unknown marks q',
    ]);
    // An express keeps to the printed places; times running backwards wrap past midnight.
    expect(timesOf(feed, 'CAM-702-0U3')).toEqual(['A 09:00', 'F 09:50']);
  });

  it('runs school trips on school days only', () => {
    // Term ends on Wednesday 16 December 2026.
    const { feed } = buildTimetableFeed([['702.json', sheet(['07:00 S'])]], siga([PLAIN]), {
      from: '2026-12-14',
      to: '2026-12-20',
    });
    const service = feed.trips[0]!.service_id;
    const calendar = feed.calendars.find((c) => c.service_id === service);
    const added = feed.calendarDates.filter(
      (d) => d.service_id === service && d.exception_type === 1,
    );
    const days = calendar
      ? calendar.days.flatMap((on, i) => (on ? [i] : []))
      : added.map((d) =>
          new Date(`${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6)}`).getUTCDay(),
        );
    expect(days).toEqual([0, 1, 2]); // Monday to Wednesday
  });

  it('names road-side stops after their village', () => {
    const file = sheet(['07:00 | 07:30 | 08:00']);
    const { feed } = buildTimetableFeed([['702.json', file]], siga([PLAIN]), {
      from: '2026-10-05',
      to: '2026-10-11',
      localities: [{ name: 'Caniçal', lat: 32.651, lon: -16.89, rank: 1 }],
    });
    expect(feed.stops.find((s) => s.stop_id === 'B')?.stop_desc).toBe('ER214, Caniçal');
    expect(feed.stops.find((s) => s.stop_id === 'A')?.stop_desc).toBeUndefined(); // Funchal
  });

  it('does not repeat a village the name already gives, even shortened', () => {
    expect(namesPlace('Serra Agua - Centro', 'Serra de Água')).toBe(true);
    expect(namesPlace('R. Brava - Antes Tunel', 'Ribeira Brava')).toBe(true);
    expect(namesPlace('Igreja Sta Cruz', 'Santa Cruz')).toBe(true);
    expect(namesPlace('Igreja do Arco São Jorge', 'Arco de São Jorge')).toBe(true);
    expect(namesPlace('Cruzamento C. Lobos', 'Caniçal')).toBe(false);
    expect(namesPlace('Poiso S', 'Serra de Água')).toBe(false);
    expect(namesPlace('Igreja São Jorge', 'Arco de São Jorge')).toBe(false);
  });
});

describe('timetables seen on the SIGA website', () => {
  const day = (date: string, trips: SigaDayVariant['trips'], line = '702'): SigaDayVariant => ({
    id: '1:0',
    line,
    date,
    services: ['D_003'],
    stops: ['A', 'B', 'C', 'D', 'E', 'F'],
    profiles: [[0, 12, 24, 36, 48, 60]],
    trips,
  });
  /** The dates a service runs between 5 and 11 October 2026. */
  const datesOfService = (feed: GtfsFeed, service: string) => {
    const out: string[] = [];
    const calendar = feed.calendars.find((c) => c.service_id === service);
    for (let d = 5; d <= 11; d++) {
      const date = `202610${String(d).padStart(2, '0')}`;
      const weekday = (new Date(Date.UTC(2026, 9, d)).getUTCDay() + 6) % 7;
      const exception = feed.calendarDates.find((x) => x.service_id === service && x.date === date);
      const weekly = calendar?.days[weekday] ?? false;
      if (exception ? exception.exception_type === 1 : weekly) out.push(date);
    }
    return out;
  };

  it('stands for the days of its kind, a holiday for the Sundays until one is seen', () => {
    const days = {
      hol: [
        day('2026-10-05', [
          ['07:30', 0],
          ['15:00', 0],
        ]),
      ],
    };
    expect(kindFor('2026-10-05', days)).toBe('hol'); // Implantação da República
    expect(kindFor('2026-10-11', days)).toBe('hol'); // a Sunday
    expect(kindFor('2026-10-06', days)).toBeUndefined(); // no weekday seen yet
    const week = { ...days, wed: [day('2026-10-07', [])], thu: [day('2026-10-08', [])] };
    expect(kindFor('2026-10-13', week)).toBe('thu'); // a Tuesday: the latest weekday seen
    expect(kindFor('2026-10-10', week)).toBeUndefined(); // Saturday has its own
  });

  it('gives every trip of a seen day all its stops, and the printed rows the other days', () => {
    const data = siga([PLAIN]);
    data.days = {
      hol: [
        day('2026-10-05', [
          ['07:30', 0],
          ['15:00', 0],
        ]),
      ],
    };
    const file = sheet(['07:00 | 07:30 | 08:00']);
    file.directions[0]!.sundays = ['10:00 | 10:30 | 11:00'];
    const { feed, observed } = buildTimetableFeed([['702.json', file]], data, {
      from: '2026-10-05',
      to: '2026-10-11',
    });
    const seen = feed.trips.filter((t) => t.service_id === 'O-hol');
    expect(seen.map((t) => t.trip_id)).toEqual(['CAM-702-hol-1d0-0730', 'CAM-702-hol-1d0-1500']);
    expect(timesOf(feed, 'CAM-702-hol-1d0-0730')).toEqual([
      'A 07:30',
      'B 07:42',
      'C 07:54',
      'D 08:06',
      'E 08:18',
      'F 08:30',
    ]);
    // The holiday and the Sunday run the seen day; the printed Sunday row is left out.
    expect(datesOfService(feed, 'O-hol')).toEqual(['20261005', '20261011']);
    expect(feed.trips.some((t) => t.trip_id.startsWith('CAM-702-0D'))).toBe(false);
    // The weekdays keep the printed timetable.
    expect(feed.trips.some((t) => t.trip_id === 'CAM-702-0U1')).toBe(true);
    expect(observed.days).toEqual([
      { kind: 'hol', date: '2026-10-05', variants: 1, trips: 2, dates: 2 },
    ]);
  });

  it('gives days with the same timetable one service', () => {
    const data = siga([PLAIN]);
    const trips: SigaDayVariant['trips'] = [['07:30', 0]];
    data.days = { tue: [day('2026-10-06', trips)], wed: [day('2026-10-07', trips)] };
    const { feed, observed } = buildTimetableFeed([], data, {
      from: '2026-10-05',
      to: '2026-10-11',
    });
    expect(feed.trips).toHaveLength(1);
    // Monday is a holiday; Tuesday to Friday run the weekdays seen.
    expect(datesOfService(feed, feed.trips[0]!.service_id)).toEqual([
      '20261006',
      '20261007',
      '20261008',
      '20261009',
    ]);
    expect(observed.days.map((d) => d.kind).sort()).toEqual(['tue', 'wed']);
  });

  it('keeps the printed timetable of a line the seen day does not have', () => {
    const data = siga([PLAIN]);
    data.days = { hol: [day('2026-10-05', [['07:30', 0]], '703')] };
    const file = sheet(['07:00 | 07:30 | 08:00']);
    file.directions[0]!.sundays = ['10:00 | 10:30 | 11:00'];
    const { feed } = buildTimetableFeed([['702.json', file]], data, {
      from: '2026-10-05',
      to: '2026-10-11',
    });
    expect(feed.trips.some((t) => t.trip_id.startsWith('CAM-702-0D'))).toBe(true);
    // The 703 runs too, named after SIGA's variants.
    expect(feed.routes.find((r) => r.line_id === '703')).toBeDefined();
  });

  it('reads the names SIGA gives lines and variants', () => {
    expect(cleanVariantName("Baia D'AbraEI", 'CAM')).toBe("Baia D'Abra");
    expect(cleanVariantName('Santo da SerraII', 'CAM')).toBe('Santo da Serra');
    expect(cleanVariantName('Achada (Santa Cruz)V', 'CAM')).toBe('Achada (Santa Cruz)');
    expect(cleanVariantName('Centro  (99800) - Porto de Abrigo  (99829)', 'CAM')).toBe(
      'Centro - Porto de Abrigo',
    );
    expect(cleanVariantName('Funchal - Ribeira Brava|via Francelheira', 'Rodoeste')).toBe(
      'Funchal - Ribeira Brava via Francelheira',
    );
    expect(headsignOf('Ribeira Brava - Funchal via Cabo Girão', 'Rodoeste', undefined, [])).toBe(
      'Funchal',
    );
    expect(headsignOf('Santo da SerraEI', 'CAM', undefined, [])).toBe('Santo da Serra');
    expect(
      lineNameOf(
        ['Funchal - Ribeira Brava via Cabo Girão', 'Funchal - Ribeira Brava via Estreito C.Lobos'],
        'Rodoeste',
        undefined,
        [],
      ),
    ).toBe('Funchal - Ribeira Brava');
    const funchal = { name: 'Funchal', lat: 32.65, lon: -16.91, rank: 1 };
    expect(lineNameOf(['Santo da Serra0I'], 'CAM', funchal, [funchal])).toBe(
      'Funchal - Santo da Serra',
    );
  });
});

describe('merging with Horários do Funchal', () => {
  it('makes a pole both operators serve one stop', () => {
    const hf = parseGtfs({
      'agency.txt': toCsv(
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
        [['HF', 'HF', 'https://hf.pt', 'Atlantic/Madeira']],
      ),
      'stops.txt': toCsv(
        ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
        [
          ['A', 'Alpha HF', '32.65', '-16.9'],
          ['Z', 'Zulu', '32.64', '-16.9'],
        ],
      ),
      'routes.txt': toCsv(
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
        [['1', 'HF', '001', 'Zulu - Alpha', '3']],
      ),
      'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], [['1', 'W', 't1']]),
      'stop_times.txt': toCsv(
        ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
        [
          ['t1', '06:40:00', '06:40:00', 'Z', '1'],
          ['t1', '06:50:00', '06:50:00', 'A', '2'],
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
        [['W', '1', '1', '1', '1', '1', '0', '0', '20261001', '20261031']],
      ),
    });
    const { feed } = build(sheet(['07:00 | 07:30 | 08:00']));
    const inputs = [
      { feed: hf, source: { name: 'hf' } },
      { feed, source: { name: 'siga' }, prefix: 'siga:' },
    ];
    const opts = { demo: false, fares: SIGA_FARES_2026, generatedAt: '2026-10-05T00:00:00Z' };
    const shared = buildBundle(inputs, { ...opts, shareStops: true }).bundle;
    const apart = buildBundle(inputs, opts).bundle;
    expect(apart.stops).toHaveLength(shared.stops.length + 1);
    const alpha = shared.stops.findIndex((s) => s.id === 'A');
    expect(shared.stops[alpha]!.name).toBe('Alpha HF');
    expect(shared.patterns.filter((p) => p.stops.includes(alpha))).toHaveLength(2);
  });
});

describe('data/timetables', () => {
  const dir = new URL('../../../../data/timetables', import.meta.url).pathname;
  const sigaDir = new URL('../../../../data/sources/siga', import.meta.url).pathname;
  it.runIf(existsSync(dir) && existsSync(sigaDir))(
    'every printed timetable reads and places its stops',
    async () => {
      const files = await loadTimetables(dir);
      const data = await loadSiga(sigaDir);
      const { lines } = buildTimetableFeed(files, data, { from: '2026-10-05', to: '2026-11-05' });
      expect(files.length).toBeGreaterThan(10);
      for (const [name, tt] of files) {
        for (const d of tt.directions) {
          for (const s of d.stops) expect(data.stops[s.stop], `${name}: ${s.name}`).toBeDefined();
        }
      }
      for (const l of lines) {
        // Rows are only ever left out on purpose (a mark that says so).
        const accidental = l.skipped.filter((s) => !/: [A-Za-z]+: /.test(s));
        expect(accidental, l.file).toEqual([]);
        expect(l.full + l.outline, l.file).toBeGreaterThan(0);
      }
    },
  );
});
