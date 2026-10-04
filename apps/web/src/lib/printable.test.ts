import { describe, expect, it } from 'vitest';
import { formatClock } from '@madeirabus/engine';
import { makeI18n } from '../i18n.ts';
import { lineNetwork, stopOf } from '../test/network.ts';
import { directionStops, lineDirections, lineGroups, lineMatches } from './lines.ts';
import {
  dayGroupLabel,
  printableTimetable,
  returnOf,
  terminusMarks,
  weekTimetable,
} from './printable.ts';

const net = lineNetwork();
const [line] = lineGroups(net);
const [out, back] = lineDirections(net, line!.routes);
const en = makeI18n('en');
const uk = makeI18n('uk');
// Saturday 3 October 2026, the evening a 110 left Centro at 21:30 for Igreja only.
const SATURDAY = '2026-10-03';
const times = (deps: { time: number }[]) => deps.map((d) => formatClock(d.time));

describe('line numbers and directions', () => {
  it('shows the number on the bus and finds the line by the old one', () => {
    expect(line!.short).toBe('110');
    expect(net.routes[line!.routes[0]!]!.formerly).toBe('10A');
    expect(lineMatches(net, line!, '10a')).toBe(true);
    expect(lineMatches(net, line!, '110')).toBe(true);
    expect(lineMatches(net, line!, 'barreira')).toBe(true);
    expect(lineMatches(net, line!, '12')).toBe(false);
  });

  it('keeps short runs with the way they go, and the way back apart', () => {
    expect([out!.label, back!.label]).toEqual(['Centro → Barreira', 'Barreira → Praça']);
    expect(out!.patterns).toHaveLength(2);
    expect(directionStops(net, out!).map((s) => net.stops[s]!.name)).toEqual([
      'Centro',
      'Escola',
      'Igreja',
      'Barreira',
    ]);
  });
});

describe('a week at a stop', () => {
  it('groups days with the same buses, holidays with Sundays', () => {
    const { groups, basis } = weekTimetable(net, out!.patterns, stopOf(net, 'C'), SATURDAY);
    expect(groups.map((g) => [g.days, g.holidays, times(g.departures)])).toEqual([
      [[0, 1, 2, 3, 4], false, ['07:00', '08:00', '09:00']],
      [[5], false, ['08:30', '21:00', '21:30']],
      [[6], true, ['10:00']],
    ]);
    // Monday the 5th is a holiday, so Mondays are read from the 12th.
    expect(basis).toEqual({ from: SATURDAY, to: '2026-10-12' });
  });

  it('names the columns in the reader’s language', () => {
    const label = (days: number[], holidays = false) => dayGroupLabel(uk, { days, holidays });
    expect(label([0, 1, 2, 3, 4])).toBe('Пн–Пт');
    expect(label([5])).toBe('Субота');
    expect(label([6], true)).toBe('Неділя і свята');
    expect(dayGroupLabel(en, { days: [0, 1, 2, 3, 4], holidays: false })).toBe('Mon–Fri');
    expect(dayGroupLabel(en, { days: [0, 2], holidays: false })).toBe('Mon, Wed');
    expect(dayGroupLabel(en, { days: [0, 1, 2, 3, 4, 5, 6], holidays: true })).toBe('Daily');
  });
});

describe('printable timetable', () => {
  const tt = printableTimetable(
    net,
    en,
    {
      route: line!.routes[0]!,
      direction: out!,
      stop: stopOf(net, 'C'),
      back: true,
      from: SATURDAY,
    },
    '2026-10-04',
  );

  it('marks the bus that turns back early', () => {
    const [first] = tt.sections;
    expect(first!.columns.map((c) => c.label)).toEqual([
      'Mon–Fri',
      'Saturday',
      'Sunday & public holidays',
    ]);
    const saturday = first!.columns[1]!.departures;
    expect(saturday.map((d) => [formatClock(d.time), d.mark])).toEqual([
      ['08:30', undefined],
      ['21:00', undefined],
      ['21:30', 'a'],
    ]);
    expect(first!.legend).toEqual([{ mark: 'a', text: 'only as far as «Igreja»' }]);
    expect(first!.stops).toEqual([
      { name: 'Centro', minutes: 0 },
      { name: 'Escola', minutes: 5 },
      { name: 'Igreja', minutes: 10 },
      { name: 'Barreira', minutes: 15 },
    ]);
  });

  it('adds the way back and says what it is', () => {
    expect(tt.sections[1]!.direction).toBe('Barreira → Praça');
    // No "Centro" on the way back: it starts where the line turns.
    expect(tt.sections[1]!.stop).toBe('Barreira');
    expect(tt.title).toBe('Line 110 — Centro - Barreira');
    expect(tt.formerly).toBe('10A');
    expect(tt.fileName).toBe('MadeiraBus-110-Centro.pdf');
    expect(tt.footer[1]).toContain('Horários do Funchal (GTFS 1)');
  });

  it('boards the way back across the road from the chosen stop', () => {
    const there = returnOf(net, line!.routes, out!, stopOf(net, 'E'));
    expect(there?.direction.label).toBe('Barreira → Praça');
    expect(there && net.stops[there.stop]!.id).toBe('E2');
  });

  it('letters other termini by how often buses end there', () => {
    const marks = terminusMarks(net, out!, [
      { terminus: stopOf(net, 'B') },
      { terminus: stopOf(net, 'I') },
      { terminus: stopOf(net, 'E') },
      { terminus: stopOf(net, 'E') },
    ]);
    expect([...marks.entries()]).toEqual([
      [stopOf(net, 'E'), 'a'],
      [stopOf(net, 'I'), 'b'],
    ]);
  });
});
