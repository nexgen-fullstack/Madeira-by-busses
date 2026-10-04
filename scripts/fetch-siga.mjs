#!/usr/bin/env node
// Collects the routes of CAM, SIGA Rodoeste, Aerobus and Porto Santo from the
// new SIGA website (sigadev.imt.madeira.gov.pt, Laravel Livewire):
//
// - routes.json: every route variant with its number, name, operator, number
//   of stops and running time;
// - variants.jsonl: for each variant and direction, the stops in order with
//   the minutes from the first stop of a trip that runs that day, one variant
//   per line. (The site's paths of CAM and Rodoeste variants are those of
//   Horários do Funchal lines with the same shape id, so they are left out.)
// - stops.json: the stops seen in them (code → name, latitude, longitude,
//   municipality).
//
// The site only shows a variant's stops on days it runs, so each run keeps
// what earlier runs found (variants.jsonl, stops.json) and adds today's:
// after a week every variant that runs on some day of the week is there.
// `dates` lists the last days a variant was seen running.
//
// Usage: node scripts/fetch-siga.mjs [outDir=data/sources/siga]
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'data/sources/siga';
const BASE = 'https://sigadev.imt.madeira.gov.pt';
const UA = 'MadeiraBus timetable collector (+https://github.com/nexgen-fullstack/madeirabus)';
const PAUSE = 700;
/** Horários do Funchal publishes a GTFS feed of its own (agency 1 on SIGA). */
const SKIP_AGENCIES = new Set([1]);
/** For trying the collector out: only these route ids (comma-separated). */
const ONLY = process.env.SIGA_ONLY
  ? new Set(process.env.SIGA_ONLY.split(',').map(Number))
  : undefined;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookies = new Map();

function remember(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function request(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          'user-agent': UA,
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          ...init.headers,
        },
        signal: AbortSignal.timeout(90_000),
      });
      remember(res);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(3000 * attempt);
    }
  }
}

const unescapeHtml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Livewire wraps arrays as [value, {s: 'arr'}]. */
function unwrap(x) {
  if (Array.isArray(x)) {
    if (x.length === 2 && x[1] && typeof x[1] === 'object' && 's' in x[1]) return unwrap(x[0]);
    return x.map(unwrap);
  }
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, unwrap(v)]));
  }
  return x;
}

function component(html, name) {
  for (const m of html.matchAll(/wire:snapshot="([^"]*)"/g)) {
    const raw = unescapeHtml(m[1]);
    const snap = JSON.parse(raw);
    if (snap.memo?.name === name) return { raw, data: unwrap(snap.data) };
  }
  return undefined;
}

async function livewire(token, snapshot, calls, referer) {
  const body = JSON.stringify({
    _token: token,
    components: [{ snapshot, updates: {}, calls }],
  });
  const text = await request(`${BASE}/livewire/update`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-livewire': 'true',
      referer,
      origin: BASE,
    },
  });
  const c = JSON.parse(text).components[0];
  return { raw: c.snapshot, data: unwrap(JSON.parse(c.snapshot).data) };
}

/** Every route variant, from the real-time page's list (15 per page). */
async function listRoutes() {
  const page = `${BASE}/tempo-real`;
  const html = await request(page);
  const token = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];
  let comp = component(html, 'client.real-time.real-time-page');
  if (!token || !comp) throw new Error('SIGA real-time page changed: no list component');
  const rows = () => comp.data.trips?.data ?? comp.data.trips ?? [];
  for (let i = 0; i < 200 && comp.data.hasMore; i++) {
    const before = rows().length;
    comp = await livewire(
      token,
      comp.raw,
      [{ path: '', method: '__dispatch', params: ['load-more', {}] }],
      page,
    );
    if (rows().length === before) break;
    await sleep(PAUSE);
  }
  return rows().map((r) => ({
    id: r.route_id,
    agency: r.agency_id,
    operator: r.agency_name,
    line: r.route_short_name,
    name: r.route_long_name,
    stops: Number(r.n_stops) || 0,
    duration: r.trip_time,
    directions: r.directions ?? [],
  }));
}

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const stopName = (name, code) =>
  String(name)
    .replace(new RegExp(`\\s*\\(${code}\\)\\s*$`), '')
    .replace(/\s+/g, ' ')
    .trim();

