import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { GtfsFiles } from '@madeirabus/engine';

/**
 * Loads a GTFS feed from a directory, a .zip file or an http(s) URL.
 * Several locations separated by `|` are tried in order (e.g. the operator's
 * URL first, then the Mobility Database mirror).
 */
export async function loadFeedFiles(location: string): Promise<GtfsFiles> {
  const candidates = location.split('|').filter(Boolean);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await loadOne(candidate);
    } catch (err) {
      lastError = err;
      if (candidates.length > 1) console.warn(`  ${candidate} failed: ${(err as Error).message}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadOne(location: string): Promise<GtfsFiles> {
  if (/^https?:\/\//.test(location)) {
    const res = await fetch(location, { headers: { 'user-agent': 'madeirabus-pipeline' } });
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} (${location})`);
    return unzipFeed(new Uint8Array(await res.arrayBuffer()));
  }
  const info = await stat(location);
  if (info.isDirectory()) {
    const files: GtfsFiles = {};
    for (const name of await readdir(location)) {
      if (name.endsWith('.txt')) files[name] = await readFile(join(location, name), 'utf8');
    }
    return files;
  }
  return unzipFeed(new Uint8Array(await readFile(location)));
}

/** Unzips a GTFS archive; tolerates feeds zipped inside a top-level folder. */
export function unzipFeed(zip: Uint8Array): GtfsFiles {
  const entries = unzipSync(zip, { filter: (f) => f.name.endsWith('.txt') });
  const files: GtfsFiles = {};
  for (const [path, data] of Object.entries(entries)) {
    const name = path.split('/').pop()!;
    files[name] = strFromU8(data);
  }
  return files;
}

/** Parses `name=location` (or just `location`) from the command line. */
export function parseFeedArg(arg: string): { name: string; location: string } {
  const m = /^([a-z0-9_-]+)=(.+)$/i.exec(arg);
  if (m && !/^https?$/i.test(m[1]!)) return { name: m[1]!, location: m[2]! };
  return {
    name: arg
      .split('/')
      .filter(Boolean)
      .pop()!
      .replace(/\.zip$/, ''),
    location: arg,
  };
}
