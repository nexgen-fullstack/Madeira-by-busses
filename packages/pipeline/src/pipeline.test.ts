import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBundle,
  municipalityFromIne,
  Network,
  parseGtfs,
  Planner,
  SIGA_FARES_2026,
  toCsv,
  type Itinerary,
  type RideLeg,
} from '@madeirabus/engine';
import { generateDemoGtfs } from './demo/generate.ts';
import { DEMO_ROUTES } from './demo/network.ts';
import { loadFeedFiles, parseFeedArg, unzipFeed } from './load.ts';
import { prettyAgencyName, prettyRouteName, prettyStopName } from './names.ts';
import { diffBundles, diffMarkdown } from './report.ts';
import { validateBundle, validateFeed } from './validate.ts';

const files = generateDemoGtfs();
const feed = parseGtfs(files);
const { bundle } = buildBundle([{ feed, source: { name: 'demo' } }], {
  demo: true,
  fares: SIGA_FARES_2026,
  generatedAt: '2026-10-01T00:00:00Z',
});
const net = new Network(bundle);
const planner = new Planner(net);
const WEDNESDAY = '2026-10-07';
const h = (hh: number, mm = 0) => hh * 3600 + mm * 60;
const group = (name: string) => {
  const g = net.searchStops(name)[0];
  if (!g) throw new Error(`No stop ${name}`);
  return { lat: g.lat, lon: g.lon, name: g.name, stops: g.stops };
};
const rides = (it: Itinerary) => it.legs.filter((l): l is RideLeg => l.kind === 'ride');

/** Every itinerary must be physically possible. */
function assertConsistent(it: Itinerary) {
  let clock = it.depart;
  for (const leg of it.legs) {
    expect(leg.start).toBeGreaterThanOrEqual(clock - 1);
    expect(leg.end).toBeGreaterThanOrEqual(leg.start);
    if (leg.kind === 'ride') {
      const p = net.patterns[leg.pattern]!;
      expect(leg.stops.map((s) => s.stop)).toEqual(p.stops.slice(leg.boardPos, leg.alightPos + 1));
      expect(leg.stops[0]!.dep).toBe(leg.start);
      expect(leg.stops[leg.stops.length - 1]!.arr).toBe(leg.end);
      for (let i = 1; i < leg.stops.length; i++)
        expect(leg.stops[i]!.arr).toBeGreaterThanOrEqual(leg.stops[i - 1]!.dep);
    }
    clock = leg.end;
  }
  expect(it.arrive).toBe(clock);
  expect(it.duration).toBe(it.arrive - it.depart);
}

describe('demo feed', () => {
  it('passes validation without errors', () => {
    const issues = validateFeed(feed, '2026-10-02');
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(validateBundle(bundle, '2026-10-02').map((i) => i.code)).toEqual(
      expect.arrayContaining(['fares-unverified', 'aerobus-fare-unknown']),
    );
  });

  it('is marked as demo data', () => {
    expect(bundle.demo).toBe(true);
    expect(DEMO_ROUTES.every((r) => r.short.startsWith('D') || r.short === 'Aerobus')).toBe(true);
    expect(feed.feedInfo?.feed_publisher_name).toMatch(/DEMO/);
  });

  it('runs the Sunday timetable on regional holidays', () => {
    const rbr = group('Ribeira Brava').stops;
    // 1 July 2026 (Wednesday) is Madeira Day.
    const holiday = net
      .departures(rbr, '2026-07-01', h(6), 50)
      .filter((d) => net.routes[d.route]!.short === 'D139');
    expect(holiday.map((d) => d.time)).toEqual([h(9, 15), h(15, 15)]);
    const normal = net
      .departures(rbr, '2026-07-02', h(6), 50)
      .filter((d) => net.routes[d.route]!.short === 'D139');
    expect(normal).toHaveLength(4);
  });
});

