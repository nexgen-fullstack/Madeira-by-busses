import { addDays, weekday } from '@madeirabus/engine';
import { isHoliday, isSchoolDay } from './calendar.ts';

/**
 * The days each service of SIGA's journey planner runs. Its services are
 * named by the kind of day and the operator: "UE_002" (weekdays of term time,
 * úteis escolares, Rodoeste), "UNE_002" (weekdays out of term), "S_002"
 * (Saturdays), "D_002" (Sundays and holidays); CAM's end in "_003".
 *
 * The planner's calendar needs reading the way the SIGA website does:
 *
 * - on a holiday it lists the weekday services as well as the Sunday one, but
 *   only the Sunday one runs (the website shows only it). A weekday on which
 *   an operator runs its Sunday service is a holiday of that operator's (a
 *   town's own holiday), as are Madeira's public holidays;
 * - it lists both weekday services on the weekdays of the school year; the
 *   school calendar of Madeira picks the one that runs;
 * - after an operator's last date (CAM's timetable runs to the end of
 *   November) each day runs what the same weekday ran in the last weeks.
 */

const kindOf = (service: string) => {
  const i = service.lastIndexOf('_');
  return i > 0 ? service.slice(0, i) : service;
};
const operatorOf = (service: string) => {
  const i = service.lastIndexOf('_');
  return i > 0 ? service.slice(i + 1) : '';
};

const SUNDAY = 6;

/** The dates from `from` to `to` each service runs on (services without any are left out). */
export function serviceDates(
  services: Readonly<Record<string, readonly string[]>>,
  from: string,
  to: string,
): Map<string, string[]> {
  const byOperator = new Map<string, string[]>();
  for (const s of Object.keys(services).sort()) {
    const op = operatorOf(s);
    byOperator.set(op, [...(byOperator.get(op) ?? []), s]);
  }
  const out = new Map<string, string[]>();
  for (const ids of byOperator.values()) {
    const sets = new Map(ids.map((id) => [id, new Set(services[id])]));
    const sunday = ids.filter((id) => kindOf(id) === 'D');
    const last = ids.flatMap((id) => services[id] ?? []).reduce((m, d) => (d > m ? d : m), '');
    const listed = (d: string) => ids.filter((id) => sets.get(id)!.has(d));
    const holiday = (d: string, active: readonly string[]) =>
      weekday(d) !== SUNDAY && (isHoliday(d) || active.some((id) => kindOf(id) === 'D'));

    /** What runs on a date the planner lists these services for. */
    const resolve = (d: string, active: readonly string[]): readonly string[] => {
      if (holiday(d, active)) return sunday.length > 0 ? sunday : active;
      const term = active.filter((id) => kindOf(id) === 'UE');
      const outOfTerm = active.filter((id) => kindOf(id) === 'UNE');
      if (term.length > 0 && outOfTerm.length > 0) {
        const notToday = isSchoolDay(d) ? outOfTerm : term;
        return active.filter((id) => !notToday.includes(id));
      }
      return active;
    };

    /** After the last date: the same weekday in the last weeks that was no holiday. */
    const projected = (d: string): readonly string[] => {
      if (isHoliday(d)) return sunday;
      for (let r = last, n = 0; n < 8 * 7; r = addDays(r, -1), n++) {
        if (weekday(r) !== weekday(d)) continue;
        const active = listed(r);
        if (holiday(r, active)) continue;
        return resolve(r, active);
      }
      return [];
    };

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const running = last && d > last ? projected(d) : resolve(d, listed(d));
      for (const id of running) {
        const dates = out.get(id);
        if (dates) dates.push(d);
        else out.set(id, [d]);
      }
    }
  }
  return out;
}
