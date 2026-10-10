import { haversine, type LatLon, type Trail } from '@madeirabus/engine';
import type { ScenicSpot } from './mapContent.ts';
import type { PhotoCredit } from './scenic.ts';
import { trailLines, trailRegion } from './trails.ts';
import data from './photos.json';

/**
 * Photos of the walks with a view, the hiking trails and the viewpoints on them, from
 * Wikimedia Commons, each with its author and licence (photos.json: what was chosen, and
 * where it came from). The files are `<file>.webp` (960 px wide, 3:2) and `<file>-sm.webp`
 * (480 px) in public/photos/; a viewpoint's photo is only shown small, so only that one.
 */
export interface Photo extends PhotoCredit {
  file: string;
  /** Where it was taken (the camera's place on Wikimedia Commons). */
  lat?: number;
  lon?: number;
  /** The place it shows, for the list of credits. */
  title: string;
}

/** A place with a view on a trail (a viewpoint of OpenStreetMap within a few metres of it). */
export interface TrailView {
  name: string;
  lat: number;
  lon: number;
  photo?: Photo;
}

interface PhotoData {
  walks: Record<string, Photo>;
  trails: Record<string, Photo>;
  views: Record<string, TrailView[]>;
}

const PHOTOS = data as PhotoData;

/** A photo's address, small (480 px) or large (960 px). */
export const photoUrl = (p: Photo, size: 'sm' | 'lg') =>
  `${import.meta.env.BASE_URL}photos/${p.file}${size === 'sm' ? '-sm' : ''}.webp`;

/** The photo of a walk with a view, by where it goes to. */
export const walkPhoto = (to: string): Photo | undefined => PHOTOS.walks[to];

/** The photo of a trail, by its id. */
export const trailPhoto = (id: string): Photo | undefined => PHOTOS.trails[id];

/** The places with a view on a trail, along it. */
export const trailViews = (id: string): TrailView[] => PHOTOS.views[id] ?? [];

/** Every photo of the walks, trails and viewpoints, once each, for the list of credits. */
export function photoCredits(): Photo[] {
  const all = [
    ...Object.values(PHOTOS.walks),
    ...Object.values(PHOTOS.trails),
    ...Object.values(PHOTOS.views).flatMap((v) => v.flatMap((x) => (x.photo ? [x.photo] : []))),
  ];
  return [...new Map(all.map((p) => [p.file, p])).values()];
}

/** A photo taken farther than this from its trail (m) is of it from afar: not put on it. */
const ON_TRAIL = 400;

/** How far a point is from a trail (m), from its points (a few metres apart). */
function fromTrail(p: LatLon, lines: readonly LatLon[][]): number {
  let best = Infinity;
  for (const l of lines) for (const q of l) best = Math.min(best, haversine(p, q));
  return best;
}

/**
 * A trail's photos on the map where each was taken: its own and those of the viewpoints on
 * it, each a tap from the trail's page; none taken far from it.
 */
export function trailPhotoSpots(trail: Trail): ScenicSpot[] {
  const lines = trailLines(trail);
  const region = trailRegion(trail);
  const photos = [
    ...(trailPhoto(trail.id) ? [{ name: trail.name, photo: trailPhoto(trail.id)! }] : []),
    ...trailViews(trail.id).flatMap((v) => (v.photo ? [{ name: v.name, photo: v.photo }] : [])),
  ];
  const seen = new Set<string>();
  return photos.flatMap(({ name, photo }) => {
    if (photo.lat === undefined || photo.lon === undefined || seen.has(photo.file)) return [];
    const at = { lat: photo.lat, lon: photo.lon };
    if (fromTrail(at, lines) > ON_TRAIL) return [];
    seen.add(photo.file);
    return [
      {
        id: `${trail.id}:${photo.file}`,
        name,
        ...at,
        photo: photoUrl(photo, 'sm'),
        region,
        href: `hikes/${trail.id}`,
      },
    ];
  });
}
