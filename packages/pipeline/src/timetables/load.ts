import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locality } from './build.ts';
import {
  DAY_KINDS,
  type SigaData,
  type SigaDayVariant,
  type SigaPattern,
  type SigaRoute,
  type SigaTimetable,
  type SigaStops,
  type SigaVariant,
  type TimetableFile,
} from './types.ts';

/** data/timetables/*.json, sorted by file name. */
export async function loadTimetables(dir: string): Promise<[string, TimetableFile][]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (n) => [n, JSON.parse(await readFile(join(dir, n), 'utf8')) as TimetableFile]),
  );
}

async function readJsonl<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/**
 * What scripts/fetch-siga.mjs collected (routes.json, variants.jsonl, stops.json, days/)
 * and scripts/fetch-siga-timetable.mjs (timetable/).
 */
export async function loadSiga(dir: string): Promise<SigaData> {
  const file = (name: string) => join(dir, name);
  const routes = existsSync(file('routes.json'))
    ? (JSON.parse(await readFile(file('routes.json'), 'utf8')) as { routes: SigaRoute[] }).routes
    : [];
  const variants = await readJsonl<SigaVariant>(file('variants.jsonl'));
  const webStops = existsSync(file('stops.json'))
    ? (JSON.parse(await readFile(file('stops.json'), 'utf8')) as SigaStops)
    : {};
  const days: NonNullable<SigaData['days']> = {};
  for (const kind of DAY_KINDS) {
    const records = await readJsonl<SigaDayVariant>(join(dir, 'days', `${kind}.jsonl`));
    if (records.length > 0) days[kind] = records;
  }
  // The journey planner's timetable, and its stops the website has not shown.
  const patterns = await readJsonl<SigaPattern>(file('timetable/trips.jsonl'));
  const servicesPath = file('timetable/services.json');
  const plannerStops = existsSync(file('timetable/stops.json'))
    ? (JSON.parse(await readFile(file('timetable/stops.json'), 'utf8')) as SigaStops)
    : {};
  const stops = { ...plannerStops, ...webStops };
  const timetable: SigaTimetable | undefined =
    patterns.length > 0 && existsSync(servicesPath)
      ? {
          services: JSON.parse(await readFile(servicesPath, 'utf8')) as SigaTimetable['services'],
          patterns,
        }
      : undefined;
  return { routes, variants, stops, days, ...(timetable ? { timetable } : {}) };
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
