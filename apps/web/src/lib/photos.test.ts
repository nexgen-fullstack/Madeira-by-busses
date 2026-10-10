import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { photoCredits, trailViews, walkPhoto } from './photos.ts';
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
});
