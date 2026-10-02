import { describe, expect, it } from 'vitest';
import {
  addDays,
  easterSunday,
  formatClock,
  gtfsDateToIso,
  madeiraHolidays,
  madeiraNow,
  parseGtfsTime,
  weekday,
} from './time.ts';

describe('time', () => {
  it('parses GTFS times past midnight', () => {
    expect(parseGtfsTime('07:05:30')).toBe(7 * 3600 + 5 * 60 + 30);
    expect(parseGtfsTime('25:10:00')).toBe(25 * 3600 + 600);
    expect(() => parseGtfsTime('soon')).toThrow();
  });

  it('formats clock times and wraps at midnight', () => {
    expect(formatClock(8 * 3600 + 5 * 60)).toBe('08:05');
    expect(formatClock(24 * 3600 + 30 * 60)).toBe('00:30');
    expect(formatClock(-30 * 60)).toBe('23:30');
  });

  it('does calendar arithmetic', () => {
    expect(gtfsDateToIso('20260701')).toBe('2026-07-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekday('2026-10-02')).toBe(4); // Friday
  });

  it('knows Madeira time regardless of the device zone', () => {
    // Summer time (WEST, UTC+1).
    expect(madeiraNow(new Date('2026-07-01T12:00:00Z'))).toEqual({
      date: '2026-07-01',
      time: 13 * 3600,
    });
    // Winter time (WET, UTC+0), just before midnight.
    expect(madeiraNow(new Date('2026-12-31T23:59:00Z'))).toEqual({
      date: '2026-12-31',
      time: 86_340,
    });
  });

  it('computes Easter and the regional holidays', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    const dates = madeiraHolidays(2026).map((h) => h.date);
    expect(dates).toContain('2026-07-01'); // Dia da Região
    expect(dates).toContain('2026-12-26'); // Primeira Oitava
    expect(dates).toContain('2026-04-03'); // Good Friday
    expect(dates).toContain('2026-06-04'); // Corpus Christi
  });
});
