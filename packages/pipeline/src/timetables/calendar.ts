import { addDays, madeiraHolidays, weekday, type GtfsCalendar } from '@madeirabus/engine';

/**
 * Days on which a timetable column runs. Printed timetables say "2ª a 6ª
 * feira", "Sábados" or "Domingos e feriados", and their notes narrow that down
 * ("only in the school period", "only on Wednesdays", "not on 1 January").
 */
export type DayType = 'weekdays' | 'saturdays' | 'sundays';

export interface DayRule {
  type: DayType;
  /** Weekdays of term time, or of the school holidays only. */
  school?: 'school' | 'holidays';
  /** Only these days of the week (0 = Monday … 6 = Sunday). */
  only?: number[];
  /** Sundays only, without the holidays; or the holidays only. */
  holidays?: 'without' | 'only';
  /** Dates (MM-DD) on which the trip does not run. */
  except?: string[];
}

/**
 * School terms of the public schools of Madeira (Despacho of the Secretaria
 * Regional de Educação for 2026/2027). Weekdays inside a term are "período
 * escolar"; the others are "período não escolar".
 */
const TERMS: [string, string][] = [
  ['2026-09-14', '2026-12-16'],
  ['2027-01-04', '2027-02-05'],
  ['2027-02-11', '2027-03-19'],
  ['2027-04-05', '2027-06-09'],
];
const KNOWN_UNTIL = '2027-09-10';

/** True on school days; beyond the published calendar, mid-September to mid-June. */
export function isSchoolDay(date: string): boolean {
  if (date >= '2026-09-01' && date <= KNOWN_UNTIL) {
    return TERMS.some(([from, to]) => date >= from && date <= to);
  }
  const md = date.slice(5);
  if (md >= '12-20' || md <= '01-02') return false;
  return md >= '09-15' || md <= '06-15';
}

/** Whether the published school calendar covers the date. */
export const schoolCalendarKnown = (date: string) => date <= KNOWN_UNTIL;

const holidayCache = new Map<number, Set<string>>();
export function isHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  let set = holidayCache.get(year);
  if (!set) {
    set = new Set(madeiraHolidays(year).map((h) => h.date));
    holidayCache.set(year, set);
  }
  return set.has(date);
}

/** Does a column with this rule run on the date? `closed` are MM-DD dates without any service. */
export function runsOn(rule: DayRule, date: string, closed: readonly string[] = []): boolean {
  const md = date.slice(5);
  if (closed.includes(md) || rule.except?.includes(md)) return false;
  const wd = weekday(date);
  const holiday = isHoliday(date);
  const type: DayType = holiday || wd === 6 ? 'sundays' : wd === 5 ? 'saturdays' : 'weekdays';
  if (type !== rule.type) return false;
  if (rule.only && !rule.only.includes(wd)) return false;
  if (rule.holidays === 'without' && holiday) return false;
  if (rule.holidays === 'only' && !holiday) return false;
  if (rule.school && type === 'weekdays') {
    const term = isSchoolDay(date);
    if (rule.school === 'school' ? !term : term) return false;
  }
  return true;
}

/** The dates from `from` to `to` (inclusive) on which the rule runs. */
export function datesOf(
  rule: DayRule,
  from: string,
  to: string,
  closed: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (runsOn(rule, d, closed)) out.push(d);
  return out;
}

/**
 * The most compact GTFS form of a set of dates: a weekly pattern over the
 * period plus the dates added to it and taken out of it.
 */
export function calendarFor(
  serviceId: string,
  dates: readonly string[],
  from: string,
  to: string,
): { calendar?: GtfsCalendar; added: string[]; removed: string[] } {
  const on = new Set(dates);
  const total = new Array<number>(7).fill(0);
  const hits = new Array<number>(7).fill(0);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    total[weekday(d)]!++;
    if (on.has(d)) hits[weekday(d)]!++;
  }
  const days = total.map((n, i) => n > 0 && hits[i]! * 2 > n) as GtfsCalendar['days'];
  if (!days.some(Boolean)) return { added: [...dates], removed: [] };
  const added: string[] = [];
  const removed: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const weekly = days[weekday(d)]!;
    if (weekly && !on.has(d)) removed.push(d);
    if (!weekly && on.has(d)) added.push(d);
  }
  const gtfs = (iso: string) => iso.replaceAll('-', '');
  return {
    calendar: { service_id: serviceId, days, start_date: gtfs(from), end_date: gtfs(to) },
    added,
    removed,
  };
}
