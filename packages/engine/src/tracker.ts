import {
  cumulativeDistances,
  haversine,
  pointAlong,
  projectOnPolyline,
  type LatLon,
  type Projection,
} from './geo.ts';

/**
 * On-board tracking for one ride: snaps GPS fixes to the route shape, works
 * out the next stop and how many stops remain, estimates the delay against
 * the timetable and raises "get ready" / "get off next" alerts. When GPS is
 * lost (Madeira's expressways run through many tunnels) it keeps going by
 * dead reckoning along the timetable, corrected by the last known delay.
 * Everything runs on the phone; positions never leave the device.
 */

export interface TrackedStop extends LatLon {
  name: string;
  /** Scheduled arrival / departure, seconds after midnight of the service day. */
  arr: number;
  dep: number;
}

export interface TrackerOptions {
  /** Alert this many stops before the alighting stop (inclusive). */
  prepareStops: number;
  /** Or when closer than this to the alighting stop (m). */
  prepareDistance: number;
  /** …but never earlier than this far out, so long non-stop runs don't alarm too soon (m). */
  prepareMaxDistance: number;
  /** "Get off at the next stop" only within this distance of the alighting stop (m). */
  nextDistance: number;
  /** Considered arrived within this distance (m). */
  arrivalRadius: number;
  /** Fixes worse than this are ignored (m). */
  maxAccuracy: number;
  /** Without a usable fix for this long, switch to the timetable (s). */
  gpsTimeout: number;
  /** Off-route when farther than this from the shape (m)… */
  offRouteDistance: number;
  /** …for this many consecutive fixes. */
  offRouteFixes: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  prepareStops: 2,
  prepareDistance: 900,
  prepareMaxDistance: 4000,
  nextDistance: 1500,
  arrivalRadius: 40,
  maxAccuracy: 120,
  gpsTimeout: 25,
  offRouteDistance: 220,
  offRouteFixes: 3,
};

export interface Fix extends LatLon {
  /** Seconds after midnight of the service day. */
  time: number;
  /** Horizontal accuracy (m). */
  accuracy?: number;
}

export type TrackStatus = 'waiting' | 'riding' | 'prepare' | 'next' | 'arrived' | 'off-route';

export interface TrackState {
  status: TrackStatus;
  position: LatLon;
  source: 'gps' | 'timetable';
  /** Distance travelled along the shape (m). */
  progress: number;
  /** Index (in the stop list) of the next stop ahead. */
  nextStop: number;
  /** Stops left including the alighting stop (0 once arrived). */
  stopsRemaining: number;
  distanceRemaining: number;
  /** Estimated arrival at the alighting stop (s after midnight). */
  eta: number;
  /** Positive = running late (s). */
  delay: number;
  /** Set only on the update where the status changes into an alertable state. */
  alert?: 'prepare' | 'next' | 'arrived' | 'off-route';
}

const RANK: Record<TrackStatus, number> = {
  waiting: 0,
  riding: 1,
  prepare: 2,
  next: 3,
  arrived: 4,
  'off-route': 1,
};

/** Faster than any bus on Madeira's roads (m/s), to bound how far one can have gone. */
const MAX_SPEED = 30;

type Alert = NonNullable<TrackState['alert']>;
const isAlert = (s: TrackStatus): s is Alert =>
  s === 'prepare' || s === 'next' || s === 'arrived' || s === 'off-route';

export class RideTracker {
  private readonly opts: TrackerOptions;
  private readonly shape: LatLon[];
  private readonly cum: number[];
  /** Distance along the shape of every stop. */
  readonly stopAlong: number[];
  private progress = 0;
  private segment = 0;
  private delay = 0;
  private hasDelay = false;
  private lastFixTime = -Infinity;
  private lastPosition: LatLon;
  private offRouteCount = 0;
  private status: TrackStatus = 'waiting';
  /** The position since the last fix is the timetable's guess, not GPS. */
  private reckoned = false;
  /** Where and when the last fix on the route was. */
  private lastOnRoute = { along: 0, time: -Infinity };

