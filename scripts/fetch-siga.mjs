#!/usr/bin/env node
// Collects the routes and timetables of CAM, SIGA Rodoeste, Aerobus and Porto Santo from the
// new SIGA website (sigadev.imt.madeira.gov.pt, Laravel Livewire):
//
// - routes.json: every route variant with its number, name, operator, number
//   of stops and running time;
// - days/<day>.jsonl: the timetable of a kind of day (mon … sun, and hol for
//   public holidays, when the site runs its Sunday "D" services): every trip of
//   every variant that runs, with its time at every stop. The timetable page
//   of a variant (/horarios/carreiras/<id>) lists all of today's trips;
// - variants.jsonl: for each variant and direction, the stops in order with
//   the minutes from the first stop (of its first trip), and the days it was
//   seen running. (The site's paths of CAM and Rodoeste variants are those of
//   Horários do Funchal lines with the same shape id, so they are left out.)
// - stops.json: the stops seen in them (code → name, latitude, longitude,
//   municipality).
//
// The site only shows a variant on the days it runs, so each run keeps what
// earlier runs found and replaces today's kind of day: after a week every day
// of the week is there, and the timetable follows the operators' changes.
//
// Usage: node scripts/fetch-siga.mjs [outDir=data/sources/siga]
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'data/sources/siga';
const BASE = 'https://sigadev.imt.madeira.gov.pt';
const UA =
  'MadeiraBus timetable collector (+https://github.com/nexgen-fullstack/Madeira-by-busses)';
const PAUSE = 700;
/** Horários do Funchal publishes a GTFS feed of its own (agency 1 on SIGA). */
const SKIP_AGENCIES = new Set([1]);
/** For trying the collector out: only these route ids (comma-separated); nothing is written to days/. */
const ONLY = process.env.SIGA_ONLY
  ? new Set(process.env.SIGA_ONLY.split(',').map(Number))
  : undefined;
/** Kinds of day, by JavaScript's getUTCDay() of the date. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const stopName = (name, code) =>
  String(name)
    .replace(new RegExp(`\\s*\\(${code}\\)\\s*$`), '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Today's trips of a variant ("ID:DIRECTION") from its timetable page: the
 * services running today, and each trip's time at every stop.
 */
async function schedule(route, direction) {
  const html = await request(`${BASE}/horarios/carreiras/${route.id}?direction=${direction}`);
  const comp = component(html, 'client.schedules.trip-schedule');
  if (!comp) throw new Error('SIGA timetable page changed: no schedule component');
  const services = comp.data.data ?? [];
  const trips = [];
  const seenStops = new Map();
  const serviceIds = new Set();
  let date;
  for (const service of services) {
    date ??= service.operation_date;
    for (const trip of service.trips ?? []) {
      const stops = (trip.stops ?? []).slice().sort((a, b) => a.stop_sequence - b.stop_sequence);
      if (stops.length < 2) continue;
      serviceIds.add(service.service_id);
      let last = -1;
      const times = stops.map((s) => {
        let t = minutes(s.departure_time);
        while (t < last) t += 24 * 60; // past midnight
        last = t;
        return t;
      });
      trips.push({
        service: service.service_id,
        stops: stops.map((s) => String(s.stop_code)),
        times,
      });
      for (const s of stops) {
        const code = String(s.stop_code);
        seenStops.set(code, [
          stopName(s.stop_name, code),
          Number(s.stop_lat),
          Number(s.stop_lon),
          String(s.zone_id ?? ''),
        ]);
      }
    }
  }
  trips.sort((a, b) => a.times[0] - b.times[0]);
  return { date, trips, services: [...serviceIds].sort(), seenStops };
}

/**
 * A variant's day in a compact form: its stops, the running times as
 * profiles (minutes from the departure at each stop) and the trips as
 * departure and profile. Trips with stops of their own (rare) keep them.
 */
function compact(id, route, date, trips) {
  const stops = trips[0].stops;
  const profiles = [];
  const keys = new Map();
  const out = [];
  for (const t of trips) {
    const profile = t.times.map((x) => x - t.times[0]);
    const key = profile.join(',');
    let p = keys.get(key);
    if (p === undefined) {
      p = profiles.length;
      profiles.push(profile);
      keys.set(key, p);
    }
    const own = t.stops.join(',') === stops.join(',') ? undefined : t.stops;
    out.push(own ? [hhmm(t.times[0]), p, own] : [hhmm(t.times[0]), p]);
  }
  return {
    id,
    line: route.line,
    date,
    services: [...new Set(trips.map((t) => t.service))].sort(),
    stops,
    profiles,
    trips: out,
  };
}

