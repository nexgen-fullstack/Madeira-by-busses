import { isNative } from './device.ts';
import { load, save } from './storage.ts';

/**
 * Where the timetable comes from. The website ships it next to the app and
 * the service worker keeps it fresh. The phone app ships the timetable of its
 * build and, when online, downloads newer ones from the website in the
 * background; a newer copy is used from the next start, so a timetable never
 * changes under a passenger's fingers.
 */

/** The published timetable, e.g. https://…github.io/Madeira-by-busses/data/network.json */
const REMOTE: string | undefined = import.meta.env.VITE_REMOTE_DATA || undefined;
const CACHE = 'madeirabus-data';
const META_KEY = 'madeirabus.remoteData.v1';
/** Check the website at most this often. */
const CHECK_EVERY = 6 * 3600 * 1000;

interface Meta {
  generatedAt: string;
  checkedAt: number;
}

const local = (name: string) => fetch(`${import.meta.env.BASE_URL}data/${name}.json`);

/** Bundle text for a dataset; `fallback` when the real timetable is missing from this build. */
export async function loadBundleText(
  dataset: 'real' | 'demo',
): Promise<{ json: string; fallback: boolean }> {
  if (dataset === 'real') {
    const cached = await cachedRemote();
    if (cached) return { json: cached, fallback: false };
    const res = await local('network');
    // A dev server answers a missing file with the app page instead of a 404.
    const ok = res.ok && (res.headers.get('content-type') ?? '').includes('json');
    if (ok) return { json: await res.text(), fallback: false };
  }
  const res = await local('demo');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { json: await res.text(), fallback: dataset === 'real' };
}

/** A downloaded timetable newer than the one built into the app, if any. */
async function cachedRemote(): Promise<string | undefined> {
  if (!REMOTE || !isNative() || typeof caches === 'undefined') return undefined;
  const meta = load<Meta | null>(META_KEY, null);
  if (!meta || meta.generatedAt <= __BUNDLED_DATA__) return undefined;
  try {
    const res = await (await caches.open(CACHE)).match(REMOTE);
    return res ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Downloads the published timetable when it is newer than `current`
 * (the generatedAt of the loaded one). Never throws.
 */
export async function refreshRemote(current: string): Promise<void> {
  if (!REMOTE || !isNative() || typeof caches === 'undefined' || !navigator.onLine) return;
  const meta = load<Meta | null>(META_KEY, null);
  if (meta && Date.now() - meta.checkedAt < CHECK_EVERY) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    const res = await fetch(REMOTE, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const text = await res.text();
    const bundle = JSON.parse(text) as { format?: string; generatedAt?: string; demo?: boolean };
    const generatedAt = bundle.generatedAt ?? '';
    if (bundle.format === 'madeirabus.network' && !bundle.demo && generatedAt > current) {
      const cache = await caches.open(CACHE);
      await cache.put(
        REMOTE,
        new Response(text, { headers: { 'content-type': 'application/json' } }),
      );
      save(META_KEY, { generatedAt, checkedAt: Date.now() } satisfies Meta);
    } else {
      save(META_KEY, {
        generatedAt: meta?.generatedAt ?? '',
        checkedAt: Date.now(),
      } satisfies Meta);
    }
  } catch {
    // Offline or the website is down: try again next time.
  }
}
