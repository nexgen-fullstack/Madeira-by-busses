#!/usr/bin/env node
// Collects the whole timetable of CAM and SIGA Rodoeste — every line, every
// trip with its time at every stop, and the dates each service runs — from
// the journey planner behind the SIGA website (OpenTripPlanner, GTFS GraphQL
// API at sigadev.imt.madeira.gov.pt/otp). Unlike the website's timetable
// pages, which show today only, it knows every day of the operators' calendar.
//
// Writes into <outDir>/timetable/:
//
// - services.json: each service ("UE_002": weekdays of term time, Rodoeste)
//   with the dates it runs;
// - trips.jsonl: one record per stop sequence of a route ("pattern"): the
//   route's id and number, its stops in order, running times as profiles
//   (minutes from the departure to each stop) and the trips as departure,
//   profile and service;
// - stops.json: code → [name, latitude, longitude, municipality (INE code)].
//
// Horários do Funchal has a GTFS feed of its own and is left out.
//
// Usage: node scripts/fetch-siga-timetable.mjs [outDir=data/sources/siga]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.argv[2] ?? 'data/sources/siga', 'timetable');
const API = 'https://sigadev.imt.madeira.gov.pt/otp/otp/gtfs/v1';
const UA =
  'MadeiraBus timetable collector (+https://github.com/nexgen-fullstack/Madeira-by-busses)';
const PAUSE = 500;
/** Routes per request. */
const BATCH = 40;
const SKIP_AGENCY = /^HF$|Hor[aá]rios do Funchal/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(JSON.stringify(json.errors).slice(0, 300));
      return json.data;
    } catch (err) {
      if (attempt >= 3) throw new Error(`SIGA journey planner: ${err.message}`, { cause: err });
      await sleep(3000 * attempt);
    }
  }
}

const local = (gtfsId) => String(gtfsId).replace(/^[^:]*:/, '');
const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const isoDate = (yyyymmdd) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}`;
/** "Estacao R Brava  (24114)" → "Estacao R Brava". */
const stopName = (name, code) =>
  String(name)
    .replace(new RegExp(`\\s*\\(${code}\\)\\s*$`), '')
    .replace(/\s+/g, ' ')
    .trim();

const ROUTES = `query($ids: [String]) {
  routes(ids: $ids) {
    gtfsId shortName longName
    agency { name }
    patterns {
      code directionId headsign
      stops { code name lat lon zoneId }
      trips { serviceId stoptimes { scheduledDeparture stop { code } } }
    }
  }
}`;

async function writeIfChanged(path, text) {
  if (existsSync(path) && (await readFile(path, 'utf8')) === text) return false;
  await writeFile(path, text);
  return true;
}

async function main() {
  const { routes } = await gql('{ routes { gtfsId shortName agency { name } } }');
  const wanted = routes.filter((r) => !SKIP_AGENCY.test(r.agency?.name ?? ''));
  console.log(
    `SIGA journey planner: ${routes.length} routes, ${wanted.length} of CAM and Rodoeste`,
  );
  if (wanted.length < 300) throw new Error(`Only ${wanted.length} routes; keeping the old files`);

  const records = [];
  const stops = {};
  const sampleTrip = new Map(); // service → a trip id, to ask for its dates
  let trips = 0;
  for (let i = 0; i < wanted.length; i += BATCH) {
    const ids = wanted.slice(i, i + BATCH).map((r) => r.gtfsId);
    const data = await gql(ROUTES, { ids });
    for (const route of data.routes) {
      for (const p of route.patterns ?? []) {
        const codes = (p.stops ?? []).map((s) => String(s.code));
        if (codes.length < 2) continue;
        for (const s of p.stops) {
          if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) {
            stops[s.code] = [stopName(s.name, s.code), s.lat, s.lon, String(s.zoneId ?? '')];
          }
        }
        const profiles = [];
        const keys = new Map();
        const out = [];
        for (const t of p.trips ?? []) {
          const times = t.stoptimes.map((st) => Math.round(st.scheduledDeparture / 60));
          if (times.length !== codes.length) continue;
          if (t.stoptimes.some((st, k) => String(st.stop.code) !== codes[k])) continue;
          const profile = times.map((x) => x - times[0]);
          const key = profile.join(',');
          let pi = keys.get(key);
          if (pi === undefined) {
            pi = profiles.length;
            profiles.push(profile);
            keys.set(key, pi);
          }
          const service = local(t.serviceId);
          out.push([hhmm(times[0]), pi, service]);
          trips++;
        }
        if (out.length === 0) continue;
        out.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
        records.push({
          id: local(p.code),
          route: Number(local(route.gtfsId)),
          line: route.shortName,
          name: route.longName,
          operator: route.agency.name,
          direction: p.directionId ?? 0,
          headsign: p.headsign ?? '',
          stops: codes,
          profiles,
          trips: out,
        });
      }
    }
    await sleep(PAUSE);
  }
  if (trips < 1000) throw new Error(`Only ${trips} trips; keeping the old files`);

  // The dates of each service, from one of its trips.
  const { routes: withTrips } = await gql(
    `query($ids: [String]) { routes(ids: $ids) { patterns { trips { gtfsId serviceId } } } }`,
    { ids: wanted.map((r) => r.gtfsId) },
  );
  for (const r of withTrips) {
    for (const p of r.patterns ?? []) {
      for (const t of p.trips ?? []) {
        const s = local(t.serviceId);
        if (!sampleTrip.has(s)) sampleTrip.set(s, t.gtfsId);
      }
    }
  }
  const services = {};
  for (const [service, trip] of [...sampleTrip].sort()) {
    const d = await gql(`query($id: String!) { trip(id: $id) { activeDates } }`, { id: trip });
    services[service] = [...new Set(d.trip.activeDates)].sort().map(isoDate);
    await sleep(PAUSE);
  }

  records.sort((a, b) => a.route - b.route || a.id.localeCompare(b.id, 'en', { numeric: true }));
  await mkdir(OUT, { recursive: true });
  const servicesText =
    '{\n' +
    Object.entries(services)
      .map(([s, dates]) => `  ${JSON.stringify(s)}: ${JSON.stringify(dates)}`)
      .join(',\n') +
    '\n}\n';
  const sortedStops = Object.fromEntries(
    Object.entries(stops).sort(([a], [b]) => a.localeCompare(b)),
  );
  const changed = [
    await writeIfChanged(join(OUT, 'services.json'), servicesText),
    await writeIfChanged(
      join(OUT, 'trips.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    ),
    await writeIfChanged(
      join(OUT, 'stops.json'),
      JSON.stringify(sortedStops, null, 0).replace(/\],"/g, '],\n"') + '\n',
    ),
  ].some(Boolean);
  const lines = new Set(records.map((r) => `${r.operator}|${r.line}`));
  console.log(
    `SIGA timetable: ${lines.size} lines, ${records.length} stop sequences, ${trips} trips, ` +
      `${Object.keys(sortedStops).length} stops; services ` +
      Object.entries(services)
        .map(([s, d]) => `${s} ${d[0]}…${d[d.length - 1]} (${d.length} days)`)
        .join(', ') +
      (changed ? '' : ' — unchanged'),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