async function readJsonl(path) {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const writeJsonl = (path, records) =>
  writeFile(path, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));

const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

async function main() {
  await mkdir(join(OUT, 'days'), { recursive: true });
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

  const listed = new Set();
  const days = new Map(); // id → compact day, for the variants running today
  const empty = new Set(); // ids that answered without trips today
  const failedIds = new Set();
  const serviceCount = new Map();
  let date = today;
  for (const route of routes) {
    if (SKIP_AGENCIES.has(route.agency) || (ONLY && !ONLY.has(route.id))) continue;
    const dirs = route.directions.length > 0 ? route.directions : [0, 1];
    for (const dir of dirs) {
      const id = `${route.id}:${dir}`;
      listed.add(id);
      try {
        const s = await schedule(route, dir);
        if (s.trips.length === 0) {
          empty.add(id);
        } else {
          date = s.date ?? date;
          for (const sv of s.services) serviceCount.set(sv, (serviceCount.get(sv) ?? 0) + 1);
          const day = compact(id, route, s.date ?? today, s.trips);
          days.set(id, day);
          const first = s.trips[0];
          const prev = known.get(id);
          known.set(id, {
            id,
            line: route.line,
            name: route.name,
            operator: route.operator,
            stops: first.stops.map((code, i) => [code, first.times[i] - first.times[0]]),
            start: hhmm(first.times[0] % (24 * 60)),
            seen: s.date ?? today,
            // The last days it was seen running (the timetable of a holiday is a Sunday's).
            dates: [...new Set([...(prev?.dates ?? []), s.date ?? today])].sort().slice(-14),
          });
          for (const [code, value] of s.seenStops) {
            if (Number.isFinite(value[1]) && Number.isFinite(value[2])) stops[code] = value;
          }
        }
      } catch (err) {
        failedIds.add(id);
        console.warn(`! ${id}: ${err.message}`);
      }
      await sleep(PAUSE);
    }
  }

  // The kind of day: its weekday, or "hol" when a weekday runs the Sunday services.
  const wd = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const prefix = (sv) => /^[A-Z]+/.exec(sv)?.[0] ?? '';
  const sundayLike = [...serviceCount]
    .filter(([sv]) => prefix(sv) === 'D')
    .reduce((n, [, c]) => n + c, 0);
  const all = [...serviceCount.values()].reduce((n, c) => n + c, 0);
  const kind = wd !== 'sun' && all > 0 && sundayLike * 2 > all ? 'hol' : wd;

  if (!ONLY) {
    // Today's kind of day: what ran today replaces what was known; variants that
    // could not be read keep their earlier record, and ones off the list go.
    const dayPath = join(OUT, 'days', `${kind}.jsonl`);
    const before = new Map((await readJsonl(dayPath)).map((r) => [r.id, r]));
    const next = [];
    for (const id of listed) {
      const fresh = days.get(id);
      if (fresh) next.push(fresh);
      else if (failedIds.has(id) && before.has(id)) next.push(before.get(id));
    }
    next.sort(byId);
    const trips = (records) => records.reduce((n, r) => n + r.trips.length, 0);
    const earlier = trips([...before.values()]);
    if (earlier > 0 && trips(next) < earlier * 0.3) {
      // Christmas, New Year: a day with far fewer buses than the last one of its kind
      // says nothing about the others, so the earlier timetable stays.
      console.log(
        `SIGA ${kind} (${date}): only ${trips(next)} trips against ${earlier}; keeping the earlier day`,
      );
    } else {
      await writeJsonl(dayPath, next);
      console.log(`SIGA ${kind} (${date}): ${next.length} variants running, ${trips(next)} trips`);
    }
  }

  const lines = [...known.values()].sort(byId);
  await writeJsonl(variantsPath, lines);
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
    `SIGA: ${days.size} variants running today (${date}, ${kind}), ${empty.size} not today, ` +
      `${lines.length} known in all, ${Object.keys(sortedStops).length} stops` +
      `${failedIds.size ? `, ${failedIds.size} failed` : ''}`,
  );
  // Variants that could not be read kept yesterday's record of this kind of day.
  if (failedIds.size > Math.max(10, listed.size * 0.05)) {
    console.log(
      `::warning title=SIGA site unreliable::${failedIds.size} of ${listed.size} variants could not be read`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
