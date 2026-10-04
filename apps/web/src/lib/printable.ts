import {
  addDays,
  madeiraHolidays,
  stopDepartures,
  weekday,
  type Network,
  type StopDeparture,
} from '@madeirabus/engine';
import type { I18n } from '../i18n.ts';
import { fullDate } from './format.ts';
import { directionStops, lineDirections, lineOf, type Direction } from './lines.ts';
import { FILE_PREFIX } from './site.ts';

/**
 * A line's timetable as it is printed for a bus stop: the departures from one
 * stop, a column per kind of day ("Mon–Fri", "Saturday", "Sunday & public
 * holidays"), the stops that follow with their travel time, and where a trip
 * ends early.
 */
export interface PrintableTimetable {
  title: string;
  fileName: string;
  number: string;
  formerly?: string;
  name: string;
  operator: string;
  /** "#rrggbb" */
  color: string;
  sections: PrintSection[];
  /** The ordinary days the columns were read from. */
  basis: { from: string; to: string };
  /** Shown under every page: where the times come from, when they were printed. */
  footer: string[];
  /** Notes that apply to the whole timetable (e.g. an unconfirmed timetable). */
  notes: string[];
  url?: string;
}

export interface PrintSection {
  direction: string;
  stop: string;
  columns: PrintColumn[];
  /** Footnote letters: a trip marked "a" ends at another stop. */
  legend: { mark: string; text: string }[];
  /** Kinds of days without buses ("No buses on Sundays"). */
  closed: string[];
  /** Stops from the chosen one onwards, with minutes from it. */
  stops: { name: string; minutes: number }[];
}

export interface PrintColumn {
  label: string;
  departures: { time: number; mark?: string }[];
}

export interface DayGroup {
  /** 0 = Monday … 6 = Sunday. */
  days: number[];
  /** Public holidays run this timetable. */
  holidays: boolean;
  departures: StopDeparture[];
}

/**
 * Footnote letters for trips that end somewhere else than the direction's
 * main variant: "a" for the most frequent such terminus, then "b"…
 */
export function terminusMarks(
  net: Network,
  direction: Direction,
  departures: readonly { terminus: number }[],
): Map<number, string> {
  const main = net.patterns[direction.patterns[0]!]!.stops;
  const usual = main[main.length - 1]!;
  const count = new Map<number, number>();
  for (const d of departures) {
    if (d.terminus !== usual) count.set(d.terminus, (count.get(d.terminus) ?? 0) + 1);
  }
  return new Map(
    [...count.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([stop], i) => [stop, String.fromCharCode(97 + i)]),
  );
}

/** Stops of a direction where a bus can be boarded (not where all its variants end). */
export function boardingStops(net: Network, direction: Direction): number[] {
  return directionStops(net, direction).filter((s) =>
    direction.patterns.some((p) => {
      const stops = net.patterns[p]!.stops;
      const i = stops.indexOf(s);
      return i >= 0 && i < stops.length - 1;
    }),
  );
}

/** How far ahead to look for an ordinary day of each kind. */
const LOOKAHEAD = 28;

/**
 * The week at a stop: weekdays with identical departures share a column. Each
 * weekday is read from its first ordinary (non-holiday) date on or after
 * `from`; holidays join the column whose departures they have, or Sunday's.
 */
