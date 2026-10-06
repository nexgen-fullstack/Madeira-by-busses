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
  /** What each change of bus adds to an option's cost when the options are ranked (s). */
  transferCost: number;
  /**
   * How many ways on other lines to offer besides the best one, as a maps app
   * does ("by the 702, or by the 701 and the 704").
   */
  alternatives: number;
  /**
   * A longer walk to the first or from the last stop (m along the streets),
   * offered when it makes a better trip than the buses closer by: the express
   * to Ribeira Brava and half an hour on foot rather than three buses.
   */
  longWalk: number;
  /** What a euro of fare is worth in seconds when the options are ranked. */
  fareWeight: number;
  /** Each second on foot counts this much extra when ranking (walking is more tiring). */
  walkReluctance: number;
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
  transferCost: 600,
  alternatives: 2,
  longWalk: 3000,
  fareWeight: 240,
  walkReluctance: 0.5,
};

/** What the best option should be best at, as in a maps app's route options. */
export type RoutePreference = 'best' | 'fewerTransfers' | 'lessWalking';

/** The ranking each preference asks for, on top of the defaults. */
export const ROUTE_PREFERENCES: Record<RoutePreference, Partial<PlanOptions>> = {
  best: {},
  // Half an hour for each change of bus, and a long walk is no way round one.
  fewerTransfers: { transferCost: 30 * 60, walkReluctance: 1 },
  // Each minute on foot counts four, and no long walks to buses farther off.
  lessWalking: { walkReluctance: 3, longWalk: 0 },
};

export interface PlanRequest {
  from: Place;
  to: Place;
  /** ISO date in Madeira local time. */
  date: string;
  /** Seconds after midnight. */
  time: number;
  /** `time` is when to be there by, not when to leave. */
  arriveBy?: boolean;
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
  /** For each step of `path`, how far the pavement is from the road's middle (m; 0 off the roads). */
  kerb?: number[];
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
  /** A way on other lines than the best one's, offered besides it. */
  alternative?: boolean;
  /** The best option's buses with a bus instead of its long walk to or from them. */
  lessWalking?: boolean;
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
/** A wait for the next bus long enough to look for a later first bus (s). */
const LONG_WAIT = 15 * 60;
/** How much sooner a trip with a long walk must get there to be offered besides the best (s). */
const SOONER = 5 * 60;
/** Walking all the way is always offered up to this far along the streets (m)… */
const WALK_ALWAYS = 2000;
/** …and up to this far when no bus gets there sooner (m). */
const WALK_FAR = 8000;
/** A walk to or from the buses long enough to look for a bus instead (s). */
const LONG_ACCESS = 10 * 60;
/** A walk to or from the buses short enough not to look further (s). */
const SHORT_ACCESS = 6 * 60;
/** How much less on foot a way with another bus must ask for to be offered (s). */
const LESS_WALK = 5 * 60;
/** Stops this far apart (m, as the crow flies) may be a change of bus on foot. */
const TRANSFER_LOOK = 600;
/**
 * A change of bus is made at a big stop rather than a small one when it costs
 * no more than this much more walking (m) and leaves at least as much time to
 * change (or HUB_BUFFER): with many lines, a bus that breaks down or runs late
 * is easily replaced by another.
 */
const HUB_WALK = 30;
const HUB_BUFFER = 5 * 60;
/** The bays of one station: stops this close (m) count their lines together. */
const HUB_RADIUS = 100;
/**
 * A stop is the bigger place to change with this many times the lines of the
 * other and at least HUB_MARGIN more (a bus station counts STATION_LINES more):
 * Ribeira Brava's bus station over Boa Morte on the hill above, but not one
 * street of central Funchal over the next.
 */
const HUB_RATIO = 1.5;
const HUB_MARGIN = 10;
/** A bus station or terminal counts as this many lines more than its bays' own. */
const STATION_LINES = 30;
const STATION = /\b(esta[cç][aã]o|terminal|central|rodovi[aá]ria)\b/i;

export class Planner {
  private walk?: WalkGraph;
  private stopHits?: (WalkHit | undefined)[];
  private hubs?: (number | undefined)[];

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

