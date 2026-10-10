/**
 * Madeira's hiking trails, as the app lists them and draws them on the island: the
 * official PR trails (waymarked red and yellow by the regional forestry service) and the
 * levadas, veredas and old royal paths walkers map in OpenStreetMap. The pipeline builds
 * trails.json from OpenStreetMap's hiking routes and the island's elevation tiles.
 */

/** What a trail is: an official PR trail, a walk along a levada, a vereda or royal path, or another. */
export type TrailKind = 'pr' | 'levada' | 'vereda' | 'other';

export interface Trail {
  /** Short and stable, for the address: "pr-6", "osm-4442861". */
  id: string;
  /** The waymark's number ("PR 6") or the walkers' short name. */
  ref?: string;
  name: string;
  kind: TrailKind;
  /** OpenStreetMap's relation, for its page there. */
  osm: number;
  /** Metres along the trail. */
  length: number;
  /** Metres climbed and gone down walking it from its start to its end. */
  up: number;
  down: number;
  /** Its lowest and highest point (m above the sea). */
  low: number;
  high: number;
  /** Back where it started (a loop), or from one place to another. */
  roundtrip: boolean;
  /** Where it starts and ends, [lat, lon]. */
  start: [number, number];
  end: [number, number];
  /** Its shape as encoded polylines, one for each unbroken piece, the longest first. */
  lines: string[];
}

export interface TrailsFile {
  generatedAt: string;
  trails: Trail[];
}

/**
 * How long a trail takes walked from its start to its end (minutes), by the walkers' rule
 * (DIN 33466, as on the island's waymarks): 4 km an hour on the level, 300 m an hour up,
 * 500 m an hour down; the longer of the level and the slope, and half the shorter.
 */
export function trailMinutes(length: number, up: number, down: number): number {
  const level = length / 4000;
  const slope = up / 300 + down / 500;
  return Math.round((Math.max(level, slope) + Math.min(level, slope) / 2) * 60);
}
