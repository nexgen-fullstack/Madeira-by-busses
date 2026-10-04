import { quoteFare, type FareQuote, type FareRide } from './fares.ts';
import { haversine, walkSeconds, type LatLon } from './geo.ts';
import type { DayTimetable, Network } from './network.ts';
import type { WalkGraph, WalkHit } from './walk.ts';

/**
 * Journey planner based on RAPTOR (Delling, Pajor, Werneck — "Round-Based
 * Public Transit Routing", 2012). Round k finds the earliest arrival at every
 * stop using exactly k vehicles, so the rounds directly give the Pareto set of
 * (arrival time, number of transfers). A range loop on top of it returns
 * several departure options, like the list in a maps app.
 */

export interface Place extends LatLon {
  name?: string;
  /** Explicit stops (e.g. a stop picked from search); otherwise nearby stops are used. */
  stops?: readonly number[];
}

export interface PlanOptions {
  maxTransfers: number;
  /** Walking speed in m/s. */
  walkSpeed: number;
  /** Max walking distance to the first / from the last stop (m). */
  maxAccessWalk: number;
  /**
   * When a stop is chosen as origin or destination, other stops within this
   * walk of it are used too (m): a bus round the corner may be the better one.
   */
  stopWalk: number;
  /** Buffer when changing buses at the same stop (s). */
  minTransferTime: number;
  /** Extra buffer after walking to another stop (s). */
  walkTransferSlack: number;
  /** How far ahead to look for alternatives (s). */
  window: number;
  maxResults: number;
  /**
   * Time an extra transfer must save to be worth showing (s): an itinerary is
   * hidden when one with fewer transfers leaves no earlier and arrives at most
   * this much later per transfer saved.
   */
  transferPenalty: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  maxTransfers: 3,
  walkSpeed: 1.25,
  maxAccessWalk: 1000,
  stopWalk: 400,
  minTransferTime: 120,
  walkTransferSlack: 60,
  window: 3 * 3600,
  maxResults: 5,
  transferPenalty: 600,
};

export interface PlanRequest {
  from: Place;
  to: Place;
  /** ISO date in Madeira local time. */
  date: string;
  /** Seconds after midnight. */
  time: number;
  options?: Partial<PlanOptions>;
}

export interface PlaceRef extends LatLon {
  name: string;
  stop?: number;
}

export interface WalkLeg {
  kind: 'walk';
  from: PlaceRef;
  to: PlaceRef;
  start: number;
  end: number;
  distance: number;
  /** The way along the streets, when the walking network is known. */
  path?: LatLon[];
}

export interface RideStop {
  stop: number;
  arr: number;
  dep: number;
}

export interface RideLeg {
  kind: 'ride';
  pattern: number;
  route: number;
  dayTrip: number;
  tripId: string;
  headsign: string;
  from: PlaceRef;
  to: PlaceRef;
  boardPos: number;
  alightPos: number;
  start: number;
  end: number;
  /** Board stop … alight stop, inclusive. */
  stops: RideStop[];
  /** Waiting time at the boarding stop. */
  wait: number;
  /** For transfers: true if the buffer is short and the next bus is far off. */
  risky?: boolean;
  /** Departure of the next trip of the same pattern from the boarding stop. */
  nextDeparture?: number;
}

export type Leg = WalkLeg | RideLeg;

export interface Itinerary {
  key: string;
  legs: Leg[];
  depart: number;
  arrive: number;
  duration: number;
  rides: number;
  transfers: number;
  walkDistance: number;
  waitTime: number;
  fare: FareQuote;
  risky: boolean;
}

interface Access {
  stop: number;
  seconds: number;
  distance: number;
}

const INF = Number.POSITIVE_INFINITY;
const ACCESS = 1;
const RIDE = 2;
const WALK = 3;

/** Street metres allowed to a stop, against `maxAccessWalk` metres as the crow flies. */
const STREET_ALLOWANCE = 1.35;

export class Planner {
  private walk?: WalkGraph;
  private stopHits?: (WalkHit | undefined)[];