  /**
   * Options to get there, the best one first and the others by arrival. The
   * best is the one that costs least in all: arrival, time on the way,
   * changes of bus, fare and walking (see `itineraryCost`), not merely the
   * one that arrives first.
   */
  plan(request: PlanRequest): Itinerary[] {
    if (request.arriveBy) return this.planArriveBy(request);
    const ctx = this.context(request);
    const results = [...this.collect(request, ctx.opts, ctx.searchAt, 12).values()];
    results.push(...this.longWalks(request, ctx, results));
    // Walking all the way: when it is short, when no bus gets there sooner, or when none goes.
    const direct = this.directWalk(request, ctx.opts, WALK_FAR);
    const firstBus = Math.min(...results.map((it) => it.arrive));
    if (direct && (direct.walkDistance <= WALK_ALWAYS || direct.arrive <= firstBus)) {
      results.push(direct);
    }
    const pareto = paretoFilter(results, ctx.opts.transferPenalty);
    const top = bestOf(pareto, ctx.opts);
    const main = top
      ? [top, ...pareto.filter((it) => it !== top).sort(byArrival)].slice(0, ctx.opts.maxResults)
      : [];
    main.push(...this.lessWalking(request, ctx, main));
    const alternatives = this.alternatives(request, ctx, main);
    let best = main[0];
    let others = [...main.slice(1), ...alternatives];
    // A way on other lines may be better still (the bus a minute after the dearer Aerobus):
    // then it is the best, and the one found first is the way on other lines.
    const better = best && bestOf([best, ...alternatives], ctx.opts);
    if (best && better && better !== best) {
      others = [...others.filter((it) => it !== better), { ...best, alternative: true }];
      best = { ...better };
      delete best.alternative;
    }
    const seen = new Set<string>();
    return [...(best ? [best] : []), ...others.sort(byArrival)]
      .map((it) => this.refine(it, request, ctx.opts))
      .filter((it) => !seen.has(it.key) && Boolean(seen.add(it.key)))
      .map((it) => this.withPaths(it));
  }

  /**
   * Options leaving from `request.time` on, a minute after the earliest one
   * found each time; then, for the options with a long wait for the next bus,
   * the latest departure that still makes it.
   */
  private collect(
    request: PlanRequest,
    opts: PlanOptions,
    searchAt: (t: number) => Itinerary[],
    iterations: number,
  ): Map<string, Itinerary> {
    const found = new Map<string, Itinerary>();
    let t = request.time;
    for (let iter = 0; iter < iterations && t <= request.time + opts.window; iter++) {
      const batch = searchAt(t);
      if (batch.length === 0) break;
      for (const it of batch) if (!found.has(it.key)) found.set(it.key, it);
      if (found.size >= opts.maxResults * 3) break;
      // Next iteration: leave a minute after the earliest option found.
      t = Math.min(...batch.map((it) => it.depart)) + 60;
    }
    this.leaveLater(found, searchAt);
    return found;
  }

  /**
   * An option that waits long for its next bus usually has a later first
   * bus that makes the same connection: rather than leave now and wait two
   * hours at the change, leave later. Leaving earlier never hurts, so the
   * latest departure is found by halving the wait (a few RAPTOR runs).
   */
  private leaveLater(found: Map<string, Itinerary>, searchAt: (t: number) => Itinerary[]): void {
    const waiting = [...found.values()]
      .filter((it) => it.rides > 1 && it.waitTime > LONG_WAIT)
      // By the usual ranking, so the same ways are found whatever the route preference.
      .sort((a, b) => itineraryCost(a) - itineraryCost(b))
      .slice(0, 3);
    for (const it of waiting) {
      const makes = (t: number) =>
        searchAt(t).filter((x) => x.arrive <= it.arrive && x.rides <= it.rides);
      let lo = it.depart;
      let hi = it.depart + it.waitTime + 60;
      let later: Itinerary[] = [];
      while (hi - lo > 60) {
        const mid = Math.floor((lo + hi) / 2);
        const at = makes(mid);
        if (at.length > 0) {
          lo = mid;
          later = at;
        } else {
          hi = mid;
        }
      }
      for (const x of later) if (!found.has(x.key)) found.set(x.key, x);
    }
  }

  /**
   * Trips with a longer walk to the first or from the last stop, when one
   * makes a better trip than every option with the usual short walks (or
   * when those find nothing): the bus to the next town and half an hour on
   * foot, where the buses closer by take far longer.
   */
  private longWalks(
    request: PlanRequest,
    ctx: ReturnType<Planner['context']>,
    found: readonly Itinerary[],
  ): Itinerary[] {
    const { opts } = ctx;
    if (opts.longWalk <= opts.maxAccessWalk * STREET_ALLOWANCE) return [];
    const access = this.longAccess(request.from, opts, ctx.access);
    const egress = this.longAccess(request.to, opts, [...ctx.egress.values()]);
    if (!access && !egress) return [];
    const day = this.net.timetable(request.date);
    const egressMap = egress ? new Map(egress.map((e) => [e.stop, e])) : ctx.egress;
    const far = this.collect(
      request,
      opts,
      (t) => this.search(day, request, access ?? ctx.access, egressMap, t, opts),
      6,
    );
    const known = new Set(found.map((it) => it.key));
    const byBus = found.filter((it) => it.rides > 0);
    const bar = Math.min(...byBus.map((it) => itineraryCost(it, opts)));
    const best = byBus.find((it) => itineraryCost(it, opts) === bar);
    // Better in all, or there sooner for those who do not mind the walk.
    return [...far.values()].filter(
      (it) =>
        it.rides > 0 &&
        !known.has(it.key) &&
        (itineraryCost(it, opts) < bar || !best || it.arrive <= best.arrive - SOONER),
    );
  }

