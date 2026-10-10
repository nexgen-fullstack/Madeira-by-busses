import { useEffect, useState } from 'react';
import {
  decodePolyline,
  encodePolyline,
  GridIndex,
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

const decoded = new WeakMap<Trail, LatLon[][]>();

/** A trail's lines as points. */
export function trailLines(t: Trail): LatLon[][] {
  let lines = decoded.get(t);
  if (!lines) {
    lines = t.lines.map(decodePolyline);
    decoded.set(t, lines);
  }
  return lines;
}

/**
 * A trail walked from its end to its start: its end the start, what it climbed what it goes
 * down, its lines the other way.
 */
export function reversedTrail(t: Trail): Trail {
  return {
    ...t,
    start: t.end,
    end: t.start,
    up: t.down,
    down: t.up,
    lines: trailLines(t).map((l) => encodePolyline([...l].reverse())),
  };
}

/** Closer than this (m) to a trail, another trail is on it (they meet or share the path). */
const TOUCH = 25;
/** A way off a trail shorter than this (m) is where two paths only wobble apart. */
const BRANCH = 150;

/** A line with a point at least every `step` metres. */
function densify(line: readonly LatLon[], step: number): LatLon[] {
  const out: LatLon[] = [];
  line.forEach((b, i) => {
    const a = line[i - 1];
    if (a) {
      const n = Math.floor(haversine(a, b) / step);
      for (let k = 1; k < n; k++) {
        out.push({
          lat: a.lat + (k / n) * (b.lat - a.lat),
          lon: a.lon + (k / n) * (b.lon - a.lon),
        });
      }
    }
    out.push(b);
  });
  return out;
}

const lengthOf = (line: readonly LatLon[]) =>
  line.slice(1).reduce((m, p, i) => m + haversine(line[i]!, p), 0);

/** Another trail met on the way: where it turns off the trail chosen, and where it goes. */
export interface TrailBranch {
  trail: Trail;
  /** Its way from where it leaves the trail chosen to where it ends (or comes back to it). */
  coords: LatLon[];
  /** It comes back onto the trail chosen at its end: another way between two of its places. */
  rejoins: boolean;
  /** Walked this way, the other trail is walked from its end to its start. */
  reversed: boolean;
}

/**
 * The other trails that meet `trail` (cross it, join it or share some of its path), each
 * from where it leaves it to where it goes: to its far end, or back onto `trail`. A trail
 * that only runs along it has none.
 */
export function trailBranches(trail: Trail, trails: readonly Trail[]): TrailBranch[] {
  const own = trailLines(trail).flatMap((l) => densify(l, 10));
  if (own.length === 0) return [];
  const index = new GridIndex(own, 60);
  const lats = own.map((p) => p.lat);
  const lons = own.map((p) => p.lon);
  const margin = 0.001;
  const box = {
    s: Math.min(...lats) - margin,
    n: Math.max(...lats) + margin,
    w: Math.min(...lons) - margin,
    e: Math.max(...lons) + margin,
  };
  const out: TrailBranch[] = [];
  for (const other of trails) {
    if (other.id === trail.id) continue;
    for (const raw of trailLines(other)) {
      // Not where the trail is: none of it.
      const la = raw.map((p) => p.lat);
      const lo = raw.map((p) => p.lon);
      if (
        Math.max(...la) < box.s ||
        Math.min(...la) > box.n ||
        Math.max(...lo) < box.w ||
        Math.min(...lo) > box.e
      )
        continue;
      const line = densify(raw, 8);
      const on = line.map((p) => index.within(p, TOUCH).length > 0);
      if (!on.includes(true)) continue;
      // Each stretch of it off the trail, from the point where it leaves it.
      let k = 0;
      while (k < line.length) {
        if (on[k]) {
          k++;
          continue;
        }
        const a = k;
        while (k < line.length && !on[k]) k++;
        const b = k - 1;
        const leaves = a > 0;
        const comesBack = b < line.length - 1;
        const coords = line.slice(leaves ? a - 1 : a, comesBack ? b + 2 : b + 1);
        if (lengthOf(coords) < BRANCH) continue;
        out.push(
          leaves
            ? { trail: other, coords, rejoins: comesBack, reversed: false }
            : { trail: other, coords: coords.reverse(), rejoins: false, reversed: true },
        );
      }
    }
  }
  return out;
}

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