export function weekTimetable(
  net: Network,
  patterns: readonly number[],
  stop: number,
  from: string,
): { groups: DayGroup[]; basis: { from: string; to: string } } {
  const until = net.bundle.validity.to;
  const years = new Set<number>();
  const holidayDates = new Set<string>();
  const isHoliday = (iso: string) => {
    const year = Number(iso.slice(0, 4));
    if (!years.has(year)) {
      years.add(year);
      for (const h of madeiraHolidays(year)) holidayDates.add(h.date);
    }
    return holidayDates.has(iso);
  };
  const dates: (string | undefined)[] = Array.from({ length: 7 });
  let holiday: string | undefined;
  for (let i = 0; i < LOOKAHEAD; i++) {
    const d = addDays(from, i);
    if (d > until) break;
    if (isHoliday(d)) holiday ??= d;
    else dates[weekday(d)] ??= d;
  }
  const key = (deps: StopDeparture[]) => deps.map((d) => `${d.time}@${d.terminus}`).join(',');
  const groups: (DayGroup & { key: string })[] = [];
  dates.forEach((date, day) => {
    // Past the end of the timetable nothing is known, not even "no buses".
    if (!date) return;
    const departures = stopDepartures(net, patterns, stop, date);
    const k = key(departures);
    const same = groups.find((g) => g.key === k);
    if (same) same.days.push(day);
    else groups.push({ key: k, days: [day], holidays: false, departures });
  });
  const holidayKey = holiday ? key(stopDepartures(net, patterns, stop, holiday)) : undefined;
  const onHolidays =
    groups.find((g) => holidayKey !== undefined && g.key === holidayKey) ??
    groups.find((g) => g.days.includes(6));
  if (onHolidays) onHolidays.holidays = true;
  const used = dates.filter((d): d is string => d !== undefined).sort();
  return {
    groups: groups.map(({ days, holidays: h, departures }) => ({ days, holidays: h, departures })),
    basis: { from: used[0] ?? from, to: used[used.length - 1] ?? from },
  };
}

/** "Mon–Fri", "Saturday", "Sun & public holidays" in the reader's language. */
export function dayGroupLabel(t: I18n, group: Pick<DayGroup, 'days' | 'holidays'>): string {
  // 1 January 2024 was a Monday.
  const name = (d: number, width: 'short' | 'long') => {
    const s = new Intl.DateTimeFormat(t.locale, { weekday: width, timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + d)),
    );
    return s.charAt(0).toLocaleUpperCase(t.locale) + s.slice(1);
  };
  const days = [...group.days].sort((a, b) => a - b);
  if (days.length === 7) return t.t('print.daily');
  let label: string;
  if (days.length === 1) label = name(days[0]!, 'long');
  else {
    // Runs of consecutive days read "Mon–Fri"; others are listed.
    const runs: number[][] = [];
    for (const d of days) {
      const run = runs[runs.length - 1];
      if (run && run[run.length - 1] === d - 1) run.push(d);
      else runs.push([d]);
    }
    label = runs
      .map((r) =>
        r.length > 2
          ? `${name(r[0]!, 'short')}–${name(r[r.length - 1]!, 'short')}`
          : r.map((d) => name(d, 'short')).join(', '),
      )
      .join(', ');
  }
  return group.holidays ? t.t('print.withHolidays', { days: label }) : label;
}

export interface PrintRequest {
  /** Any route variant of the line. */
  route: number;
  direction: Direction;
  stop: number;
  /** Add the way back, from the stop of the same name. */
  back: boolean;
  /** First day to read the week from (ISO); today in the app. */
  from: string;
  /** Link to the line in the app, printed in the footer. */
  url?: string;
}

