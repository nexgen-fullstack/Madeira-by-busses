import { useEffect, useState } from 'react';
import {
  decodePolyline,
  haversine,
  type LatLon,
  type Network,
  type Trail,
  type TrailKind,
  type TrailsFile,
} from '@madeirabus/engine';
import type { Region } from './scenic.ts';

/**
 * The island's hiking trails (trails.json, built by the pipeline from OpenStreetMap), for
 * the trails tab and their layer on the map: loaded once, the first time they are wanted.
 */

let loading: Promise<Trail[]> | undefined;

/** The trails, or none when the file cannot be read (offline before it was ever loaded). */
export function loadTrails(): Promise<Trail[]> {
  loading ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/trails.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as TrailsFile).trails ?? [];
    } catch {
      // Asked again next time.
      loading = undefined;
      return [];
    }
  })();
  return loading;
}

/** The trails once loaded (undefined until then); `want` false: not yet asked for. */
export function useTrails(want = true): Trail[] | undefined {
  const [trails, setTrails] = useState<Trail[] | undefined>();
  useEffect(() => {
    if (!want) return;
    let cancelled = false;
    void loadTrails().then((t) => !cancelled && setTrails(t));
    return () => {
      cancelled = true;
    };
  }, [want]);
  return trails;
}

export const trailById = (trails: readonly Trail[] | undefined, id: string | undefined) =>
  trails?.find((t) => t.id === id);

/** A trail's lines as points. */
export const trailLines = (t: Trail): LatLon[][] => t.lines.map(decodePolyline);

export const startOf = (t: Trail): LatLon => ({ lat: t.start[0], lon: t.start[1] });
export const endOf = (t: Trail): LatLon => ({ lat: t.end[0], lon: t.end[1] });

/**
 * Where on the island a trail starts, as the places with a view are listed: the west
 * beyond Ribeira Brava, the east from Portela and Machico, the north coast, Funchal's
 * hills, and the high mountains between them.
 */
export function trailRegion(t: Trail): Region {
  const [lat, lon] = t.start;
  if (lon < -17.03) return 'west';
  if (lon > -16.8) return 'east';
  if (lat > 32.78) return 'north';
  if (lat < 32.69 && lon > -16.99) return 'funchal';
  return 'mountains';
}

/** The kinds in the order the tab filters them. */
export const TRAIL_KINDS: readonly TrailKind[] = ['pr', 'levada', 'vereda', 'other'];

/** How far from a trail's ends its buses may stop (m). */
const BY_BUS = 800;

/** The nearest bus stop to a point within reach, and how far it is as the crow flies. */
export function nearestStop(net: Network, p: LatLon): { stop: number; metres: number } | undefined {
  const hit = net.nearbyStops(p, BY_BUS).sort((a, b) => a.distance - b.distance)[0];
  return hit && { stop: hit.stop, metres: Math.round(haversine(p, net.stops[hit.stop]!)) };
}

/** The lines (their numbers, each once) that stop at a stop. */
export function linesAt(net: Network, stop: number): string[] {
  const numbers = new Set<string>();
  for (const { pattern } of net.stopPatterns[stop] ?? []) {
    numbers.add(net.routes[net.patterns[pattern]!.route]!.short);
  }
  return [...numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
