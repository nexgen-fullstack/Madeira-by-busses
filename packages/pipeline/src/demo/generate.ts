import { madeiraHolidays, toCsv, weekday, type GtfsFiles } from '@madeirabus/engine';
import { DEMO_AGENCIES, DEMO_ROUTES, DEMO_STOPS, type Schedule } from './network.ts';

const START = '20260101';
const END = '20271231';

const toSeconds = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 3600 + m! * 60;
};
const toGtfsTime = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:00`;

function departures(schedule: Schedule): number[] {
  if ('at' in schedule) return schedule.at.map(toSeconds);
  const [first, last, minutes] = schedule.every;
  const out: number[] = [];
  for (let t = toSeconds(first); t <= toSeconds(last); t += minutes * 60) out.push(t);
  return out;
}

/** Builds the demo network as GTFS text files (see network.ts for what is real). */
export function generateDemoGtfs(): GtfsFiles {
  const stopName = new Map(DEMO_STOPS.map((s) => [s.id, s.name]));
  const trips: (string | number)[][] = [];
  const stopTimes: (string | number)[][] = [];

  for (const route of DEMO_ROUTES) {
    const total = route.stops[route.stops.length - 1]![1];
    const directions: [string, number][][] = [
      route.stops,
      [...route.stops].reverse().map(([id, min]) => [id, total - min] as [string, number]),
    ];
    const services: [string, Schedule][] = [
      ['WD', route.weekday],
      ['SAT', route.saturday],
      ['SUN', route.sunday],
    ];
    for (const [service, schedule] of services) {
      for (const start of departures(schedule)) {
        directions.forEach((stops, dir) => {
          const tripId = `${route.id}-${service}-${dir}-${toGtfsTime(start).slice(0, 5).replace(':', '')}`;
          trips.push([route.id, service, tripId, stopName.get(stops[stops.length - 1]![0])!, dir]);
          stops.forEach(([stop, min], i) => {
            const t = toGtfsTime(start + min * 60);
            stopTimes.push([tripId, t, t, stop, i + 1]);
          });
        });
      }
    }
  }

  // Holidays run the Sunday timetable.
  const calendarDates: (string | number)[][] = [];
  for (const year of [2026, 2027]) {
    for (const h of madeiraHolidays(year)) {
      const wd = weekday(h.date);
      if (wd === 6) continue;
      const date = h.date.replaceAll('-', '');
      calendarDates.push([wd === 5 ? 'SAT' : 'WD', date, 2], ['SUN', date, 1]);
    }
  }

  return {
    'agency.txt': toCsv(
      ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
      DEMO_AGENCIES.map((a) => [a.id, a.name, a.url, 'Atlantic/Madeira', 'pt']),
    ),
    'stops.txt': toCsv(
      ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id', 'stop_elevation'],
      DEMO_STOPS.map((s) => [s.id, s.name, s.lat, s.lon, s.muni, s.ele]),
    ),
    'routes.txt': toCsv(
      [
        'route_id',
        'agency_id',
        'route_short_name',
        'route_long_name',
        'route_type',
        'route_color',
        'route_text_color',
      ],
      DEMO_ROUTES.map((r) => [r.id, r.agency, r.short, r.long, 3, r.color, r.text]),
    ),
    'trips.txt': toCsv(
      ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id'],
      trips,
    ),
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
        ['WD', 1, 1, 1, 1, 1, 0, 0, START, END],
        ['SAT', 0, 0, 0, 0, 0, 1, 0, START, END],
        ['SUN', 0, 0, 0, 0, 0, 0, 1, START, END],
      ],
    ),
    'calendar_dates.txt': toCsv(['service_id', 'date', 'exception_type'], calendarDates),
    'feed_info.txt': toCsv(
      [
        'feed_publisher_name',
        'feed_publisher_url',
        'feed_lang',
        'feed_start_date',
        'feed_end_date',
        'feed_version',
      ],
      [
        [
          'Madeira by busses DEMO - synthetic timetable, not for travel',
          'https://github.com/nexgen-fullstack/madeirabus',
          'pt',
          START,
          END,
          'demo-1',
        ],
      ],
    ),
  };
}