  /**
   * The stops within a long walk of a place (with the usual ones), or
   * undefined when there are no more of them than within the usual walk.
   */
  private longAccess(
    place: Place,
    opts: PlanOptions,
    usual: readonly Access[],
  ): Access[] | undefined {
    // A stop chosen with no other stops around it: that stop and no other.
    if (place.stops && place.stops.length > 0 && opts.stopWalk <= 0) return undefined;
    const walked =
      this.walkAccess(place, opts, opts.longWalk) ??
      this.net.nearbyStops(place, opts.longWalk / STREET_ALLOWANCE).map((h) => ({
        stop: h.stop,
        distance: Math.round(h.distance),
        seconds: walkSeconds(h.distance, opts.walkSpeed),
      }));
    const best = new Map<number, Access>(walked.map((a) => [a.stop, a]));
    for (const a of usual) {
      const known = best.get(a.stop);
      if (!known || a.seconds < known.seconds) best.set(a.stop, a);
    }
    return best.size > usual.length ? [...best.values()] : undefined;
  }

  /**
   * Options that get there by `request.time`, leaving as late as possible.
   * Whether a departure still makes it only changes once in a day (leaving
   * earlier never hurts), so a binary search finds the latest one in ~8 RAPTOR
   * runs; the options are then planned from an hour and a half before it.
   */
  private planArriveBy(request: PlanRequest): Itinerary[] {
    const ctx = this.context(request);
    const by = request.time;
    const inTime = (t: number) => ctx.searchAt(t).some((it) => it.arrive <= by);
    let lo = Math.max(0, by - ctx.opts.window);
    let hi = by;
    if (inTime(lo)) {
      while (hi - lo > 60) {
        const mid = Math.floor((lo + hi) / 2);
        if (inTime(mid)) lo = mid;
        else hi = mid;
      }
    }
    const options = this.plan({ ...request, arriveBy: false, time: Math.max(0, lo - 90 * 60) });
    const made = options
      .map((it) => (it.rides === 0 ? shiftWalk(it, by - it.arrive) : it))
      .filter((it) => it.arrive <= by);
    // The best first ("when must I go at the latest?", with as few changes and as little
    // fare and walking as may be), then the others leaving last first.
    const best = bestOf(made, ctx.opts, true);
    const rest = made
      .filter((it) => it !== best)
      .sort((a, b) => b.depart - a.depart || a.arrive - b.arrive || a.rides - b.rides);
    return (best ? [best, ...rest] : rest).slice(0, ctx.opts.maxResults);
  }

  /**
   * The best option without its long walk to the first or from the last bus: another bus
   * to where it is boarded (or on from where it is left), for those who would rather ride
   * than walk twenty-five minutes downhill to the 207.
   */
  private lessWalking(
    request: PlanRequest,
    ctx: ReturnType<Planner['context']>,
    main: readonly Itinerary[],
  ): Itinerary[] {
    const best = main.find((it) => it.rides > 0);
    if (!best) return [];
    const first = best.legs[0];
    const last = best.legs[best.legs.length - 1];
    const long = (l: Leg | undefined) => l?.kind === 'walk' && l.end - l.start > LONG_ACCESS;
    const longStart = long(first);
    const longEnd = best.legs.length > 1 && long(last);
    if (!longStart && !longEnd) return [];
    // The stops a short walk away (or, with none, the nearest ones).
    const near = (all: readonly Access[]) => {
      const nearest = Math.min(...all.map((a) => a.seconds));
      const limit = Math.max(SHORT_ACCESS, nearest + 3 * 60);
      return all.filter((a) => a.seconds <= limit);
    };
    const access = longStart ? near(ctx.access) : ctx.access;
    const egress = longEnd
      ? new Map(near([...ctx.egress.values()]).map((e) => [e.stop, e]))
      : ctx.egress;
    if (access.length === 0 || egress.size === 0) return [];
    const day = this.net.timetable(request.date);
    const found = this.collect(
      request,
      ctx.opts,
      (t) => this.search(day, request, access, egress, t, ctx.opts),
      6,
    );
    const keys = new Set(main.map((it) => it.key));
    const options = [...found.values()].filter(
      (it) =>
        it.rides > 0 &&
        !keys.has(it.key) &&
        walkTime(it) <= walkTime(best) - LESS_WALK &&
        it.arrive <= best.arrive + Math.max(45 * 60, best.duration * 0.5),
    );
    const pick = bestOf(options, ctx.opts);
    return pick ? [{ ...pick, lessWalking: true }] : [];
  }