describe('journeys on the demo network', () => {
  it('airport → Porto Moniz needs two changes and leaves no gap unexplained', () => {
    const results = planner.plan({
      from: group('Aeroporto'),
      to: group('Porto Moniz'),
      date: WEDNESDAY,
      time: h(8),
    });
    expect(results.length).toBeGreaterThan(0);
    const best = results[0]!;
    assertConsistent(best);
    expect(best.rides).toBe(3);
    const r = rides(best);
    expect(net.stops[r[0]!.from.stop!]!.name).toBe('Aeroporto da Madeira');
    expect(net.stops[r[r.length - 1]!.to.stop!]!.name).toBe('Porto Moniz');
    expect(net.routes[r[r.length - 1]!.route]!.short).toBe('D139');
    // Aerobus price is unknown, CAM's D113 is not: the planner never makes up a fare.
    if (r.some((l) => net.routes[l.route]!.aerobus)) expect(best.fare.giro).toBeNull();
    else expect(best.fare.giro).toBeGreaterThan(0);
  });

  it('finds the last bus back from Porto Moniz', () => {
    const last = planner.lastConnection({
      from: group('Porto Moniz'),
      to: group('Funchal (Avenida'),
      date: WEDNESDAY,
      time: h(12),
    });
    expect(last).toBeDefined();
    assertConsistent(last!);
    // D139 leaves Porto Moniz at 17:15 at the latest.
    expect(rides(last!)[0]!.start).toBe(h(17, 15));
  });

  it('produces consistent itineraries between every pair of towns', () => {
    const towns = [
      'Funchal (Avenida',
      'Monte',
      'Curral',
      'Santana',
      'Machico',
      'Calheta',
      'Porto Moniz',
      'Camacha',
      'Cabo Gir',
      'Paul do Mar',
    ];
    let found = 0;
    for (const a of towns) {
      for (const b of towns) {
        if (a === b) continue;
        const results = planner.plan({
          from: group(a),
          to: group(b),
          date: WEDNESDAY,
          time: h(7, 30),
        });
        for (const it of results) assertConsistent(it);
        if (results.some((it) => it.rides > 0)) found++;
      }
    }
    expect(found).toBe(towns.length * (towns.length - 1));
  });
});

describe('pipeline utilities', () => {
  it('unzips feeds, also when nested in a folder', () => {
    const zip = zipSync({
      'feed/agency.txt': strToU8(files['agency.txt']!),
      'feed/readme.md': strToU8('x'),
    });
    expect(Object.keys(unzipFeed(zip))).toEqual(['agency.txt']);
  });

  it('parses feed arguments', () => {
    expect(parseFeedArg('hf=https://example.com/g.zip')).toEqual({
      name: 'hf',
      location: 'https://example.com/g.zip',
    });
    expect(parseFeedArg('data/rodoeste.zip')).toEqual({
      name: 'rodoeste',
      location: 'data/rodoeste.zip',
    });
  });

  it('summarises timetable changes', () => {
    const smaller = structuredClone(bundle);
    smaller.routes = smaller.routes.slice(0, -1);
    smaller.patterns = smaller.patterns.filter((p) => p.route < smaller.routes.length);
    smaller.patterns[0]!.trips = smaller.patterns[0]!.trips.slice(1);
    const d = diffBundles(bundle, smaller);
    expect(d.removedRoutes).toHaveLength(1);
    expect(d.changedRoutes).toHaveLength(1);
    expect(diffMarkdown(d)).toMatch(/Removed routes/);
    expect(diffMarkdown(diffBundles(bundle, bundle))).toBe('No timetable changes.\n');
  });
});

