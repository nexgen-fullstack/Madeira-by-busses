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

  // A mountain road drawn in detail: a point every ~9 m, like the operators' shapes.
  const detailed = Array.from({ length: 401 }, (_, i) => ({
    lat: 32.65,
    lon: -16.95 + i * 0.0001,
  }));

  it('finds the bus again after a long tunnel on a detailed road', () => {
    const t = new RideTracker(stops, detailed);
    t.update(at(0.01, T0 + 120)); // on time at S1
    t.tick(T0 + 260); // into the tunnel: the timetable carries on
    // Out of the tunnel a little behind the timetable's guess, near S3.
    const out = [0, 5, 10].map((dt) => t.update(at(0.029 + dt * 0.00001, T0 + 300 + dt)));
    expect(out.map((s) => s.status)).not.toContain('off-route');
    expect(out[2]!.source).toBe('gps');
    expect(out[2]!.progress).toBeGreaterThan(2650);
    expect(out[2]!.progress).toBeLessThan(2800);
    expect(out[2]!.status).toBe('prepare');
  });

  it('picks the ride up again when the bus comes back from a detour', () => {
    const t = new RideTracker(stops, detailed);
    t.update(at(0.005, T0 + 60));
    const away = { lat: 32.66, lon: -16.94, accuracy: 10 };
    for (const dt of [70, 80, 90]) t.update({ ...away, time: T0 + dt });
    expect(t.update({ ...away, time: T0 + 100 }).status).toBe('off-route');
    // Back on the road 2 km further on.
    const back = t.update(at(0.025, T0 + 290));
    expect(back.status).not.toBe('off-route');
    expect(back.progress).toBeGreaterThan(2300);
  });

  it('on a loop, takes the pass of the road the timetable expects', () => {
    // Out east along one street and back west along the next one, 155 m away.
    const out = Array.from({ length: 201 }, (_, i) => ({ lat: 32.65, lon: -16.95 + i * 0.0001 }));
    const back = out.map((p) => ({ lat: 32.6514, lon: p.lon })).reverse();
    const loop: TrackedStop[] = [
      { name: 'A', lat: 32.65, lon: -16.95, arr: T0, dep: T0 },
      { name: 'B', lat: 32.65, lon: -16.93, arr: T0 + 300, dep: T0 + 300 },
      { name: 'C', lat: 32.6514, lon: -16.94, arr: T0 + 450, dep: T0 + 450 },
      { name: 'D', lat: 32.6514, lon: -16.95, arr: T0 + 600, dep: T0 + 600 },
    ];
    const t = new RideTracker(loop, [...out, ...back]);
    t.update(at(0.002, T0 + 30));
    const away = { lat: 32.647, lon: -16.945, accuracy: 10 };
    for (const dt of [40, 50, 60]) t.update({ ...away, time: T0 + dt });
    // Back from the detour between the two streets, a little nearer the way
    // home: the timetable says the bus is still on its way out, so no "get off".
    const backOnRoute = t.update({ lat: 32.6508, lon: -16.94, time: T0 + 150, accuracy: 10 });
    expect(backOnRoute.status).toBe('riding');
    expect(backOnRoute.progress).toBeGreaterThan(850);
    expect(backOnRoute.progress).toBeLessThan(1050);
  });
});