  constructor(
    readonly stops: readonly TrackedStop[],
    shape: readonly LatLon[],
    options: Partial<TrackerOptions> = {},
  ) {
    if (stops.length < 2) throw new Error('A ride needs at least two stops');
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...options };
    this.shape = shape.length >= 2 ? [...shape] : stops.map((s) => ({ lat: s.lat, lon: s.lon }));
    this.cum = cumulativeDistances(this.shape);
    // Snap stops to the shape in order, never moving backwards.
    this.stopAlong = [];
    let from = 0;
    for (const s of stops) {
      const pr = projectOnPolyline(this.shape, this.cum, s, from);
      this.stopAlong.push(pr.along);
      from = pr.segment;
    }
    this.lastPosition = stops[0]!;
  }

  get alightIndex(): number {
    return this.stops.length - 1;
  }

  /** Feed a GPS fix. */
  update(fix: Fix): TrackState {
    if ((fix.accuracy ?? 0) > this.opts.maxAccuracy) return this.tick(fix.time);
    // Search a window around the current position; allow a little backwards
    // jitter but prefer forward progress on hairpins that pass close by.
    let pr = projectOnPolyline(
      this.shape,
      this.cum,
      fix,
      Math.max(0, this.segment - 3),
      this.segment + 40,
    );
    if (pr.offset > this.opts.offRouteDistance && (this.reckoned || this.status === 'off-route')) {
      // Out of a tunnel the bus may be ahead of or behind the timetable's
      // guess, and back from a detour it can rejoin further on.
      pr = this.relocate(fix) ?? pr;
    }
    if (pr.offset > this.opts.offRouteDistance) {
      this.offRouteCount++;
      if (this.offRouteCount >= this.opts.offRouteFixes) {
        this.lastFixTime = fix.time;
        this.lastPosition = fix;
        return this.emit('off-route', fix.time, 'gps');
      }
      return this.tick(fix.time);
    }
    this.offRouteCount = 0;
    if (this.reckoned) {
      // GPS is back: it knows better than the timetable, even if that is behind.
      this.progress = pr.along;
      this.segment = pr.segment;
      this.reckoned = false;
    } else if (pr.along + 30 >= this.progress) {
      this.progress = Math.max(this.progress, pr.along);
      this.segment = pr.segment;
    }
    this.lastFixTime = fix.time;
    this.lastOnRoute = { along: this.progress, time: fix.time };
    this.lastPosition = pr.point;
    if (this.progress > this.stopAlong[0]! + 50 || fix.time >= this.stops[0]!.dep) {
      // Exponential smoothing keeps a single noisy fix from swinging the ETA.
      const observed = fix.time - this.scheduledTimeAt(this.progress);
      this.delay = this.hasDelay ? 0.7 * this.delay + 0.3 * observed : observed;
      this.hasDelay = true;
    }
    return this.emit(this.statusFor(), fix.time, 'gps');
  }

  /** Advance without a fix (call every few seconds). */
  tick(time: number): TrackState {
    if (time - this.lastFixTime <= this.opts.gpsTimeout) {
      return this.emit(this.status === 'off-route' ? 'off-route' : this.statusFor(), time, 'gps');
    }
    if (time >= this.stops[0]!.dep + Math.max(0, this.delay)) {
      const along = this.scheduledAlongAt(time - this.delay);
      if (along > this.progress) {
        this.progress = along;
        // Fixes after the tunnel are looked for from here on.
        this.segment = this.segmentAt(along);
        this.reckoned = true;
        this.lastPosition = pointAlong(this.shape, this.cum, along);
      }
    }
    return this.emit(this.statusFor(), time, 'timetable');
  }

  /** Can we still make a connection leaving the alighting stop at `departure` after `walk` seconds? */
  canConnect(state: TrackState, departure: number, walk: number, buffer = 60): boolean {
    return state.eta + walk + buffer <= departure;
  }

  private statusFor(): TrackStatus {
    const alight = this.alightIndex;
    const remaining = this.stopAlong[alight]! - this.progress;
    if (remaining <= this.opts.arrivalRadius) return 'arrived';
    const next = this.nextStopIndex();
    const stopsRemaining = alight - next + 1;
    if (stopsRemaining <= 1 && remaining <= this.opts.nextDistance) return 'next';
    if (
      remaining <= this.opts.prepareDistance ||
      (stopsRemaining <= this.opts.prepareStops && remaining <= this.opts.prepareMaxDistance)
    ) {
      return 'prepare';
    }
    return this.progress > this.stopAlong[0]! + 50 ? 'riding' : 'waiting';
  }

  /**
   * Finds the bus on the shape when the search around its last position
   * fails: as far along as it can have gone since its last fix on the route,
   * each place the road passes near the fix, and of those the one where the
   * timetable expects the bus (a loop can pass the same spot twice).
   */
  private relocate(fix: Fix): Projection | undefined {
    const { along, time } = this.lastOnRoute;
    const from = this.segmentAt(along - 300);
    const to = this.segmentAt(along + Math.max(0, fix.time - time) * MAX_SPEED + 500);
    const expected = this.scheduledAlongAt(fix.time - this.delay);
    let best: Projection | undefined;
    let pass: Projection | undefined;
    const endPass = () => {
      if (pass && (!best || Math.abs(pass.along - expected) < Math.abs(best.along - expected))) {
        best = pass;
      }
      pass = undefined;
    };
    for (let i = from; i <= to; i++) {
      const pr = projectOnPolyline(this.shape, this.cum, fix, i, i);
      if (pr.offset > this.opts.offRouteDistance) endPass();
      else if (!pass || pr.offset < pass.offset) pass = pr;
    }
    endPass();
    return best;
  }

  /** The shape's segment at `along` metres from its start. */
  private segmentAt(along: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid]! <= along) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private nextStopIndex(): number {
    for (let i = 0; i < this.stopAlong.length; i++) {
      if (this.stopAlong[i]! > this.progress + this.opts.arrivalRadius) return i;
    }
    return this.alightIndex;
  }

  private emit(status: TrackStatus, time: number, source: 'gps' | 'timetable'): TrackState {
    // Never step back from a stronger alert because of GPS jitter.
    if (status !== 'off-route' && this.status !== 'off-route' && RANK[status] < RANK[this.status]) {
      status = this.status;
    }
    const alert = status !== this.status && isAlert(status) ? status : undefined;
    this.status = status;
    const alight = this.alightIndex;
    const distanceRemaining = Math.max(0, this.stopAlong[alight]! - this.progress);
    const next = status === 'arrived' ? alight : this.nextStopIndex();
    return {
      status,
      position: this.lastPosition,
      source,
      progress: this.progress,
      nextStop: next,
      stopsRemaining: status === 'arrived' ? 0 : alight - next + 1,
      distanceRemaining,
      eta: Math.max(time, this.stops[alight]!.arr + this.delay),
      delay: Math.round(this.delay),
      ...(alert ? { alert } : {}),
    };
  }

  /** Timetable time at which the bus should be at distance `along`. */
  private scheduledTimeAt(along: number): number {
    const a = this.stopAlong;
    if (along <= a[0]!) return this.stops[0]!.dep;
    for (let i = 1; i < a.length; i++) {
      if (along <= a[i]!) {
        const span = a[i]! - a[i - 1]!;
        const f = span === 0 ? 1 : (along - a[i - 1]!) / span;
        const t0 = this.stops[i - 1]!.dep;
        return t0 + f * (this.stops[i]!.arr - t0);
      }
    }
    return this.stops[a.length - 1]!.arr;
  }

  /** Inverse of scheduledTimeAt: where the bus should be at `time`. */
  private scheduledAlongAt(time: number): number {
    const a = this.stopAlong;
    const s = this.stops;
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

/** Straight-line distance helper re-exported for UI code. */
export const distanceBetween = haversine;