  /**
   * Ways on other lines: the best option with the lines of the best one (and
   * of each alternative found) left out, while it arrives not much later.
   */
  private alternatives(
    request: PlanRequest,
    ctx: ReturnType<Planner['context']>,
    main: readonly Itinerary[],
  ): Itinerary[] {
    // `main` starts with the best option.
    const best = main.find((it) => it.rides > 0);
    if (!best) return [];
    // The lines an option rides, in order: another departure of the same buses is no other way.
    const lines = (it: Itinerary) =>
      it.legs.flatMap((l) => (l.kind === 'ride' ? [l.route] : [])).join('>');
    const keys = new Set(main.map((it) => it.key));
    const ways = new Set(main.map(lines));
    const banned = new Set<number>();
    const out: Itinerary[] = [];
    // Later than this, a bus on another line is no real choice.
    const latest = best.arrive + Math.max(45 * 60, best.duration * 0.75);
    let current = best;
    for (let n = 0; n < ctx.opts.alternatives; n++) {
      for (const leg of current.legs) if (leg.kind === 'ride') banned.add(leg.route);
      const options = ctx
        .searchAt(request.time, banned)
        .filter(
          (it) => it.rides > 0 && !keys.has(it.key) && !ways.has(lines(it)) && it.arrive <= latest,
        );
      // A change of bus counts for ten minutes, as when the main options are sorted out.
      const pick = options.sort(
        (a, b) =>
          a.arrive +
            a.transfers * ctx.opts.transferCost -
            (b.arrive + b.transfers * ctx.opts.transferCost) || b.depart - a.depart,
      )[0];
      if (!pick) break;
      keys.add(pick.key);
      ways.add(lines(pick));
      out.push({ ...pick, alternative: true });
      current = pick;
    }
    return out;
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
      return { ...leg, path: route.path, kerb: route.kerb, distance: Math.round(route.length) };
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
    return last && this.withPaths(this.refine(last, request, ctx.opts));
  }

