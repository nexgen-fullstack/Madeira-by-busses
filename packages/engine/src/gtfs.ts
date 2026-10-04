import { parseCsvRecords } from './csv.ts';
import { parseGtfsTime } from './time.ts';

/** The subset of GTFS Schedule we use. Field names follow the spec. */
export interface GtfsAgency {
  agency_id: string;
  agency_name: string;
  agency_url: string;
  agency_timezone: string;
  agency_phone?: string;
}

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  location_type: number;
  parent_station?: string;
  zone_id?: string;
  stop_code?: string;
  stop_desc?: string;
  /** Extension column `stop_elevation` (metres); not part of the GTFS spec. */
  elevation?: number;
  /** Extension column `municipality` (Portuguese INE code, e.g. 3103 = Funchal). */
  municipality?: string;
}

export interface GtfsRoute {
  route_id: string;
  agency_id?: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number;
  route_color?: string;
  route_text_color?: string;
  /**
   * GTFS-PT extension (Portugal's profile): the line this route variant
   * belongs to. Horários do Funchal puts the line's current public number
   * here ("110") and still the pre-2026 one in `route_short_name` ("10A").
   */
  line_id?: string;
}

export interface GtfsTrip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign?: string;
  direction_id?: number;
  shape_id?: string;
}

export interface GtfsStopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time?: number;
  departure_time?: number;
}

export interface GtfsCalendar {
  service_id: string;
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  start_date: string;
  end_date: string;
}

export interface GtfsCalendarDate {
  service_id: string;
  date: string;
  exception_type: 1 | 2;
}

export interface GtfsShapePoint {
  shape_id: string;
  lat: number;
  lon: number;
  sequence: number;
}

export interface GtfsFrequency {
  trip_id: string;
  start_time: number;
  end_time: number;
  headway_secs: number;
}

export interface GtfsFeedInfo {
  feed_publisher_name?: string;
  feed_start_date?: string;
  feed_end_date?: string;
  feed_version?: string;
}

export interface GtfsFeed {
  agencies: GtfsAgency[];
  stops: GtfsStop[];
  routes: GtfsRoute[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  calendars: GtfsCalendar[];
  calendarDates: GtfsCalendarDate[];
  shapes: GtfsShapePoint[];
  frequencies: GtfsFrequency[];
  feedInfo?: GtfsFeedInfo;
}

/** A GTFS feed as a map of file name → file contents. */
export type GtfsFiles = Record<string, string>;

const optional = (v: string | undefined) => (v === undefined || v === '' ? undefined : v);
const num = (v: string | undefined, fallback = 0) =>
  v === undefined || v === '' ? fallback : Number(v);

export class GtfsError extends Error {}

/** Parses the text files of a GTFS feed. Unknown files and columns are ignored. */
export function parseGtfs(files: GtfsFiles): GtfsFeed {
  const file = (name: string, required: boolean) => {
    const text = files[name];
    if (text === undefined) {
      if (required) throw new GtfsError(`Missing required file ${name}`);
      return [];
    }
    return parseCsvRecords(text);
  };

  const agencies = file('agency.txt', true).map<GtfsAgency>((r) => ({
    agency_id: r.agency_id ?? '',
    agency_name: r.agency_name ?? '',
    agency_url: r.agency_url ?? '',
    agency_timezone: r.agency_timezone ?? '',
    agency_phone: optional(r.agency_phone),
  }));

  const stops = file('stops.txt', true).map<GtfsStop>((r) => ({
    stop_id: r.stop_id!,
    stop_name: r.stop_name ?? '',
    stop_lat: num(r.stop_lat, NaN),
    stop_lon: num(r.stop_lon, NaN),
    location_type: num(r.location_type),
    parent_station: optional(r.parent_station),
    zone_id: optional(r.zone_id),
    stop_code: optional(r.stop_code),
    stop_desc: optional(r.stop_desc),
    elevation: r.stop_elevation ? Number(r.stop_elevation) : undefined,
    municipality: optional(r.municipality),
  }));

  const routes = file('routes.txt', true).map<GtfsRoute>((r) => ({
    route_id: r.route_id!,
    agency_id: optional(r.agency_id),
    route_short_name: r.route_short_name ?? '',
    route_long_name: r.route_long_name ?? '',
    route_type: num(r.route_type, 3),
    route_color: optional(r.route_color),
    route_text_color: optional(r.route_text_color),
    line_id: optional(r.line_id),
  }));

  const trips = file('trips.txt', true).map<GtfsTrip>((r) => ({
    trip_id: r.trip_id!,
    route_id: r.route_id!,
    service_id: r.service_id!,
    trip_headsign: optional(r.trip_headsign),
    direction_id: r.direction_id ? Number(r.direction_id) : undefined,
    shape_id: optional(r.shape_id),
  }));

  const stopTimes = file('stop_times.txt', true).map<GtfsStopTime>((r) => ({
    trip_id: r.trip_id!,
    stop_id: r.stop_id!,
    stop_sequence: num(r.stop_sequence),
    arrival_time: r.arrival_time ? parseGtfsTime(r.arrival_time) : undefined,
    departure_time: r.departure_time ? parseGtfsTime(r.departure_time) : undefined,
  }));

  const calendars = file('calendar.txt', false).map<GtfsCalendar>((r) => ({
    service_id: r.service_id!,
    days: [
      r.monday === '1',
      r.tuesday === '1',
      r.wednesday === '1',
      r.thursday === '1',
      r.friday === '1',
      r.saturday === '1',
      r.sunday === '1',
    ],
    start_date: r.start_date!,
    end_date: r.end_date!,
  }));

  const calendarDates = file('calendar_dates.txt', false).map<GtfsCalendarDate>((r) => ({
    service_id: r.service_id!,
    date: r.date!,
    exception_type: r.exception_type === '2' ? 2 : 1,
  }));

  if (calendars.length === 0 && calendarDates.length === 0) {
    throw new GtfsError('Feed has neither calendar.txt nor calendar_dates.txt');
  }

  const shapes = file('shapes.txt', false).map<GtfsShapePoint>((r) => ({
    shape_id: r.shape_id!,
    lat: num(r.shape_pt_lat, NaN),
    lon: num(r.shape_pt_lon, NaN),
    sequence: num(r.shape_pt_sequence),
  }));

  const frequencies = file('frequencies.txt', false).map<GtfsFrequency>((r) => ({
    trip_id: r.trip_id!,
    start_time: parseGtfsTime(r.start_time!),
    end_time: parseGtfsTime(r.end_time!),
    headway_secs: num(r.headway_secs),
  }));

  const [info] = file('feed_info.txt', false);
  const feedInfo = info
    ? {
        feed_publisher_name: optional(info.feed_publisher_name),
        feed_start_date: optional(info.feed_start_date),
        feed_end_date: optional(info.feed_end_date),
        feed_version: optional(info.feed_version),
      }
    : undefined;

  return {
    agencies,
    stops,
    routes,
    trips,
    stopTimes,
    calendars,
    calendarDates,
    shapes,
    frequencies,
    feedInfo,
  };
}
