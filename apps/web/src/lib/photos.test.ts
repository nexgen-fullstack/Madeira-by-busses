import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { haversine, type Trail } from '@madeirabus/engine';
import { photoCredits, trailPhotoSpots, trailViews, walkPhoto } from './photos.ts';
import { trailLines } from './trails.ts';
import { SCENIC_WALKS } from './scenic.ts';

const dir = fileURLToPath(new URL('../../public/photos/', import.meta.url));

describe('the photos of the walks, trails and viewpoints', () => {
  it('are in the app, large and small, each with its author and licence', () => {
    for (const p of photoCredits()) {
      if (!p.file.startsWith('view-'))
        expect(existsSync(`${dir}${p.file}.webp`), p.file).toBe(true);
      expect(existsSync(`${dir}${p.file}-sm.webp`), p.file).toBe(true);
      expect(p.author, p.file).not.toBe('');
      expect(p.license, p.file).toMatch(/^(CC|Public domain)/);
      expect(p.source, p.file).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it('are of nearly every walk with a view, by where it goes', () => {
    expect(SCENIC_WALKS.filter((w) => walkPhoto(w.to.name)).length).toBeGreaterThan(10);
    expect(trailViews('none')).toEqual([]);
  });

  it('stand on the map where they were taken, by their trail, a tap from its page', () => {
    const file = fileURLToPath(
      new URL('../../../../data/sources/osm/trails.json', import.meta.url),
    );
    const trails = (JSON.parse(readFileSync(file, 'utf8')) as { trails: Trail[] }).trails;
    const pr8 = trails.find((t) => t.id === 'pr8')!;
    const spots = trailPhotoSpots(pr8);
    expect(spots.length).toBeGreaterThan(2);
    const points = trailLines(pr8).flat();
    for (const s of spots) {
      expect(s.href).toBe('hikes/pr8');
      expect(Math.min(...points.map((p) => haversine(p, s)))).toBeLessThan(400);
    }
    // Every photo with the place it was taken.
    expect(photoCredits().every((p) => p.lat !== undefined && p.lon !== undefined)).toBe(true);
  });
});
