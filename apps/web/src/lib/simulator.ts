import {
  cumulativeDistances,
  pointAlong,
  projectOnPolyline,
  type Fix,
  type LatLon,
  type TrackedStop,
} from '@madeirabus/engine';

/**
 * Fake GPS for demos and tests: drives along the ride's shape following the
 * timetable plus a fixed delay, with light jitter and a "tunnel" (no fixes)
 * in the middle of longer rides.
 */
export class RideSimulator {
  private readonly cum: number[];
  private readonly stopAlong: number[] = [];
  private readonly total: number;

  constructor(
    private readonly stops: readonly TrackedStop[],
    private readonly shape: readonly LatLon[],
    private readonly delay = 60,
  ) {
    this.cum = cumulativeDistances(shape);
    let from = 0;
    for (const s of stops) {
      const pr = projectOnPolyline(shape, this.cum, s, from);
      this.stopAlong.push(pr.along);
      from = pr.segment;
    }
    this.total = this.stopAlong[this.stopAlong.length - 1] ?? 0;
  }

  /** Where the simulated bus is at `time` (service-day seconds); null inside the tunnel. */
  fixAt(time: number): Fix | null {
    const along = this.alongAt(time - this.delay);
    const frac = this.total > 0 ? along / this.total : 0;
    if (this.total > 2000 && frac > 0.45 && frac < 0.6) return null;
    const p = pointAlong(this.shape, this.cum, along);
    const jitter = 0.00004;
    return {
      lat: p.lat + Math.sin(time / 7) * jitter,
      lon: p.lon + Math.cos(time / 5) * jitter,
      time,
      accuracy: 8,
    };
  }

  private alongAt(time: number): number {
    const s = this.stops;
    const a = this.stopAlong;
    if (time <= s[0]!.dep) return a[0]!;
    for (let i = 1; i < s.length; i++) {
      if (time <= s[i]!.arr) {
        const span = s[i]!.arr - s[i - 1]!.dep;
        const f = span <= 0 ? 1 : (time - s[i - 1]!.dep) / span;
        return a[i - 1]! + f * (a[i]! - a[i - 1]!);
      }
      if (time <= s[i]!.dep) return a[i]!;
    }
    return a[a.length - 1]!;
  }
}
