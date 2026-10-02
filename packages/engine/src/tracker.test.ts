import { describe, expect, it } from 'vitest';
import { RideTracker, type TrackedStop } from './tracker.ts';

// Five stops ~937 m apart heading east, 2 minutes apart from 10:00.
const T0 = 10 * 3600;
const stops: TrackedStop[] = [0, 1, 2, 3, 4].map((i) => ({
  name: `S${i}`,
  lat: 32.65,
  lon: -16.95 + i * 0.01,
  arr: T0 + i * 120,
  dep: T0 + i * 120,
}));
const at = (lonOffset: number, time: number, accuracy = 10) => ({
  lat: 32.65,
  lon: -16.95 + lonOffset,
  time,
  accuracy,
});

describe('RideTracker', () => {
  it('walks through riding → prepare → next → arrived, alerting once each', () => {
    const t = new RideTracker(stops, []);
    const s1 = t.update(at(0.005, T0 + 60));
    expect(s1.status).toBe('riding');
    expect(s1.nextStop).toBe(1);
    expect(s1.stopsRemaining).toBe(4);

    const s2 = t.update(at(0.025, T0 + 300));
    expect(s2.status).toBe('prepare');
    expect(s2.alert).toBe('prepare');
    expect(t.update(at(0.026, T0 + 310)).alert).toBeUndefined();

    const s3 = t.update(at(0.035, T0 + 420));
    expect(s3.status).toBe('next');
    expect(s3.alert).toBe('next');
    expect(s3.stopsRemaining).toBe(1);

    const s4 = t.update(at(0.0399, T0 + 480));
    expect(s4.status).toBe('arrived');
    expect(s4.alert).toBe('arrived');
    expect(s4.stopsRemaining).toBe(0);
  });

  it('estimates delay and ETA from GPS progress', () => {
    const t = new RideTracker(stops, []);
    // Halfway to S1 three minutes after departure: about 2 minutes late.
    const s = t.update(at(0.005, T0 + 180));
    expect(s.delay).toBeGreaterThan(90);
    expect(s.delay).toBeLessThan(150);
    expect(s.eta).toBeCloseTo(stops[4]!.arr + s.delay, 0);
    expect(t.canConnect(s, stops[4]!.arr + 60, 60)).toBe(false);
    expect(t.canConnect(s, stops[4]!.arr + 600, 60)).toBe(true);
  });

  it('keeps moving on the timetable through a tunnel', () => {
    const t = new RideTracker(stops, []);
    t.update(at(0.01, T0 + 120)); // on time at S1
    const blind = t.tick(T0 + 360); // no GPS for 4 minutes
    expect(blind.source).toBe('timetable');
    expect(blind.nextStop).toBe(4);
    expect(blind.status).toBe('next');
  });

  it('ignores inaccurate fixes and detects being off route', () => {
    const t = new RideTracker(stops, []);
    // A 500 m-accuracy fix 2.8 km down the road is ignored; the timetable is used instead.
    const fuzzy = t.update(at(0.03, T0 + 30, 500));
    expect(fuzzy.source).toBe('timetable');
    expect(fuzzy.progress).toBeLessThan(300);
    const away = { lat: 32.7, lon: -16.94, time: T0 + 60, accuracy: 10 };
    t.update(away);
    t.update({ ...away, time: T0 + 70 });
    const s = t.update({ ...away, time: T0 + 80 });
    expect(s.status).toBe('off-route');
    expect(s.alert).toBe('off-route');
  });

  it('does not jump back to an earlier stop on GPS jitter', () => {
    const t = new RideTracker(stops, []);
    t.update(at(0.025, T0 + 300));
    const back = t.update(at(0.012, T0 + 310));
    expect(back.progress).toBeGreaterThan(2000);
    expect(back.status).toBe('prepare');
  });

  it('waits until the bus is close on a long non-stop run', () => {
    // Airport-express style: two stops ~10 km apart, 15 minutes.
    const express: TrackedStop[] = [
      { name: 'A', lat: 32.65, lon: -16.95, arr: T0, dep: T0 },
      { name: 'B', lat: 32.65, lon: -16.843, arr: T0 + 900, dep: T0 + 900 },
    ];
    const t = new RideTracker(express, []);
    expect(t.update(at(0.01, T0 + 60)).status).toBe('riding');
    expect(t.update(at(0.08, T0 + 600)).status).toBe('prepare');
    const near = t.update(at(0.095, T0 + 780));
    expect(near.status).toBe('next');
    expect(near.alert).toBe('next');
  });
});
