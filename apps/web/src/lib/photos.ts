import type { PhotoCredit } from './scenic.ts';
import data from './photos.json';

/**
 * Photos of the walks with a view, the hiking trails and the viewpoints on them, from
 * Wikimedia Commons, each with its author and licence (photos.json: what was chosen, and
 * where it came from). The files are `<file>.webp` (960 px wide, 3:2) and `<file>-sm.webp`
 * (480 px) in public/photos/; a viewpoint's photo is only shown small, so only that one.
 */
export interface Photo extends PhotoCredit {
  file: string;
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
