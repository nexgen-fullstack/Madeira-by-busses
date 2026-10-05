import type { BRoute, FareRide, Itinerary, Network, RideLeg } from '@madeirabus/engine';

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