  constructor(
    private readonly net: Network,
    walk?: WalkGraph,
  ) {
    if (walk) this.setWalk(walk);
  }

  /**
   * Streets, steps and paths to walk on: from now on the way to and from the
   * stops is measured along them and every walk comes with its path.
   */
  setWalk(walk: WalkGraph): void {
    this.walk = walk;
    this.stopHits = undefined;
    this.hits();
  }

  /** Where each stop meets the walking network. */
  private hits(): (WalkHit | undefined)[] {
    const walk = this.walk!;
    this.stopHits ??= this.net.stops.map((s) => walk.snap(s, 120));
    return this.stopHits;
  }

  plan(request: PlanRequest): Itinerary[] {
    const ctx = this.context(request);
    const found = new Map<string, Itinerary>();
    let t = request.time;
    for (let iter = 0; iter < 12 && t <= request.time + ctx.opts.window; iter++) {
      const batch = ctx.searchAt(t);
      if (batch.length === 0) break;
      for (const it of batch) if (!found.has(it.key)) found.set(it.key, it);
      if (found.size >= ctx.opts.maxResults * 3) break;
      // Next iteration: leave a minute after the earliest option found.
      t = Math.min(...batch.map((it) => it.depart)) + 60;
    }

    const results = [...found.values()];
    const direct = this.directWalk(request, ctx.opts);
    if (direct) results.push(direct);
    return paretoFilter(results, ctx.opts.transferPenalty)
      .sort((a, b) => a.arrive - b.arrive || b.depart - a.depart)
      .slice(0, ctx.opts.maxResults)
      .map((it) => this.withPaths(it));
  }

  /** Draws each walk of an itinerary along the streets. */
  private withPaths(it: Itinerary): Itinerary {
    const walk = this.walk;
    if (!walk) return it;
    const legs = it.legs.map((leg) => {
      if (leg.kind !== 'walk' || leg.path) return leg;
      const route = walk.route(leg.from, leg.to);
      // A walk that the streets make far longer than planned is better left straight.
      if (!route || route.length > leg.distance * 3 + 300) return leg;
      return { ...leg, path: route.path, distance: Math.round(route.length) };
    });
    const walkDistance = legs.reduce((d, l) => d + (l.kind === 'walk' ? l.distance : 0), 0);
    return { ...it, legs, walkDistance };
  }

  /**
   * The latest departure (at or after `request.time`) that still reaches the
   * destination by bus on this service day — "when is the last bus back?".
   * Reachability is monotonic in the departure time, so a binary search over
   * it needs only ~12 RAPTOR runs.
   */
  lastConnection(request: PlanRequest, until = 28 * 3600): Itinerary | undefined {
    const ctx = this.context(request);
    const reach = (t: number) => ctx.searchAt(t).filter((it) => it.rides > 0);
    let found = reach(request.time);
    if (found.length === 0) return undefined;
    let lo = request.time;
    let hi = until;
    while (hi - lo > 120) {
      const mid = Math.floor((lo + hi) / 2);
      const at = reach(mid);
      if (at.length > 0) {
        lo = mid;
        found = at;
      } else {
        hi = mid;
      }
    }
    const last = found.sort((a, b) => b.depart - a.depart || a.arrive - b.arrive)[0];
    return last && this.withPaths(last);
  }

  private context(request: PlanRequest) {
    const opts = { ...DEFAULT_PLAN_OPTIONS, ...request.options };
    const day = this.net.timetable(request.date);
    const access = this.access(request.from, opts);
    const egress = new Map(this.access(request.to, opts).map((e) => [e.stop, e]));
    return {
      opts,
      searchAt: (t: number) => this.search(day, request, access, egress, t, opts),
    };
  }

