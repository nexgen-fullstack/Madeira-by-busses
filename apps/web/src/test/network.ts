import { buildBundle, Network, parseGtfs, SIGA_FARES_2026, toCsv } from '@madeirabus/engine';

/**
 * A line shaped like Horários do Funchal's 110 (formerly 10A), for tests:
 *
 *   Centro ── Escola ── Igreja ── Barreira       out: Mon–Fri 07:00 08:00 09:00,
 *                                                     Sat 08:30 21:00, Sun 10:00
 *   Centro ── Escola ── Igreja                    short run: Sat 21:30
 *   Praça ─── Escola ── Igreja ── Barreira       back (across the road): Mon–Fri
 *                                                     07:30 08:30, Sat 09:00, Sun 11:00
 *
 * Five minutes between stops. Monday 5 October 2026 is a public holiday that
 * runs the Sunday timetable, as in Horários do Funchal's feed.
 */
export function lineNetwork(): Network {
  const out = [
    ['C', 'Centro', 32.65],
    ['E', 'Escola', 32.653],
    ['I', 'Igreja', 32.656],
    ['B', 'Barreira', 32.659],
  ] as const;
  // The way back stops across the road and ends somewhere else in town.
  const back = [
    ['B2', 'Barreira', 32.659],
    ['I2', 'Igreja', 32.656],
    ['E2', 'Escola', 32.653],
    ['P2', 'Praça', 32.6495],
  ] as const;
  const stopTimes: (string | number)[][] = [];
  const trips: string[][] = [];
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  const trip = (route: string, service: string, stops: readonly string[], start: string) => {
    const [h, m] = start.split(':').map(Number);
    const id = `${route}-${service}-${start}`;
    trips.push([route, service, id]);
    stops.forEach((s, i) =>
      stopTimes.push([id, hhmm(h! * 60 + m! + i * 5), hhmm(h! * 60 + m! + i * 5), s, i + 1]),
    );
  };
  const outIds = out.map(([id]) => id);
  const backIds = back.map(([id]) => id);
  for (const t of ['07:00', '08:00', '09:00']) trip('110_0', 'WK', outIds, t);
  for (const t of ['08:30', '21:00']) trip('110_0', 'SA', outIds, t);
  trip('110_0', 'SU', outIds, '10:00');
  trip('110_A', 'SA', outIds.slice(0, 3), '21:30');
  for (const t of ['07:30', '08:30']) trip('110_0', 'WK', backIds, t);
  trip('110_0', 'SA', backIds, '09:00');
  trip('110_0', 'SU', backIds, '11:00');

  const days = (mask: string) => mask.split('').map(Number);
  const files = {
    'agency.txt': toCsv(
      ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
      [['1', 'Horários do Funchal', 'https://hf.pt', 'Europe/Lisbon']],
    ),
    'stops.txt': toCsv(
      ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
      [
        ...out.map(([id, name, lat]) => [id, name, lat, -16.91]),
        ...back.map(([id, name, lat]) => [id, name, lat, -16.9098]),
      ],
    ),
    'routes.txt': toCsv(
      [
        'line_id',
        'route_id',
        'agency_id',
        'route_short_name',
        'route_long_name',
        'route_type',
        'route_color',
      ],
      [
        ['110', '110_0', '1', '10A', 'Centro - Barreira', 3, '663695'],
        ['110', '110_A', '1', '10A', 'Centro - Igreja', 3, '663695'],
      ],
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
      [
        ['WK', ...days('1111100'), '20260101', '20261231'],
        ['SA', ...days('0000010'), '20260101', '20261231'],
        ['SU', ...days('0000001'), '20260101', '20261231'],
      ],
    ),
    'calendar_dates.txt': toCsv(
      ['service_id', 'date', 'exception_type'],
      [
        ['WK', '20261005', 2],
        ['SU', '20261005', 1],
      ],
    ),
  };
  const { bundle } = buildBundle(
    [{ feed: parseGtfs(files), source: { name: 'hf', feedVersion: '1' } }],
    {
      demo: false,
      fares: SIGA_FARES_2026,
      generatedAt: '2026-10-01T00:00:00Z',
      routeNumber: (r) => ({
        short: r.line_id ?? r.route_short_name,
        formerly: r.route_short_name,
      }),
    },
  );
  return new Network(bundle);
}

/** Index of a stop by its id in the fixture. */
export const stopOf = (net: Network, id: string) => net.stops.findIndex((s) => s.id === id);