describe('real Horários do Funchal conventions', () => {
  it('turns stop names into readable ones', () => {
    const name = (stop_desc: string, stop_name = 'x') => prettyStopName({ stop_name, stop_desc });
    expect(name('CAM LMB Aguiares')).toBe('Caminho Lombo Aguiares');
    expect(name('R ENG Ornelas Camacho')).toBe('Rua Eng. Ornelas Camacho');
    expect(name('Depois Capela C Freiras')).toBe('Depois Capela Curral das Freiras');
    expect(name('Centro Cívico S Martinho')).toBe('Centro Cívico São Martinho');
    expect(name('AV Mar Alfândega')).toBe('Avenida Mar Alfândega');
    expect(name('AV S Menor R Nova Alegria')).toBe('Avenida Santiago Menor Rua Nova Alegria');
    expect(prettyRouteName({ route_long_name: 'Funchal - CFreiras (via FJ Cardos)' })).toBe(
      'Funchal - Curral das Freiras (via Fajã Cardos)',
    );
    expect(prettyAgencyName({ agency_name: 'HF' })).toBe('Horários do Funchal');
    expect(prettyAgencyName({ agency_name: 'Rodoeste' })).toBe('Rodoeste');
    // Without a description, the name minus its stop code.
    expect(prettyStopName({ stop_name: 'Fajã Escura-Final (CF19J)' })).toBe('Fajã Escura-Final');
  });

  it('reads INE municipality codes and pretty names when building', () => {
    const files = {
      'agency.txt': toCsv(
        ['agency_name', 'agency_url', 'agency_timezone'],
        [['HF', 'https://hf.pt', 'Atlantic/Madeira']],
      ),
      'stops.txt': toCsv(
        ['stop_id', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'municipality'],
        [
          ['1', 'AV Mar  E E M (11)', 'AV Mar EEM', 32.6469, -16.9086, '3103'],
          // Near Funchal's seat but in Câmara de Lobos by its INE code.
          ['2', 'ESCL Curral das Freiras (CF15)', 'ESCL Curral Freiras', 32.65, -16.91, '3102'],
        ],
      ),
      'routes.txt': toCsv(['route_id', 'route_short_name', 'route_type'], [['181', '181', 3]]),
      'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], [['181', 'S', 't']]),
      'stop_times.txt': toCsv(
        ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
        [
          ['t', '10:00:00', '10:00:00', '1', 1],
          ['t', '10:50:00', '10:50:00', '2', 2],
        ],
      ),
      // Every Friday of June and July 2026.
      'calendar_dates.txt': toCsv(
        ['service_id', 'date', 'exception_type'],
        ['0605', '0612', '0619', '0626', '0703', '0710', '0717', '0724', '0731'].map((d) => [
          'S',
          `2026${d}`,
          1,
        ]),
      ),
    };
    const { bundle, report } = buildBundle([{ feed: parseGtfs(files), source: { name: 'hf' } }], {
      demo: false,
      fares: SIGA_FARES_2026,
      stopName: prettyStopName,
      extendUntil: '2026-10-31',
      missingOperators: ['CAM'],
    });
    expect(bundle.stops.map((s) => [s.name, s.muni])).toEqual([
      ['Avenida Mar EEM', 'FNC'],
      ['Escola Curral das Freiras', 'CML'],
    ]);
    expect(report.guessedMunicipalities).toBe(0);
    expect(municipalityFromIne('3201')).toBe('PST');
    expect(municipalityFromIne('9999')).toBeUndefined();
    // A Friday service whose feed ended on 31 July keeps running on Fridays.
    expect(bundle.projected).toEqual({ officialUntil: '2026-07-31', until: '2026-10-31' });
    expect(bundle.missingOperators).toEqual(['CAM']);
    expect(new Network(bundle).isServiceActive(0, '2026-10-02')).toBe(true);
    expect(new Network(bundle).isServiceActive(0, '2026-10-03')).toBe(false);
  });

  it('falls back to the next feed location', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'));
    writeFileSync(join(dir, 'agency.txt'), files['agency.txt']!);
    const loaded = await loadFeedFiles(`${join(dir, 'missing.zip')}|${dir}`);
    expect(Object.keys(loaded)).toEqual(['agency.txt']);
  });
});