  private context(request: PlanRequest) {
    const opts = { ...DEFAULT_PLAN_OPTIONS, ...request.options };
    const day = this.net.timetable(request.date);
    const access = this.access(request.from, opts);
    const egress = new Map(this.access(request.to, opts).map((e) => [e.stop, e]));
    return {
      opts,
      access,
      egress,
      /** RAPTOR from time t; the lines in `banned` are left out. */
      searchAt: (t: number, banned?: ReadonlySet<number>) =>
        this.search(day, request, access, egress, t, opts, banned),
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

  /** The stops around a point and the walk to each along the streets (up to `max` m). */
  private walkAccess(
    place: LatLon,
    opts: PlanOptions,
    max = opts.maxAccessWalk * STREET_ALLOWANCE,
  ): Access[] | undefined {
    const walk = this.walk;
    if (!walk) return undefined;
    const start = walk.snap(place, 400);
    if (!start) return undefined;
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
    banned?: ReadonlySet<number>,
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
          if (banned?.has(net.patterns[pattern]!.route)) continue;
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

    const stopRef = (i: number) => this.stopRef(i);
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
      const leg = this.ride(day, step.pattern, step.trip, step.board, step.alight, clock);
      if (prevRideEnd !== undefined) leg.risky = isRisky(leg, clock, opts);
      legs.push(leg);
      clock = leg.end;
      prevRideEnd = leg.end;
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

    return this.summary(legs, depart, clock);
  }

  private stopRef(i: number): PlaceRef {
    const st = this.net.stops[i]!;
    return { name: st.name, lat: st.lat, lon: st.lon, stop: i };
  }

  /** A ride on day trip `trip` of a pattern from one of its stops to a later one. */
  private ride(
    day: DayTimetable,
    pattern: number,
    trip: number,
    board: number,
    alight: number,
    ready: number,
  ): RideLeg {
    const net = this.net;
    const dp = day.patterns[pattern]!;
    const p = net.patterns[pattern]!;
    const start = net.departureAt(pattern, dp, trip, board);
    const stops: RideStop[] = [];
    for (let i = board; i <= alight; i++) {
      stops.push({
        stop: p.stops[i]!,
        arr: net.arrivalAt(pattern, dp, trip, i),
        dep: net.departureAt(pattern, dp, trip, i),
      });
    }
    const leg: RideLeg = {
      kind: 'ride',
      pattern,
      route: p.route,
      dayTrip: trip,
      tripId: p.trips[dp.trip[trip]!]![3],
      headsign: p.headsign,
      from: this.stopRef(p.stops[board]!),
      to: this.stopRef(p.stops[alight]!),
      boardPos: board,
      alightPos: alight,
      start,
      end: net.arrivalAt(pattern, dp, trip, alight),
      stops,
      wait: Math.max(0, start - ready),
    };
    if (trip + 1 < dp.start.length) {
      leg.nextDeparture = net.departureAt(pattern, dp, trip + 1, board);
    }
    return leg;
  }

  /** An itinerary of these legs, leaving at `depart` and there at `arrive`. */
  private summary(legs: Leg[], depart: number, arrive: number): Itinerary {
    const net = this.net;
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
      arrive,
      duration: arrive - depart,
      rides: rides.length,
      transfers: Math.max(0, rides.length - 1),
      walkDistance: legs.reduce((acc, l) => acc + (l.kind === 'walk' ? l.distance : 0), 0),
      waitTime: rides.slice(1).reduce((acc, l) => acc + l.wait, 0),
      fare: quoteFare(fareRides, net.bundle.fares),
      risky: rides.some((l) => l.risky),
    };
  }

  /** Walking between two stops (undefined when further than `max` m along the streets). */
  private stopWalk(
    from: number,
    to: readonly number[],
    opts: PlanOptions,
    max: number,
  ): ({ distance: number; seconds: number } | undefined)[] {
    const a = this.net.stops[from]!;
    const walk = this.walk;
    if (!walk) {
      return to.map((t) => {
        if (t === from) return { distance: 0, seconds: 0 };
        const d = haversine(a, this.net.stops[t]!);
        return d * 1.25 > max
          ? undefined
          : { distance: Math.round(d), seconds: walkSeconds(d, opts.walkSpeed) };
      });
    }
    const hits = this.hits();
    const start = hits[from];
    const found = start
      ? walk.distances(
          start,
          to.map((t) => hits[t] ?? start),
          max,
        )
      : [];
    return to.map((t, i) => {
      if (t === from) return { distance: 0, seconds: 0 };
      const d = hits[t] ? found[i] : undefined;
      return d
        ? { distance: Math.round(d.length), seconds: Math.round(d.cost / opts.walkSpeed) }
        : undefined;
    });
  }

  /** Walking between a place and each of some stops (either way; undefined beyond `max` m). */
  private placeWalk(
    place: LatLon,
    to: readonly number[],
    opts: PlanOptions,
    max: number,
  ): ({ distance: number; seconds: number } | undefined)[] {
    const walk = this.walk;
    const start = walk?.snap(place, 400);
    if (!walk || !start) {
      return to.map((t) => {
        const d = haversine(place, this.net.stops[t]!);
        return d * 1.25 > max
          ? undefined
          : { distance: Math.round(d), seconds: walkSeconds(d, opts.walkSpeed) };
      });
    }
    const hits = this.hits();
    const found = walk.distances(
      start,
      to.map((t) => hits[t] ?? start),
      max,
    );
    return to.map((t, i) => {
      const d = hits[t] ? found[i] : undefined;
      return d
        ? { distance: Math.round(d.length), seconds: Math.round(d.cost / opts.walkSpeed) }
        : undefined;
    });
  }

  /**
   * More bus and less walking where it costs no time: of the stops of the same
   * trip, a bus is left where the walk to the next one (or to the destination)
   * is shortest, and boarded where the walk to it is, as long as the next bus
   * is still caught, the destination reached no later and the first bus not
   * left for earlier. The 207 goes on to Ribeira Brava's bus station, where
   * the 222 leaves: stay on it rather than walk there from the hill above.
   * Only the trips' own stops, as their timetables give them.
   */
  private refine(it: Itinerary, request: PlanRequest, opts: PlanOptions): Itinerary {
    if (it.rides === 0) return it;
    const net = this.net;
    const day = net.timetable(request.date);
    const legs = it.legs.slice();
    let changed = false;
    const rideAt = (i: number) => (legs[i]?.kind === 'ride' ? (legs[i] as RideLeg) : undefined);
    // Each change is made on its own, and kept only if the way is then no dearer and no later.
    const tryChange = (start: number, remove: number, ...add: Leg[]) => {
      const tried = legs.slice();
      tried.splice(start, remove, ...add);
      const s = this.summary(tried, tried[0]!.start, tried[tried.length - 1]!.end);
      const dearer =
        (s.fare.cash ?? 0) > (it.fare.cash ?? 0) ||
        (s.fare.knownGiro ?? 0) > (it.fare.knownGiro ?? 0);
      if (dearer || s.arrive > it.arrive) return;
      legs.splice(0, legs.length, ...tried);
      changed = true;
    };
    for (let i = 0; i < legs.length; i++) {
      const leg = rideAt(i);
      if (!leg) continue;
      const walkAfter = legs[i + 1]?.kind === 'walk' ? (legs[i + 1] as WalkLeg) : undefined;
      const nextIndex = walkAfter ? i + 2 : i + 1;
      const next = rideAt(nextIndex);
      const p = net.patterns[leg.pattern]!;
      const dp = day.patterns[leg.pattern]!;
      const arrAt = (pos: number) => net.arrivalAt(leg.pattern, dp, leg.dayTrip, pos);
      const later = (from: number) => {
        const out: number[] = [];
        for (let pos = leg.boardPos + 1; pos < p.stops.length; pos++) out.push(pos);
        return out.filter((pos) => pos !== from);
      };
      if (next) {
        // On to the next bus (the same trip of it, so no later): where this one is left and
        // that one boarded, a much bigger stop at no cost, else the shortest walk.
        const np = net.patterns[next.pattern]!;
        const ndp = day.patterns[next.pattern]!;
        const boards: number[] = [];
        for (let pos = 0; pos < next.alightPos; pos++) boards.push(pos);
        // The walk the search found, measured along the streets like the others.
        const [found] = this.stopWalk(
          p.stops[leg.alightPos]!,
          [np.stops[next.boardPos]!],
          opts,
          TRANSFER_LOOK * 1.5,
        );
        const walked =
          found ??
          (walkAfter
            ? { distance: walkAfter.distance, seconds: walkAfter.end - walkAfter.start }
            : { distance: 0, seconds: 0 });
        const current: Change = {
          a: leg.alightPos,
          b: next.boardPos,
          walk: walked,
          hub: this.hub(np.stops[next.boardPos]!),
          station: STATION.test(net.stops[np.stops[next.boardPos]!]!.name),
          buffer: next.wait,
        };
        let best = current;
        for (const a of [leg.alightPos, ...later(leg.alightPos)]) {
          const s = p.stops[a]!;
          const near = boards.filter(
            (b) => haversine(net.stops[s]!, net.stops[np.stops[b]!]!) <= TRANSFER_LOOK,
          );
          if (near.length === 0) continue;
          const walks = this.stopWalk(
            s,
            near.map((b) => np.stops[b]!),
            opts,
            TRANSFER_LOOK * 1.5,
          );
          near.forEach((b, k) => {
            const w = walks[k];
            if (!w) return;
            const same = np.stops[b] === s;
            const slack = same ? opts.minTransferTime : opts.walkTransferSlack;
            if (
              arrAt(a) + w.seconds + slack >
              net.departureAt(next.pattern, ndp, next.dayTrip, b)
            ) {
              return;
            }
            if (b === current.b && a === current.a) return;
            const buffer =
              net.departureAt(next.pattern, ndp, next.dayTrip, b) - arrAt(a) - w.seconds;
            const station = STATION.test(net.stops[np.stops[b]!]!.name);
            const change = { a, b, walk: w, hub: this.hub(np.stops[b]!), station, buffer };
            if (betterChange(change, best)) best = change;
          });
        }
        if (best !== current) {
          const ride = this.ride(
            day,
            leg.pattern,
            leg.dayTrip,
            leg.boardPos,
            best.a,
            leg.start - leg.wait,
          );
          const onward = this.ride(
            day,
            next.pattern,
            next.dayTrip,
            best.b,
            next.alightPos,
            ride.end,
          );
          if (leg.risky !== undefined) ride.risky = leg.risky;
          const between: Leg[] =
            best.walk.distance === 0 && np.stops[best.b] === p.stops[best.a]
              ? []
              : [
                  {
                    kind: 'walk',
                    from: ride.to,
                    to: onward.from,
                    start: ride.end,
                    end: ride.end + best.walk.seconds,
                    distance: best.walk.distance,
                  },
                ];
          onward.wait = Math.max(0, onward.start - (ride.end + best.walk.seconds));
          onward.risky = isRisky(onward, ride.end + best.walk.seconds, opts);
          tryChange(i, nextIndex - i + 1, ride, ...between, onward);
        }
        continue;
      }
      if (!next && walkAfter && i + 2 === legs.length && !walkAfter.to.stop) {
        // The last bus: left where the walk to the destination is shortest, there no later.
        const options = [leg.alightPos, ...later(leg.alightPos)];
        const walks = this.placeWalk(
          walkAfter.to,
          options.map((a) => p.stops[a]!),
          opts,
          opts.maxAccessWalk * STREET_ALLOWANCE,
        );
        let best: { a: number; walk: { distance: number; seconds: number } } | undefined;
        options.forEach((a, k) => {
          const w = walks[k];
          if (!w || arrAt(a) + w.seconds > it.arrive) return;
          if (!best || w.distance < best.walk.distance) best = { a, walk: w };
        });
        if (best && best.walk.distance < walkAfter.distance) {
          const ride = this.ride(
            day,
            leg.pattern,
            leg.dayTrip,
            leg.boardPos,
            best.a,
            leg.start - leg.wait,
          );
          if (leg.risky !== undefined) ride.risky = leg.risky;
          tryChange(i, 2, ride, {
            kind: 'walk',
            from: ride.to,
            to: walkAfter.to,
            start: ride.end,
            end: ride.end + best.walk.seconds,
            distance: best.walk.distance,
          });
        }
      }
    }
    // The first bus: boarded where the walk to it is shortest, leaving home no earlier.
    const access = legs[0]?.kind === 'walk' ? (legs[0] as WalkLeg) : undefined;
    const first = rideAt(1);
    if (access && first && !access.from.stop && access.distance > 0) {
      const p = net.patterns[first.pattern]!;
      const dp = day.patterns[first.pattern]!;
      const options: number[] = [];
      for (let pos = 0; pos < first.alightPos; pos++) options.push(pos);
      const walks = this.placeWalk(
        access.from,
        options.map((b) => p.stops[b]!),
        opts,
        opts.maxAccessWalk * STREET_ALLOWANCE,
      );
      let best: { b: number; walk: { distance: number; seconds: number } } | undefined;
      options.forEach((b, k) => {
        const w = walks[k];
        if (!w) return;
        const leave = net.departureAt(first.pattern, dp, first.dayTrip, b) - w.seconds;
        if (leave < access.start) return;
        if (!best || w.distance < best.walk.distance) best = { b, walk: w };
      });
      if (best && best.walk.distance < access.distance) {
        const ride = this.ride(day, first.pattern, first.dayTrip, best.b, first.alightPos, 0);
        ride.wait = 0;
        tryChange(
          0,
          2,
          {
            kind: 'walk',
            from: access.from,
            to: ride.from,
            start: ride.start - best.walk.seconds,
            end: ride.start,
            distance: best.walk.distance,
          },
          ride,
        );
      }
    }
    if (!changed) return it;
    const refined = this.summary(legs, legs[0]!.start, legs[legs.length - 1]!.end);
    return {
      ...refined,
      ...(it.alternative ? { alternative: true } : {}),
      ...(it.lessWalking ? { lessWalking: true } : {}),
    };
  }

  /**
   * How good a stop is to change buses at: the lines leaving it and the stops
   * within HUB_RADIUS (one station's bays), and STATION_LINES more for a bus
   * station or terminal itself.
   */
  private hub(stop: number): number {
    const hubs = (this.hubs ??= []);
    const known = hubs[stop];
    if (known !== undefined) return known;
    const net = this.net;
    const lines = new Set<string>();
    const near = [stop, ...net.nearbyStops(net.stops[stop]!, HUB_RADIUS).map((h) => h.stop)];
    for (const s of near) {
      for (const { pattern } of net.stopPatterns[s] ?? []) {
        const route = net.routes[net.patterns[pattern]!.route]!;
        lines.add(route.short || route.id);
      }
    }
    const score = lines.size + (STATION.test(net.stops[stop]!.name) ? STATION_LINES : 0);
    hubs[stop] = score;
    return score;
  }

  /** Walking all the way, when it is no more than `max` metres along the streets. */
  private directWalk(request: PlanRequest, opts: PlanOptions, max: number): Itinerary | undefined {
    const straight = haversine(request.from, request.to);
    if (straight * 1.25 > max) return undefined;
    const route = this.walk?.route(request.from, request.to);
    if ((route ? route.length : straight * 1.25) > max) return undefined;
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
          ...(route ? { path: route.path, kerb: route.kerb } : {}),
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

/**
 * Where one bus is left (a) and the next boarded (b): the walk between, how big
 * a stop b is and the time to spare there.
 */
interface Change {
  a: number;
  b: number;
  walk: { distance: number; seconds: number };
  hub: number;
  /** b is a bus station or terminal itself. */
  station: boolean;
  buffer: number;
}

/**
 * x is the better place to change: much the bigger stop at no cost, otherwise
 * the shorter walk, and with the same walk the bus station itself rather than
 * the stop beside it.
 */
function betterChange(x: Change, y: Change): boolean {
  if (biggerAtNoCost(x, y)) return true;
  if (biggerAtNoCost(y, x)) return false;
  if (x.walk.distance !== y.walk.distance) return x.walk.distance < y.walk.distance;
  return x.station && !y.station && x.buffer >= Math.min(y.buffer, HUB_BUFFER);
}

/** x is much the bigger stop, with hardly more walking and no less time to change. */
const biggerAtNoCost = (x: Change, y: Change) =>
  x.hub >= y.hub * HUB_RATIO &&
  x.hub - y.hub >= HUB_MARGIN &&
  x.walk.distance <= y.walk.distance + HUB_WALK &&
  x.buffer >= Math.min(y.buffer, HUB_BUFFER);

/** A change of bus with a short buffer, the next bus long after: worth a warning. */
function isRisky(leg: RideLeg, ready: number, opts: PlanOptions): boolean {
  const buffer = leg.start - ready;
  const gap = leg.nextDeparture === undefined ? Infinity : leg.nextDeparture - leg.start;
  return buffer < Math.max(180, opts.minTransferTime + 60) && gap > 30 * 60;
}

/** A walk only, leaving `by` seconds later. */
function shiftWalk(it: Itinerary, by: number): Itinerary {
  return {
    ...it,
    depart: it.depart + by,
    arrive: it.arrive + by,
    legs: it.legs.map((l) => ({ ...l, start: l.start + by, end: l.end + by })),
  };
}

const byArrival = (a: Itinerary, b: Itinerary) => a.arrive - b.arrive || b.depart - a.depart;

/** A ride of unknown price (Aerobus), for ranking only (€). */
const UNKNOWN_FARE = 5;

/** The fare of an option for ranking: cash, or what is known of it and a guess for the rest. */
const fareOf = (it: Itinerary) =>
  it.fare?.cash ??
  (it.fare?.knownGiro ?? 0) +
    UNKNOWN_FARE * (it.fare?.rides.filter((r) => r.cash === null).length ?? 0);

/** Seconds on foot (the walks to, between and from the stops). */
const walkTime = (it: Itinerary) =>
  it.legs?.reduce((t, l) => t + (l.kind === 'walk' ? l.end - l.start : 0), 0) ?? 0;

/**
 * What an option costs a passenger, in seconds, to rank the options by: the
 * arrival (or, arriving by a time, how early one must leave), a tenth of the
 * time on the way, ten minutes for each change of bus, four minutes for each
 * euro and half again the time on foot. Of two options arriving at the same
 * time, the one with fewer changes, a lower fare and less walking wins;
 * waiting at home costs nothing.
 */
export function itineraryCost(
  it: Itinerary,
  opts: Pick<PlanOptions, 'transferCost' | 'fareWeight' | 'walkReluctance'> = DEFAULT_PLAN_OPTIONS,
  arriveBy = false,
): number {
  return (
    (arriveBy ? -it.depart : it.arrive) +
    0.1 * it.duration +
    opts.transferCost * it.transfers +
    opts.fareWeight * fareOf(it) +
    opts.walkReluctance * walkTime(it)
  );
}

/** How much later a much quicker way may get there and still be the best (s). */
const ABOUT_AS_SOON = 15 * 60;
/** How much less time on the way makes a way much quicker (s). */
const MUCH_QUICKER = 20 * 60;
/** A few more minutes on foot that a much quicker way may ask for (s). */
const LIGHT_WALK = 5 * 60;

/**
 * The option that costs least, preferring one by bus to walking all the way.
 * Leaving now, a much quicker way that gets there about as soon is the best
 * one: the express on the Via Rápida, half an hour later than the bus round
 * the coast and there a few minutes after it, rather than an hour more on
 * board — with no more changes, walking or fare.
 */
function bestOf(
  items: readonly Itinerary[],
  opts: PlanOptions,
  arriveBy = false,
): Itinerary | undefined {
  const ranked = [...items].sort(
    (a, b) =>
      itineraryCost(a, opts, arriveBy) - itineraryCost(b, opts, arriveBy) || a.arrive - b.arrive,
  );
  // A walk all the way may be the best when it is short and costs least; a long one
  // only when no bus goes.
  const best = ranked.find((it) => it.rides > 0 || it.duration <= SHORT_WALK) ?? ranked[0];
  if (!best || arriveBy || best.rides === 0) return best;
  const quicker = ranked.find(
    (it) =>
      it.rides > 0 &&
      it.rides <= best.rides &&
      it.arrive <= best.arrive + ABOUT_AS_SOON &&
      it.duration <= best.duration - MUCH_QUICKER &&
      walkTime(it) <= walkTime(best) + LIGHT_WALK &&
      fareOf(it) <= fareOf(best),
  );
  return quicker ?? best;
}

/** Walking all the way that may be the best way (s). */
const SHORT_WALK = 30 * 60;

/** How much farther one option may walk than another and still be as good (m). */
const WALK_SLACK = 300;

/**
 * Drops options that leave earlier, arrive later and need more rides than
 * another — unless they walk much less: a long walk is not for everyone.
 */
export function paretoFilter(items: Itinerary[], transferPenalty = 0): Itinerary[] {
  const transfers = (it: Itinerary) => Math.max(0, it.rides - 1);
  const walks = (it: Itinerary) => it.walkDistance ?? 0;
  const pareto = items.filter(
    (a) =>
      !items.some(
        (b) =>
          b !== a &&
          b.depart >= a.depart &&
          b.arrive <= a.arrive &&
          b.rides <= a.rides &&
          walks(b) <= walks(a) + WALK_SLACK &&
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
          walks(b) <= walks(a) + WALK_SLACK &&
          b.arrive <= a.arrive + transferPenalty * (transfers(a) - transfers(b)),
      ),
  );
}