  private access(place: Place, opts: PlanOptions): Access[] {
    if (place.stops && place.stops.length > 0) {
      const best = new Map<number, Access>();
      for (const stop of place.stops) best.set(stop, { stop, seconds: 0, distance: 0 });
      if (opts.stopWalk > 0) {
        for (const stop of place.stops) {
          for (const h of this.net.nearbyStops(this.net.stops[stop]!, opts.stopWalk)) {
            const seconds = walkSeconds(h.distance, opts.walkSpeed);
            const known = best.get(h.stop);
            if (!known || seconds < known.seconds)
              best.set(h.stop, { stop: h.stop, seconds, distance: Math.round(h.distance) });
          }
        }
      }
      return [...best.values()];
    }
    const walked = this.walkAccess(place, opts);
    if (walked && walked.length > 0) return walked;
    let hits = this.net.nearbyStops(place, opts.maxAccessWalk);
    if (hits.length === 0) {
      // Nothing within walking range: allow a longer walk to the 3 nearest stops.
      hits = this.net.grid
        .nearest(place, 3, 5000)
        .map((h) => ({ stop: h.index, distance: h.distance }));
    }
    return hits.map((h) => ({
      stop: h.stop,
      distance: Math.round(h.distance),
      seconds: walkSeconds(h.distance, opts.walkSpeed),
    }));
  }

  /** The stops around a point and the walk to each along the streets. */
  private walkAccess(place: LatLon, opts: PlanOptions): Access[] | undefined {
    const walk = this.walk;
    if (!walk) return undefined;
    const start = walk.snap(place, 400);
    if (!start) return undefined;
    const max = opts.maxAccessWalk * STREET_ALLOWANCE;
    const hits = this.hits();
    const near = this.net.nearbyStops(place, max).filter((h) => hits[h.stop]);
    const found = walk.distances(
      start,
      near.map((h) => hits[h.stop]!),
      max,
    );
    const out: Access[] = [];
    near.forEach((h, i) => {
      const d = found[i];
      if (!d) return;
      out.push({
        stop: h.stop,
        distance: Math.round(d.length),
        seconds: Math.round(d.cost / opts.walkSpeed),
      });
    });
    return out;
  }

