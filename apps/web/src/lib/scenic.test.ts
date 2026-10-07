import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isScenicWalk,
  Planner,
  SIGA_FARES_2026,
  WalkGraph,
  type Network,
} from '@madeirabus/engine';
import { byRegion, DESTINATIONS, hasPhoto, photo, REGIONS, SCENIC_WALKS } from './scenic.ts';

describe('places with a view', () => {
  it('each have a region, and a photo only with its author and licence', () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
    for (const d of DESTINATIONS) {
      expect(REGIONS).toContain(d.region);
      expect(photo(d, 'sm') === undefined).toBe(!hasPhoto(d));
      // A photo is either credited or not, never both.
      expect(d.credit !== undefined && d.uncredited === true).toBe(false);
    }
    // Region by region, none left out.
    const listed = byRegion(DESTINATIONS).flatMap(([, list]) => list);
    expect(listed).toHaveLength(DESTINATIONS.length);
  });
});

describe('walks with a view', () => {
  // The island's walking network, with how much each way climbs and which have a view.
  const walk = WalkGraph.decode(
    readFileSync(new URL('../../../../data/sources/osm/walk.bin', import.meta.url)),
  );
  // Walking all the way needs no timetable, only the fares (none).
  const planner = new Planner(
    { stops: [], bundle: { fares: SIGA_FARES_2026 } } as unknown as Network,
    walk,
  );

  it('are each a walk with a view by the planner’s own rules, all round the island', () => {
    for (const w of SCENIC_WALKS) {
      const it = planner.walkOnly({ from: w.from, to: w.to, date: '2026-10-08', time: 36000 });
      expect(it, `${w.from.name} → ${w.to.name}`).toBeDefined();
      expect(isScenicWalk(it!), `${w.from.name} → ${w.to.name}`).toBe(true);
    }
    expect(new Set(SCENIC_WALKS.map((w) => w.region)).size).toBe(4);
  });
});
