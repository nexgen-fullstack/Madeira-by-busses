import type { LatLon } from './geo.ts';
import type { RoadGraph } from './roads.ts';
import { BIKE_PROFILE, BIKE_SPEED, type WalkGraph } from './walk.ts';

/**
 * The ways other than the bus, as a maps app offers them beside it: by car along the
 * roads, on foot or by bike along the streets and paths.
 */
export type TravelMode = 'car' | 'walk' | 'bike';
export const TRAVEL_MODES: readonly TravelMode[] = ['car', 'walk', 'bike'];

export interface Travel {
  mode: TravelMode;
  /** From the first point to the second. */
  path: LatLon[];
  /** Metres. */
  length: number;
  seconds: number;
  /** Metres climbed and gone down on the way (on foot and by bike). */
  up?: number;
  down?: number;
}

/**
 * Going from `from` to `to` by car, on foot (at `walkSpeed` m/s on the level, slower up
 * the hills) or by bike; undefined when the network for it is not loaded or has no way.
 */
export function travel(
  mode: TravelMode,
  from: LatLon,
  to: LatLon,
  ways: { walk?: WalkGraph; roads?: RoadGraph; walkSpeed: number },
): Travel | undefined {
  if (mode === 'car') {
    const drive = ways.roads?.route(from, to);
    return drive && { mode, ...drive };
  }
  const bike = mode === 'bike';
  const way = bike
    ? ways.walk?.route(from, to, 300, 1, BIKE_PROFILE)
    : ways.walk?.route(from, to, 300);
  if (!way) return undefined;
  return {
    mode,
    path: way.path,
    length: way.length,
    seconds: Math.round(way.cost / (bike ? BIKE_SPEED : ways.walkSpeed)),
    up: way.up,
    down: way.down,
  };
}
