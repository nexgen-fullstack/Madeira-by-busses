/** Small hand-made network used by the unit tests.
 *
 *   A ── B ── C ── D        R1 every 30 min, 06:00–20:00 (weekdays)
 *   A ═════════════ D       R4 express, 08:05 only
 *             │
 *             E ·· F ── G   R2 C→E hourly at :15, walk E→F (~200 m), R3 F→G hourly at :40
 *
 * A, B, C are in Funchal (FNC); D is in Câmara de Lobos (CML).
 */
import { buildBundle, type NetworkBundle } from './bundle.ts';
import { toCsv } from './csv.ts';
import { SIGA_FARES_2026 } from './fares.ts';
import { parseGtfs, type GtfsFiles } from './gtfs.ts';
import { Network } from './network.ts';

const hhmm = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:00`;

export const STOPS = {
  A: { lat: 32.65, lon: -16.95, muni: 'FNC' },
  B: { lat: 32.65, lon: -16.94, muni: 'FNC' },
  C: { lat: 32.65, lon: -16.93, muni: 'FNC' },
  D: { lat: 32.65, lon: -16.92, muni: 'CML' },
  E: { lat: 32.66, lon: -16.93, muni: 'FNC' },
  F: { lat: 32.6618, lon: -16.93, muni: 'FNC' },
  G: { lat: 32.68, lon: -16.93, muni: 'FNC' },
} as const;

export function fixtureFiles(): GtfsFiles {
  const stopTimes: (string | number)[][] = [];
  const trips: string[][] = [];
  const addTrip = (
    route: string,
    id: string,
    stops: string[],
    start: number,
    step: number,
    service = 'WK',
  ) => {
    trips.push([route, service, id]);
    stops.forEach((s, i) => {
      const t = hhmm(start + i * step);
      stopTimes.push([id, t, t, s, i + 1]);
    });
  };
  for (let t = 6 * 3600; t <= 20 * 3600; t += 1800)
    addTrip('R1', `R1-${t}`, ['A', 'B', 'C', 'D'], t, 600);
  for (let t = 7 * 3600 + 900; t <= 20 * 3600; t += 3600)
    addTrip('R2', `R2-${t}`, ['C', 'E'], t, 600);
  for (let t = 7 * 3600 + 2400; t <= 21 * 3600; t += 3600)
    addTrip('R3', `R3-${t}`, ['F', 'G'], t, 900);
  addTrip('R4', 'R4-express', ['A', 'D'], 8 * 3600 + 300, 900);
  // Night trip after midnight (24:30), weekdays.
  addTrip('R5', 'R5-night', ['A', 'B'], 24 * 3600 + 1800, 600);

  return {
    'agency.txt': toCsv(
      ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
      [['T', 'Test Transit', 'https://example.com', 'Atlantic/Madeira']],
    ),
    'stops.txt': toCsv(
      ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id'],
      Object.entries(STOPS).map(([id, s]) => [id, `Stop ${id}`, s.lat, s.lon, s.muni]),
    ),
    'routes.txt': toCsv(
      ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      [
        ['R1', 'T', '1', 'A - D', 3],
        ['R2', 'T', '2', 'C - E', 3],
        ['R3', 'T', '3', 'F - G', 3],
        ['R4', 'T', '4X', 'A - D express', 3],
        ['R5', 'T', 'N', 'Night', 3],
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
      [['WK', 1, 1, 1, 1, 1, 0, 0, '20260101', '20271231']],
    ),
  };
}

export function fixtureBundle(): NetworkBundle {
  return buildBundle([{ feed: parseGtfs(fixtureFiles()), source: { name: 'fixture' } }], {
    demo: true,
    fares: SIGA_FARES_2026,
    generatedAt: '2026-10-01T00:00:00Z',
  }).bundle;
}

export function fixtureNetwork(): Network {
  return new Network(fixtureBundle());
}

export function stopIndex(net: Network, id: keyof typeof STOPS): number {
  const i = net.stops.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`No stop ${id}`);
  return i;
}

/** A Wednesday and a Saturday inside the fixture's calendar. */
export const WEEKDAY = '2026-10-07';
export const SATURDAY = '2026-10-10';
export const at = (h: number, m = 0) => h * 3600 + m * 60;
