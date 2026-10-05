import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locality } from './build.ts';
import type { SigaData, SigaRoute, SigaStops, SigaVariant, TimetableFile } from './types.ts';

/** data/timetables/*.json, sorted by file name. */
export async function loadTimetables(dir: string): Promise<[string, TimetableFile][]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (n) => [n, JSON.parse(await readFile(join(dir, n), 'utf8')) as TimetableFile]),
  );
}

/** What scripts/fetch-siga.mjs collected (routes.json, variants.jsonl, stops.json). */
export async function loadSiga(dir: string): Promise<SigaData> {
  const file = (name: string) => join(dir, name);
  const routes = existsSync(file('routes.json'))
    ? (JSON.parse(await readFile(file('routes.json'), 'utf8')) as { routes: SigaRoute[] }).routes
    : [];
  const variants = existsSync(file('variants.jsonl'))
    ? (await readFile(file('variants.jsonl'), 'utf8'))
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as SigaVariant)
    : [];
  const stops = existsSync(file('stops.json'))
    ? (JSON.parse(await readFile(file('stops.json'), 'utf8')) as SigaStops)
    : {};
  return { routes, variants, stops };
}

/** Towns and villages from the Overpass answer of data/sources/osm/places.json. */
export async function loadLocalities(path: string): Promise<Locality[]> {
  if (!existsSync(path)) return [];
  const json = JSON.parse(await readFile(path, 'utf8')) as {
    elements?: {
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }[];
  };
  const out: Locality[] = [];
  for (const e of json.elements ?? []) {
    const kind = e.tags?.place;
    const name = e.tags?.name;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!kind || !name || lat === undefined || lon === undefined) continue;
    const rank = ['city', 'town', 'village', 'suburb'].includes(kind)
      ? 1
      : ['hamlet', 'locality', 'neighbourhood', 'quarter'].includes(kind)
        ? 2
        : 0;
    if (rank > 0) out.push({ name, lat, lon, rank });
  }
  return out;
}