/** A variant's stops and path, from its real-time page ("ID:DIRECTION"). */
async function variant(route, direction) {
  const html = await request(`${BASE}/tempo-real?carreiras=${route.id}%3A${direction}`);
  const comp = component(html, 'client.real-time.real-time-page');
  const sel = comp?.data.selectedRoutes?.[String(route.id)];
  const stops = (sel?.stops ?? []).slice().sort((a, b) => a.stop_sequence - b.stop_sequence);
  if (stops.length < 2) return undefined;
  const t0 = minutes(stops[0].departure_time);
  let last = t0;
  const list = [];
  for (const s of stops) {
    let t = minutes(s.departure_time);
    while (t < last) t += 24 * 60; // past midnight
    last = t;
    list.push([String(s.stop_code), t - t0]);
  }
  return {
    stops: list,
    start: stops[0].departure_time,
    seenStops: stops.map((s) => [
      String(s.stop_code),
      stopName(s.stop_name, s.stop_code),
      Number(s.stop_lat),
      Number(s.stop_lon),
      String(s.zone_id ?? ''),
    ]),
  };
}

async function readJsonl(path) {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Madeira' }).format(
    new Date(),
  );

  const routes = await listRoutes();
  console.log(`SIGA: ${routes.length} route variants`);
  if (routes.length < 300)
    throw new Error(`Only ${routes.length} routes listed; keeping the old files`);

  const variantsPath = join(OUT, 'variants.jsonl');
  const stopsPath = join(OUT, 'stops.json');
  const known = new Map((await readJsonl(variantsPath)).map((v) => [v.id, v]));
  const stops = existsSync(stopsPath) ? JSON.parse(await readFile(stopsPath, 'utf8')) : {};

  let found = 0;
  let failed = 0;
  for (const route of routes) {
    if (SKIP_AGENCIES.has(route.agency) || (ONLY && !ONLY.has(route.id))) continue;
    const dirs = route.directions.length > 0 ? route.directions : [0, 1];
    for (const dir of dirs) {
      const id = `${route.id}:${dir}`;
      try {
        const v = await variant(route, dir);
        if (v) {
          found++;
          const prev = known.get(id);
          known.set(id, {
            id,
            line: route.line,
            name: route.name,
            operator: route.operator,
            stops: v.stops,
            start: v.start,
            seen: today,
            // The last days it was seen running (the timetable of a holiday is a Sunday's).
            dates: [...new Set([...(prev?.dates ?? []), today])].sort().slice(-14),
          });
          for (const [code, name, lat, lon, zone] of v.seenStops) {
            if (Number.isFinite(lat) && Number.isFinite(lon)) stops[code] = [name, lat, lon, zone];
          }
        }
      } catch (err) {
        failed++;
        console.warn(`! ${id}: ${err.message}`);
      }
      await sleep(PAUSE);
    }
  }

  const lines = [...known.values()].sort((a, b) =>
    a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
  await writeFile(variantsPath, lines.map((v) => JSON.stringify(v)).join('\n') + '\n');
  const sortedStops = Object.fromEntries(
    Object.entries(stops).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(stopsPath, JSON.stringify(sortedStops, null, 0).replace(/\],"/g, '],\n"') + '\n');
  await writeFile(
    join(OUT, 'routes.json'),
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        routes: routes.filter((r) => !SKIP_AGENCIES.has(r.agency)),
      },
      null,
      1,
    ) + '\n',
  );
  console.log(
    `SIGA: ${found} variants with stops today (${today}), ${lines.length} known in all, ` +
      `${Object.keys(sortedStops).length} stops${failed ? `, ${failed} failed` : ''}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
