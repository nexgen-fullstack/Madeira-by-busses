/**
 * Timetables of operators without a GTFS feed (CAM, SIGA Rodoeste), written
 * from their printed timetables (PDF) into data/timetables/*.json, and the
 * route data of the SIGA website they are combined with.
 */

/** One printed timetable: a line, or a few lines sharing a sheet. */
export interface TimetableFile {
  /** The number on the bus (three digits since March 2026). */
  line: string;
  /** The number before March 2026. */
  formerly?: string;
  operator: Operator;
  name: string;
  /**
   * The SIGA line numbers of the variants on this sheet, when they are not
   * just `line` (Rodoeste's printed "7" is 200, 207 and 209 on SIGA).
   */
  lines?: string[];
  /** Names of those lines, when they differ from `name`. */
  names?: Record<string, string>;
  source: {
    /** The PDF the times were taken from. */
    pdf: string;
    /** Its sha256 (first 16 hex digits, as in data/sources/manifest.json). */
    sha256?: string;
    /** When the times were last compared with it (YYYY-MM-DD). */
    checked: string;
  };
  /** MM-DD dates without any trips (default: 25 December). */
  closed?: string[];
  /** The timetable's footnotes, by their mark ("a", "E", "PE"…). */
  notes?: Record<string, Note>;
  directions: Direction[];
}

export type Operator = 'CAM' | 'Rodoeste';

export interface Note {
  text: string;
  /** The trip takes another way: it picks the SIGA variant (see `Direction.variants`). */
  via?: boolean;
  /**
   * A stop (SIGA code) that trips with this mark pass and trips without it do
   * not: "via Aeroporto" → the airport stop. Variants are chosen to agree.
   */
  pass?: string;
  /** Trips with this mark never lie on a SIGA variant (an express that skips most stops). */
  variant?: false;
  /** The trip starts at this stop (SIGA code), not at its first column's place: its first time is there. */
  from?: string;
  /** The trip ends at this stop (SIGA code) instead of the direction's last place. */
  to?: string;
  /** Weekdays of term time only, or of the school holidays only. */
  school?: 'school' | 'holidays';
  /** Only on these days of the week (0 = Monday … 6 = Sunday). */
  only?: number[];
  /** Sundays without the holidays, or the holidays only. */
  holidays?: 'without' | 'only';
  /** Not on these dates (MM-DD). */
  except?: string[];
  /** Passengers change buses at the timing point of the cell with this mark. */
  change?: boolean;
  /** Trips with this mark are left out (booked in advance, unclear…). */
  skip?: boolean;
}

/** A column of the printed timetable: a place, pinned to the SIGA stop its times are for. */
export interface TimingPoint {
  name: string;
  /** SIGA stop code (the same code as Horários do Funchal's stop_id where both stop). */
  stop: string;
}

export interface Direction {
  /** Where the buses go (the headsign). */
  to: string;
  /** Footnotes that mean something else in this direction ("to Rochão" / "from Rochão"). */
  notes?: Record<string, Note>;
  /** The columns, in the order the bus passes them. */
  stops: TimingPoint[];
  /**
   * The SIGA variants ("route id:direction", or "A+B" for a change of bus
   * where A ends) that trips with these via-marks drive, in order of
   * preference, keyed by the marks sorted and joined by a space ("" for trips
   * without any). Marks not listed take the best fit among the line's variants.
   */
  variants?: Record<string, string[]>;
  /**
   * The trips by days: one string per row, cells separated by "|". A cell is
   * "-" (not served) or a time ("07:35", "7.35") followed by marks ("07:35 a E").
   * Rows may stop early: a timetable that only gives the departure has one cell.
   */
  weekdays?: string[];
  saturdays?: string[];
  sundays?: string[];
}

/** A route variant of the SIGA website, as collected by scripts/fetch-siga.mjs. */
export interface SigaVariant {
  /** "route id:direction". */
  id: string;
  line: string;
  name: string;
  operator: string;
  /** Stop codes in order with the minutes from the first stop. */
  stops: [code: string, minutes: number][];
  /** Departure of the trip the minutes are from (HH:MM). */
  start?: string;
  /** Last day it was seen running (YYYY-MM-DD). */
  seen: string;
  /** The last days it was seen running. */
  dates?: string[];
}

export interface SigaRoute {
  id: number;
  agency: number;
  operator: string;
  line: string;
  name: string;
  stops: number;
  /** Running time end to end ("01:05:00"). */
  duration: string;
  directions: number[];
}

/** code → [name, latitude, longitude, municipality (INE code)] */
export type SigaStops = Record<string, [string, number, number, string]>;

export interface SigaData {
  routes: SigaRoute[];
  variants: SigaVariant[];
  stops: SigaStops;
}
