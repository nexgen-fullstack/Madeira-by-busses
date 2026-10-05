import { addDays, weekday } from '@madeirabus/engine';
import { describe, expect, it } from 'vitest';
import { serviceDates } from './services.ts';

/** The weekdays (or the days of the week in `days`, 0 = Monday) from `from` to `to`. */
const days = (from: string, to: string, which = [0, 1, 2, 3, 4]) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (which.includes(weekday(d))) out.push(d);
  return out;
};

// As SIGA's journey planner lists them: both weekday services on every weekday, and the
// Sunday service on holidays as well as the weekday ones.
const SERVICES = {
  UE_002: days('2026-09-10', '2027-06-30'),
  UNE_002: days('2026-09-01', '2027-08-31'),
  S_002: days('2026-09-05', '2027-08-28', [5]),
  D_002: [...days('2026-09-06', '2027-08-29', [6]), '2026-10-05', '2026-10-19'].sort(),
  // CAM: its timetable ends with November.
  UE_003: days('2026-09-01', '2026-11-30'),
  S_003: days('2026-09-05', '2026-11-28', [5]),
  D_003: [...days('2026-09-06', '2026-11-29', [6]), '2026-10-05'].sort(),
};

describe('serviceDates', () => {
  const dates = serviceDates(SERVICES, '2026-10-01', '2027-01-15');
  const on = (day: string) =>
    [...dates]
      .filter(([, d]) => d.includes(day))
      .map(([s]) => s)
      .sort();

  it('runs the Sunday service alone on a holiday', () => {
    expect(on('2026-10-05')).toEqual(['D_002', 'D_003']);
  });

  it("takes a weekday with the operator's Sunday service for a holiday of its own", () => {
    expect(on('2026-10-19')).toEqual(['D_002', 'UE_003']);
  });

  it('picks the term-time or the school-holiday service by the school calendar', () => {
    expect(on('2026-10-06')).toEqual(['UE_002', 'UE_003']);
    expect(on('2026-12-21')).toContain('UNE_002');
    expect(on('2026-12-21')).not.toContain('UE_002');
  });

  it("carries an operator's week on after its timetable ends", () => {
    expect(on('2026-12-02')).toEqual(['UE_002', 'UE_003']);
    expect(on('2026-12-05')).toEqual(['S_002', 'S_003']);
    expect(on('2026-12-06')).toEqual(['D_002', 'D_003']);
    // Madeira's holidays run the Sunday service then too.
    expect(on('2026-12-08')).toEqual(['D_002', 'D_003']);
  });
});