  private search(
    day: DayTimetable,
    request: PlanRequest,
    access: Access[],
    egress: Map<number, Access>,
    t0: number,
    opts: PlanOptions,
  ): Itinerary[] {
    const net = this.net;
    const n = net.stops.length;
    const K = opts.maxTransfers + 1;
    const scale = net.walkSpeed / opts.walkSpeed;

    const tau: Float64Array[] = [];
    const kind: Uint8Array[] = [];
    const la: Int32Array[] = []; // ride: pattern | walk: from stop | access: distance
    const lb: Int32Array[] = []; // ride: day trip | walk: seconds | access: seconds
    const lc: Int32Array[] = []; // ride: board pos
    const ld: Int32Array[] = []; // ride: alight pos
    for (let k = 0; k <= K; k++) {
      tau.push(new Float64Array(n).fill(INF));
      kind.push(new Uint8Array(n));
      la.push(new Int32Array(n));
      lb.push(new Int32Array(n));
      lc.push(new Int32Array(n));
      ld.push(new Int32Array(n));
    }
    const best = new Float64Array(n).fill(INF);
    let targetBest = INF;
    const results: { round: number; egress: number }[] = [];

    let marked: number[] = [];
    for (const a of access) {
      const t = t0 + a.seconds;
      if (t < tau[0]![a.stop]!) {
        if (tau[0]![a.stop] === INF) marked.push(a.stop);
        tau[0]![a.stop] = t;
        best[a.stop] = t;
        kind[0]![a.stop] = ACCESS;
        la[0]![a.stop] = a.distance;
        lb[0]![a.stop] = a.seconds;
      }
    }

    const isMarked = new Uint8Array(n);
    for (let k = 1; k <= K && marked.length > 0; k++) {
      const prevTau = tau[k - 1]!;
      const prevKind = kind[k - 1]!;
      const curTau = tau[k]!;

      // Patterns to scan, each from its earliest marked stop.
      const queue = new Map<number, number>();
      for (const s of marked) {
        for (const { pattern, pos } of net.stopPatterns[s]!) {
          const cur = queue.get(pattern);
          if (cur === undefined || pos < cur) queue.set(pattern, pos);
        }
      }

      isMarked.fill(0);
      const newMarked: number[] = [];
      const mark = (s: number) => {
        if (!isMarked[s]) {
          isMarked[s] = 1;
          newMarked.push(s);
        }
      };

      for (const [p, startPos] of queue) {
        const dp = day.patterns[p]!;
        if (dp.start.length === 0) continue;
        const stops = net.patterns[p]!.stops;
        const last = stops.length - 1;
        let trip = -1;
        let boardPos = -1;
        for (let i = startPos; i <= last; i++) {
          const s = stops[i]!;
          if (trip >= 0) {
            const arr = net.arrivalAt(p, dp, trip, i);
            if (arr < best[s]! && arr < targetBest) {
              curTau[s] = arr;
              best[s] = arr;
              kind[k]![s] = RIDE;
              la[k]![s] = p;
              lb[k]![s] = trip;
              lc[k]![s] = boardPos;
              ld[k]![s] = i;
              mark(s);
            }
          }
          if (i === last) break;
          const prev = prevTau[s]!;
          if (prev === INF) continue;
          const slack =
            prevKind[s] === RIDE
              ? opts.minTransferTime
              : prevKind[s] === WALK
                ? opts.walkTransferSlack
                : 0;
          const ready = prev + slack;
          if (trip < 0 || ready <= net.departureAt(p, dp, trip, i)) {
            const et = net.earliestTrip(p, dp, i, ready, trip < 0 ? dp.start.length : trip + 1);
            if (et >= 0 && (trip < 0 || et < trip)) {
              trip = et;
              boardPos = i;
            }
          }
        }
      }

      // Transfers on foot, only from stops reached by a vehicle this round.
      const rideStops = newMarked.slice();
      const rideTimes = rideStops.map((s) => curTau[s]!);
      rideStops.forEach((s, idx) => {
        for (const fp of net.footpaths[s]!) {
          const seconds = Math.round(fp.seconds * scale);
          const t = rideTimes[idx]! + seconds;
          if (t < best[fp.to]! && t < targetBest) {
            curTau[fp.to] = t;
            best[fp.to] = t;
            kind[k]![fp.to] = WALK;
            la[k]![fp.to] = s;
            lb[k]![fp.to] = seconds;
            mark(fp.to);
          }
        }
      });

      // Destination check.
      let roundBest = INF;
      let roundEgress = -1;
      for (const [stop, e] of egress) {
        const t = curTau[stop]!;
        if (t === INF) continue;
        const cand = t + e.seconds;
        if (cand < roundBest) {
          roundBest = cand;
          roundEgress = stop;
        }
      }
      if (roundBest < targetBest) {
        targetBest = roundBest;
        results.push({ round: k, egress: roundEgress });
      }
      marked = newMarked;
    }

    return results.map(({ round, egress: e }) =>
      this.reconstruct(day, request, round, e, egress.get(e)!, { tau, kind, la, lb, lc, ld }, opts),
    );
  }

  private reconstruct(
    day: DayTimetable,
    request: PlanRequest,
    round: number,
    egressStop: number,
    egress: Access,
    labels: {
      tau: Float64Array[];
      kind: Uint8Array[];
      la: Int32Array[];
      lb: Int32Array[];
      lc: Int32Array[];
      ld: Int32Array[];
    },
    opts: PlanOptions,
  ): Itinerary {
    const net = this.net;
    type Step =
      | { type: 'ride'; pattern: number; trip: number; board: number; alight: number }
      | { type: 'walk'; from: number; to: number; seconds: number };
    const steps: Step[] = [];
    let s = egressStop;
    let r = round;
    let accessSeconds = 0;
    let accessDistance = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const k = labels.kind[r]![s]!;
      if (k === ACCESS) {
        accessSeconds = labels.lb[r]![s]!;
        accessDistance = labels.la[r]![s]!;
        break;
      }
      if (k === WALK) {
        const from = labels.la[r]![s]!;
        steps.unshift({ type: 'walk', from, to: s, seconds: labels.lb[r]![s]! });
        s = from;
      } else if (k === RIDE) {
        const pattern = labels.la[r]![s]!;
        const board = labels.lc[r]![s]!;
        steps.unshift({
          type: 'ride',
          pattern,
          trip: labels.lb[r]![s]!,
          board,
          alight: labels.ld[r]![s]!,
        });
        s = net.patterns[pattern]!.stops[board]!;
        r--;
      } else {
        throw new Error('Broken RAPTOR label chain');
      }
    }

