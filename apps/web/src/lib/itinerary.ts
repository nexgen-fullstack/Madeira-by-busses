import type { FareRide, Itinerary, Network, RideLeg } from '@madeirabus/engine';

export const ridesOf = (it: Itinerary) => it.legs.filter((l): l is RideLeg => l.kind === 'ride');

export function fareRides(net: Network, it: Itinerary): FareRide[] {
  return ridesOf(it).map((l) => ({
    aerobus: Boolean(net.routes[l.route]!.aerobus),
    fromMunicipality: net.stops[l.from.stop!]!.muni,
    toMunicipality: net.stops[l.to.stop!]!.muni,
  }));
}

/**
 * Compact place encoding for shareable URLs: `s:1.2.3` (stops) or
 * `p:lat,lon` with an optional `~name` (a shop, a hotel, a dropped pin).
 */
export function encodePlace(p: {
  stops?: number[];
  lat: number;
  lon: number;
  name?: string;
}): string {
  if (p.stops?.length) return `s:${p.stops.join('.')}`;
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
  if (value.startsWith('s:')) {
    const stops = value
      .slice(2)
      .split('.')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < net.stops.length);
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
