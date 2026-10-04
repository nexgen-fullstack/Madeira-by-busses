import { haversine, type LatLon, type Network } from '@madeirabus/engine';
import type { I18n } from '../i18n.ts';
import { placeName } from './mapStyles.ts';

/**
 * A name for a point picked on the map: "Near Hotel Savoy" when a named place
 * or a stop is right next to it, otherwise just "Point on the map".
 */
export function pointName(net: Network | undefined, p: LatLon, t: I18n): string {
  if (net) {
    let best: { name: string; d: number } | undefined;
    for (const place of net.bundle.places ?? []) {
      const d = haversine(p, place);
      if (d < 80 && (!best || d < best.d)) best = { name: placeName(place, t.lang), d };
    }
    const stop = best ? undefined : net.nearbyStops(p, 60)[0];
    if (stop) best = { name: net.stops[stop.stop]!.name, d: stop.distance };
    if (best) return t.t('place.near', { name: best.name });
  }
  return t.t('place.pin');
}