    const stopRef = (i: number): PlaceRef => {
      const st = net.stops[i]!;
      return { name: st.name, lat: st.lat, lon: st.lon, stop: i };
    };
    const fromRef: PlaceRef = {
      name: request.from.name ?? '',
      lat: request.from.lat,
      lon: request.from.lon,
    };
    const toRef: PlaceRef = {
      name: request.to.name ?? '',
      lat: request.to.lat,
      lon: request.to.lon,
    };

    const legs: Leg[] = [];
    const firstRide = steps.find((x) => x.type === 'ride') as Extract<Step, { type: 'ride' }>;
    const firstStop = net.patterns[firstRide.pattern]!.stops[firstRide.board]!;
    const firstDep = net.departureAt(
      firstRide.pattern,
      day.patterns[firstRide.pattern]!,
      firstRide.trip,
      firstRide.board,
    );

    // Footpaths only follow rides, so the journey starts with (at most) the
    // access walk, timed to reach the first stop just as the bus leaves.
    let clock = firstDep - accessSeconds;
    const depart = clock;

    if (accessDistance > 0) {
      legs.push({
        kind: 'walk',
        from: fromRef,
        to: stopRef(firstStop),
        start: clock,
        end: clock + accessSeconds,
        distance: accessDistance,
      });
    }
    clock += accessSeconds;

    let prevRideEnd: number | undefined;
    for (const step of steps) {
      if (step.type === 'walk') {
        const distance = Math.round(haversine(net.stops[step.from]!, net.stops[step.to]!));
        const last = legs[legs.length - 1];
        if (last?.kind === 'walk') {
          last.to = stopRef(step.to);
          last.end = clock + step.seconds;
          last.distance += distance;
        } else {
          legs.push({
            kind: 'walk',
            from: stopRef(step.from),
            to: stopRef(step.to),
            start: clock,
            end: clock + step.seconds,
            distance,
          });
        }
        clock += step.seconds;
        continue;
      }
      const dp = day.patterns[step.pattern]!;
      const p = net.patterns[step.pattern]!;
      const start = net.departureAt(step.pattern, dp, step.trip, step.board);
      const end = net.arrivalAt(step.pattern, dp, step.trip, step.alight);
      const rideStops: RideStop[] = [];
      for (let i = step.board; i <= step.alight; i++) {
        rideStops.push({
          stop: p.stops[i]!,
          arr: net.arrivalAt(step.pattern, dp, step.trip, i),
          dep: net.departureAt(step.pattern, dp, step.trip, i),
        });
      }
      const wait = Math.max(0, start - clock);
      const leg: RideLeg = {
        kind: 'ride',
        pattern: step.pattern,
        route: p.route,
        dayTrip: step.trip,
        tripId: p.trips[dp.trip[step.trip]!]![3],
        headsign: p.headsign,
        from: stopRef(p.stops[step.board]!),
        to: stopRef(p.stops[step.alight]!),
        boardPos: step.board,
        alightPos: step.alight,
        start,
        end,
        stops: rideStops,
        wait,
      };
      if (step.trip + 1 < dp.start.length) {
        leg.nextDeparture = net.departureAt(step.pattern, dp, step.trip + 1, step.board);
      }
      if (prevRideEnd !== undefined) {
        const buffer = start - clock;
        const gap = leg.nextDeparture === undefined ? Infinity : leg.nextDeparture - start;
        leg.risky = buffer < Math.max(180, opts.minTransferTime + 60) && gap > 30 * 60;
      }
      legs.push(leg);
      clock = end;
      prevRideEnd = end;
    }