export function printableTimetable(
  net: Network,
  t: I18n,
  req: PrintRequest,
  printedOn: string,
): PrintableTimetable {
  const variants = lineOf(net, req.route);
  const route = net.routes[variants[0] ?? req.route]!;
  const sections = [section(net, t, req.direction, req.stop, req.from)];
  let basis = sections[0]!.basis;
  if (req.back) {
    const back = returnOf(net, variants, req.direction, req.stop);
    if (back) {
      const s = section(net, t, back.direction, back.stop, req.from);
      sections.push(s);
      basis = {
        from: s.basis.from < basis.from ? s.basis.from : basis.from,
        to: s.basis.to > basis.to ? s.basis.to : basis.to,
      };
    }
  }
  const b = net.bundle;
  const operator = b.agencies[route.agency]!.name;
  const version = b.sources.find((s) => s.feedVersion)?.feedVersion;
  const source = version ? `${operator} (GTFS ${version})` : operator;
  const notes: string[] = [];
  if (b.demo) notes.push(t.t('demo.banner'));
  if (b.projected && basis.to > b.projected.officialUntil) {
    notes.push(t.t('data.projected', { date: fullDate(t, b.projected.officialUntil) }));
  }
  return {
    title: t.t('print.title', { n: route.short, name: route.long }),
    fileName: `${FILE_PREFIX}-${route.short}-${slug(net.stops[req.stop]!.name)}.pdf`,
    number: route.short,
    formerly: route.formerly,
    name: route.long,
    operator,
    color: `#${route.color}`,
    sections: sections.map((s) => s.section),
    basis,
    notes,
    footer: [
      t.t('print.basis', { from: fullDate(t, basis.from), to: fullDate(t, basis.to) }),
      t.t('print.source', { source, date: fullDate(t, printedOn) }),
    ],
    url: req.url,
  };
}

function section(
  net: Network,
  t: I18n,
  direction: Direction,
  stop: number,
  from: string,
): { section: PrintSection; basis: { from: string; to: string } } {
  const { groups, basis } = weekTimetable(net, direction.patterns, stop, from);
  const marks = terminusMarks(
    net,
    direction,
    groups.flatMap((g) => g.departures),
  );
  const running = groups.filter((g) => g.departures.length > 0);
  const closed = groups
    .filter((g) => g.departures.length === 0)
    .map((g) => t.t('print.closed', { days: dayGroupLabel(t, g) }));
  // Minutes to the following stops, read from the busiest pattern serving the stop.
  const main = direction.patterns.find((p) => {
    const stops = net.patterns[p]!.stops;
    const i = stops.indexOf(stop);
    return i >= 0 && i < stops.length - 1;
  });
  const stops: PrintSection['stops'] = [];
  if (main !== undefined) {
    const p = net.patterns[main]!;
    const pos = p.stops.indexOf(stop);
    const profile = p.profiles[p.trips[Math.floor(p.trips.length / 2)]?.[2] ?? 0] ?? [];
    const leave = profile[2 * pos + 1] ?? 0;
    for (let i = pos; i < p.stops.length; i++) {
      stops.push({
        name: net.stops[p.stops[i]!]!.name,
        minutes: Math.max(0, Math.round(((profile[2 * i] ?? leave) - leave) / 60)),
      });
    }
  }
  return {
    basis,
    section: {
      direction: direction.label,
      stop: net.stops[stop]!.name,
      columns: running.map((g) => ({
        label: dayGroupLabel(t, g),
        departures: g.departures.map((d) => ({ time: d.time, mark: marks.get(d.terminus) })),
      })),
      legend: [...marks.entries()].map(([s, mark]) => ({
        mark,
        text: t.t('print.endsAt', { stop: net.stops[s]!.name }),
      })),
      closed,
      stops,
    },
  };
}

/**
 * The way back: another direction of the line, boarding at the stop with the
 * same name as the chosen one (across the road), or else where it starts.
 */
export function returnOf(
  net: Network,
  routes: readonly number[],
  direction: Direction,
  stop: number,
): { direction: Direction; stop: number } | undefined {
  const others = lineDirections(net, routes).filter((d) => d.patterns[0] !== direction.patterns[0]);
  const name = net.stops[stop]!.name;
  const boards = (d: Direction, s: number) =>
    d.patterns.some((p) => {
      const stops = net.patterns[p]!.stops;
      const i = stops.indexOf(s);
      return i >= 0 && i < stops.length - 1;
    });
  for (const d of others) {
    const same = directionStops(net, d).find((s) => net.stops[s]!.name === name && boards(d, s));
    if (same !== undefined) return { direction: d, stop: same };
  }
  const back = others[0];
  return back && { direction: back, stop: net.patterns[back.patterns[0]!]!.stops[0]! };
}

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'timetable'
  );
}
