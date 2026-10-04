import { describe, expect, it } from 'vitest';
import { formatClock } from './time.ts';
import { at, fixtureNetwork, SATURDAY, stopIndex, WEEKDAY } from './test-fixtures.ts';
import { directConnections, stopDepartures } from './timetable.ts';

const net = fixtureNetwork();
const s = (id: Parameters<typeof stopIndex>[1]) => stopIndex(net, id);
const routeOf = (short: string) => new Set([net.routes.findIndex((r) => r.short === short)]);

describe('directConnections', () => {
  it('lists every direct bus of the day, first to last', () => {
    const list = directConnections(net, [s('A')], [s('D')], WEEKDAY);
    // Line 1 every half hour from 06:00 to 20:00, plus the 08:05 express.
    expect(list).toHaveLength(30);
    expect(formatClock(list[0]!.depart)).toBe('06:00');
    expect(formatClock(list[0]!.arrive)).toBe('06:30');
    expect(formatClock(list[list.length - 1]!.depart)).toBe('20:00');
    const express = list.find((c) => net.routes[c.route]!.short === '4X')!;
    expect([express.depart, express.arrive]).toEqual([at(8, 5), at(8, 20)]);
    expect(list.map((c) => c.depart)).toEqual([...list.map((c) => c.depart)].sort((a, b) => a - b));
  });

  it('keeps to the chosen lines, directions and days', () => {
    expect(
      directConnections(net, [s('A')], [s('D')], WEEKDAY, { routes: routeOf('1') }),
    ).toHaveLength(29);
    expect(directConnections(net, [s('D')], [s('A')], WEEKDAY)).toEqual([]);
    expect(directConnections(net, [s('A')], [s('D')], SATURDAY)).toEqual([]);
  });

  it('boards at the first stop of a group and leaves at the first stop of the other', () => {
    const [first] = directConnections(net, [s('A'), s('B')], [s('C'), s('D')], WEEKDAY, {
      routes: routeOf('1'),
    });
    expect([first!.from, first!.to]).toEqual([s('A'), s('C')]);
    expect([first!.depart, first!.arrive]).toEqual([at(6), at(6, 20)]);
  });

  it('boards and leaves at the nearest stops when they are listed nearest first', () => {
    const [first] = directConnections(net, [s('B'), s('A')], [s('D'), s('C')], WEEKDAY, {
      routes: routeOf('1'),
      pick: 'listed',
    });
    expect([first!.from, first!.to]).toEqual([s('B'), s('D')]);
    expect([first!.depart, first!.arrive]).toEqual([at(6, 10), at(6, 30)]);
  });

  it('keeps a trip after midnight on the day it belongs to', () => {
    // The 24:30 night bus closes Wednesday; Tuesday's one is not Wednesday's.
    const night = directConnections(net, [s('A')], [s('B')], WEEKDAY, { routes: routeOf('N') });
    expect(night.map((c) => c.depart)).toEqual([at(24, 30)]);
  });
});

describe('stopDepartures', () => {
  it('lists the departures of a direction from a stop', () => {
    const patterns = net.patterns.flatMap((p, i) =>
      net.routes[p.route]!.short === '1' ? [i] : [],
    );
    const fromB = stopDepartures(net, patterns, s('B'), WEEKDAY);
    expect(fromB).toHaveLength(29);
    expect(fromB[0]!.time).toBe(at(6, 10));
    expect(fromB.every((d) => d.terminus === s('D'))).toBe(true);
    // Nobody boards at the last stop.
    expect(stopDepartures(net, patterns, s('D'), WEEKDAY)).toEqual([]);
  });
});
