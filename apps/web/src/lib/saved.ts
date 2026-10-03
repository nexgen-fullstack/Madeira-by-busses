import type { Network, StopGroup } from '@madeirabus/engine';
import type { SavedStop } from '../state/app.tsx';
import { stopIndex } from './itinerary.ts';

/** A stop group as a saved stop (by feed ids). */
export function toSaved(
  net: Network,
  group: Pick<StopGroup, 'name' | 'muni' | 'stops'>,
): SavedStop {
  return { ids: group.stops.map((s) => net.stops[s]!.id), name: group.name, muni: group.muni };
}

/** Saved stops that exist in this timetable, as stop groups. */
export function savedGroups(net: Network, saved: readonly SavedStop[]): StopGroup[] {
  const out: StopGroup[] = [];
  for (const s of saved) {
    const stops = s.ids.map((id) => stopIndex(net, id)).filter((i): i is number => i !== undefined);
    if (stops.length === 0) continue;
    const first = net.stops[stops[0]!]!;
    out.push({
      name: first.name,
      muni: first.muni,
      stops,
      lat: stops.reduce((a, i) => a + net.stops[i]!.lat, 0) / stops.length,
      lon: stops.reduce((a, i) => a + net.stops[i]!.lon, 0) / stops.length,
    });
  }
  return out;
}

export const isSaved = (net: Network, saved: readonly SavedStop[], stops: readonly number[]) => {
  const key = stops.map((s) => net.stops[s]!.id).join(',');
  return saved.some((s) => s.ids.join(',') === key);
};
