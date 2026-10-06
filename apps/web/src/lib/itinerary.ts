import {
  haversine,
  type BRoute,
  type FareRide,
  type Itinerary,
  type Network,
  type RideLeg,
} from '@madeirabus/engine';

export const ridesOf = (it: Itinerary) => it.legs.filter((l): l is RideLeg => l.kind === 'ride');

/** An express on the Via Rápida, as Rodoeste names its lines ("Funchal - Ribeira Brava (Via Rápida)"). */
export const isExpress = (route: BRoute) => /\bvia\s+r[aá]pida\b/i.test(route.long);

/** Whether a way rides an express on the Via Rápida. */
export const ridesExpress = (net: Network, it: Itinerary) =>
  ridesOf(it).some((l) => isExpress(net.routes[l.route]!));

export function fareRides(net: Network, it: Itinerary): FareRide[] {
  return ridesOf(it).map((l) => ({
    aerobus: Boolean(net.routes[l.route]!.aerobus),
    fromMunicipality: net.stops[l.from.stop!]!.muni,
    toMunicipality: net.stops[l.to.stop!]!.muni,
  }));
}

/** Stops this close (m) are one place where a bus ends: the bays of a station. */
const SAME_END = 150;

const shortEnds = new WeakMap<Network, Map<number, boolean>>();

/**
 * Whether a bus ends short of where other buses of its line go on to: the 702 from
 * Caniçal that ends at Machico while the others go on to Funchal. Its card then says
 * where it goes, or the change of bus there looks pointless.
 */
export function endsShort(net: Network, pattern: number): boolean {
  let known = shortEnds.get(net);
  if (!known) {
    known = new Map();
    shortEnds.set(net, known);
  }
  const cached = known.get(pattern);
  if (cached !== undefined) return cached;
  const p = net.patterns[pattern]!;
  const end = net.stops[p.stops[p.stops.length - 1]!]!;
  const before = p.stops[p.stops.length - 2];
  // Another bus of the line that comes the same way, passes where this one ends and goes on.
  const short =
    before !== undefined &&
    net.patterns.some((q, i) => {
      if (i === pattern || q.route !== p.route) return false;
      const from = q.stops.indexOf(before);
      if (from < 0) return false;
      for (let k = from + 1; k < q.stops.length - 2; k++) {
        if (haversine(net.stops[q.stops[k]!]!, end) <= SAME_END) return true;
      }
      return false;
    });
  known.set(pattern, short);
  return short;
}

const stopIndexById = new WeakMap<Network, Map<string, number>>();

/** Index of a stop by its feed id; ids stay the same across timetable updates. */
export function stopIndex(net: Network, id: string): number | undefined {
  let map = stopIndexById.get(net);
  if (!map) {
    map = new Map(net.stops.map((s, i) => [s.id, i]));
    stopIndexById.set(net, map);
  }
  return map.get(id);
}

/**
 * Compact place encoding for shareable URLs: `i:00225,00563` (stop ids, which
 * survive timetable updates), `s:1.2.3` (stop indices, older links) or
 * `p:lat,lon` with an optional `~name` (a shop, a hotel, a dropped pin).
 */
export function encodePlace(
  p: { stops?: number[]; lat: number; lon: number; name?: string },
  net?: Network,
): string {
  if (p.stops?.length) {
    return net ? `i:${p.stops.map((s) => net.stops[s]!.id).join(',')}` : `s:${p.stops.join('.')}`;
  }
  const point = `p:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  return p.name ? `${point}~${p.name}` : point;
}

export function decodePlace(
  net: Network,
  value: string | null,
  myLocationLabel: string,
):
  | { name: string; lat: number; lon: number; stops?: number[]; kind: 'stop' | 'location' }
  | undefined {
  if (!value) return undefined;
  const indices = value.startsWith('i:')
    ? value
        .slice(2)
        .split(',')
        .map((id) => stopIndex(net, id))
    : value.startsWith('s:')
      ? value.slice(2).split('.').map(Number)
      : undefined;
  if (indices) {
    const stops = indices.filter(
      (n): n is number => Number.isInteger(n) && n! >= 0 && n! < net.stops.length,
    );
    if (stops.length === 0) return undefined;
    const first = net.stops[stops[0]!]!;
    const lat = stops.reduce((a, s) => a + net.stops[s]!.lat, 0) / stops.length;
    const lon = stops.reduce((a, s) => a + net.stops[s]!.lon, 0) / stops.length;
    return { name: first.name, lat, lon, stops, kind: 'stop' };
  }
  if (value.startsWith('p:')) {
    const [coords = '', ...name] = value.slice(2).split('~');
    const [lat, lon] = coords.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { name: name.join('~') || myLocationLabel, lat: lat!, lon: lon!, kind: 'location' };
    }
  }
  return undefined;
}

export type OptionTag = 'fastest' | 'cheapest' | 'lessWalking';

/** Seconds on foot in a way. */
const onFoot = (it: Itinerary) =>
  it.legs.reduce((t, l) => t + (l.kind === 'walk' ? l.end - l.start : 0), 0);

/** Less on foot than the best way by at least this much to be worth a tag (s). */
const LESS_ON_FOOT = 5 * 60;

/**
 * What each way is good at besides the best one (the first): the one there first, the
 * cheapest and the one with the least walking, each told on its card when it is not the
 * best already.
 */
export function optionTags(
  options: readonly Itinerary[],
  payment: 'giro' | 'cash',
): Map<number, OptionTag[]> {
  const tags = new Map<number, OptionTag[]>();
  const best = options[0];
  if (!best || options.length < 2) return tags;
  const add = (i: number, tag: OptionTag) => tags.set(i, [...(tags.get(i) ?? []), tag]);
  const pick = (score: (it: Itinerary) => number | null, ok: (it: Itinerary) => boolean) => {
    let at = -1;
    options.forEach((it, i) => {
      const s = score(it);
      if (s === null || !ok(it)) return;
      if (at < 0 || s < score(options[at]!)!) at = i;
    });
    return at;
  };
  const fastest = pick(
    (it) => it.arrive,
    (it) => it.arrive < best.arrive,
  );
  if (fastest > 0) add(fastest, 'fastest');
  const fare = (it: Itinerary) => (it.rides === 0 ? null : it.fare[payment]);
  const bestFare = fare(best);
  const cheapest = pick(fare, (it) => bestFare !== null && (fare(it) ?? Infinity) < bestFare);
  if (cheapest > 0) add(cheapest, 'cheapest');
  const walking = pick(
    (it) => (it.rides === 0 ? null : onFoot(it)),
    (it) => onFoot(it) <= onFoot(best) - LESS_ON_FOOT,
  );
  if (walking > 0) add(walking, 'lessWalking');
  return tags;
}