    if (egress.distance > 0) {
      const last = legs[legs.length - 1];
      if (last?.kind === 'walk') {
        last.to = toRef;
        last.end = clock + egress.seconds;
        last.distance += egress.distance;
      } else {
        legs.push({
          kind: 'walk',
          from: stopRef(egressStop),
          to: toRef,
          start: clock,
          end: clock + egress.seconds,
          distance: egress.distance,
        });
      }
    }
    clock += egress.seconds;

    const rides = legs.filter((l): l is RideLeg => l.kind === 'ride');
    const fareRides: FareRide[] = rides.map((l) => ({
      aerobus: Boolean(net.routes[l.route]!.aerobus),
      fromMunicipality: net.stops[l.from.stop!]!.muni,
      toMunicipality: net.stops[l.to.stop!]!.muni,
    }));
    return {
      key: rides.map((l) => `${l.tripId}:${l.boardPos}-${l.alightPos}`).join('|'),
      legs,
      depart,
      arrive: clock,
      duration: clock - depart,
      rides: rides.length,
      transfers: Math.max(0, rides.length - 1),
      walkDistance: legs.reduce((acc, l) => acc + (l.kind === 'walk' ? l.distance : 0), 0),
      waitTime: rides.slice(1).reduce((acc, l) => acc + l.wait, 0),
      fare: quoteFare(fareRides, net.bundle.fares),
      risky: rides.some((l) => l.risky),
    };
  }

  private directWalk(request: PlanRequest, opts: PlanOptions): Itinerary | undefined {
    const straight = haversine(request.from, request.to);
    if (straight > opts.maxAccessWalk * 1.5) return undefined;
    const route = this.walk?.route(request.from, request.to);
    if (route && route.length > opts.maxAccessWalk * 1.5 * STREET_ALLOWANCE) return undefined;
    const distance = route ? route.length : straight * 1.25;
    const seconds = route
      ? Math.round(route.cost / opts.walkSpeed)
      : walkSeconds(straight, opts.walkSpeed);
    const from: PlaceRef = {
      name: request.from.name ?? '',
      lat: request.from.lat,
      lon: request.from.lon,
    };
    const to: PlaceRef = { name: request.to.name ?? '', lat: request.to.lat, lon: request.to.lon };
    return {
      key: 'walk',
      legs: [
        {
          kind: 'walk',
          from,
          to,
          start: request.time,
          end: request.time + seconds,
          distance: Math.round(distance),
          ...(route ? { path: route.path } : {}),
        },
      ],
      depart: request.time,
      arrive: request.time + seconds,
      duration: seconds,
      rides: 0,
      transfers: 0,
      walkDistance: Math.round(distance),
      waitTime: 0,
      fare: quoteFare([], this.net.bundle.fares),
      risky: false,
    };
  }
}

/** Drops options that leave earlier, arrive later and need more rides than another. */
export function paretoFilter(items: Itinerary[], transferPenalty = 0): Itinerary[] {
  const transfers = (it: Itinerary) => Math.max(0, it.rides - 1);
  const pareto = items.filter(
    (a) =>
      !items.some(
        (b) =>
          b !== a &&
          b.depart >= a.depart &&
          b.arrive <= a.arrive &&
          b.rides <= a.rides &&
          (b.depart > a.depart || b.arrive < a.arrive || b.rides < a.rides),
      ),
  );
  if (transferPenalty <= 0) return pareto;
  // A change of bus is a real cost: it must save enough time to be offered.
  return pareto.filter(
    (a) =>
      !pareto.some(
        (b) =>
          transfers(b) < transfers(a) &&
          b.depart >= a.depart &&
          b.arrive <= a.arrive + transferPenalty * (transfers(a) - transfers(b)),
      ),
  );
}
