// Collects the public sources for the timetables that have no GTFS feed yet
// (CAM and SIGA Rodoeste): the SIGA and operator websites with their
// timetable PDFs (as text), and the bus routes and stops mapped in
// OpenStreetMap. Runs in GitHub Actions (see .github/workflows/sources.yml)
// and writes to data/sources/, where the pipeline can parse them.
//
//   node scripts/fetch-sources.mjs [outDir]
//
// Needs `pdftotext` (poppler-utils) for the PDFs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'data/sources';
const SEEDS = [
  'https://siga.madeira.gov.pt/',
  'https://siga.madeira.gov.pt/public/index.php/language/en',
  'https://siga.madeira.gov.pt/public/index.php/language/pt',
  'https://www.rodoeste.pt/',
  'https://www.sam.pt/',
];
const CRAWL_HOSTS = new Set(SEEDS.map((u) => new URL(u).host));
const MAX_PAGES = 600;
const MAX_PDFS = 500;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const UA =
  'MadeiraBus timetable collector (+https://github.com/nexgen-fullstack/Madeira-by-busses)';
// Bounding box of the archipelago (Madeira and Porto Santo).
const BBOX = '32.35,-17.35,33.15,-16.25';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const slug = (url) =>
  url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, 120);

async function get(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': UA, ...init.headers },
        signal: AbortSignal.timeout(init.method === 'POST' ? 360_000 : 60_000),
        redirect: 'follow',
      });
      return res;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(2000 * attempt);
    }
  }
}

function htmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function links(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/(?:href|src|data-url|data-href)\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1].trim(), base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.href);
    } catch {
      // Not a URL.
    }
  }
  return [...out];
}

const isPdf = (url) => /\.pdf($|\?)/i.test(url);
/** SIGA serves every page under /public/ too; crawl each once. */
const canonical = (url) => url.replace('://siga.madeira.gov.pt/public/', '://siga.madeira.gov.pt/');
/** Timetable PDFs, whose word positions the parser needs. */
const isTimetablePdf = (url) => url.includes('/storage/horarios_pdf/');
const isAsset = (url) =>
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|mp3|zip)($|\?)/i.test(url);

async function crawl() {
  const textDir = join(OUT, 'pdf-text');
  const bboxDir = join(OUT, 'pdf-bbox');
  mkdirSync(textDir, { recursive: true });
  mkdirSync(bboxDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'pdf-'));

  const queue = [...SEEDS];
  const seen = new Set(queue);
  const pdfs = new Set();
  const pages = [];
  const errors = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift();
    try {
      const res = await get(url);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        errors.push({ url, status: res.status });
        continue;
      }
      if (type.includes('pdf')) {
        pdfs.add(url);
        continue;
      }
      if (!type.includes('html')) continue;
      const html = await res.text();
      const found = links(html, res.url);
      const record = {
        url,
        final: res.url,
        title: /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim() ?? '',
        text: htmlText(html).slice(0, 30_000),
        links: found,
      };
      pages.push(record);
      for (const raw of found) {
        const link = canonical(raw);
        if (isPdf(link)) pdfs.add(link);
        else if (!seen.has(link) && !isAsset(link) && CRAWL_HOSTS.has(new URL(link).host)) {
          seen.add(link);
          queue.push(link);
        }
      }
    } catch (err) {
      errors.push({ url, error: String(err) });
    }
    await sleep(150);
  }
  writeFileSync(join(OUT, 'pages.jsonl'), pages.map((p) => JSON.stringify(p)).join('\n') + '\n');

  const pdfRecords = [];
  for (const url of [...pdfs].slice(0, MAX_PDFS)) {
    try {
      const res = await get(url);
      if (!res.ok) {
        pdfRecords.push({ url, status: res.status });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_PDF_BYTES) {
        pdfRecords.push({ url, bytes: buf.length, skipped: 'too large' });
        continue;
      }
      const file = join(tmp, 'f.pdf');
      writeFileSync(file, buf);
      const name = slug(url);
      // -layout keeps timetable columns roughly aligned, for reading.
      execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, join(textDir, `${name}.txt`)]);
      const record = { url, bytes: buf.length, sha256: sha(buf), text: `pdf-text/${name}.txt` };
      if (isTimetablePdf(url)) {
        // Every word with its box: the parser rebuilds the tables from these.
        execFileSync('pdftotext', ['-bbox-layout', file, join(bboxDir, `${name}.html`)]);
        record.bbox = `pdf-bbox/${name}.html`;
      }
      pdfRecords.push(record);
    } catch (err) {
      pdfRecords.push({ url, error: String(err) });
    }
    await sleep(150);
  }
  return { pages: pages.length, pdfs: pdfRecords, errors };
}

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Runs a query on the first Overpass server that answers. */
async function overpass(query) {
  const errors = [];
  for (const endpoint of OVERPASS) {
    try {
      const res = await get(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) return await res.json();
      errors.push(`${endpoint}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${endpoint}: ${err}`);
    }
    await sleep(5000);
  }
  throw new Error(errors.join('; '));
}

async function osm() {
  const dir = join(OUT, 'osm');
  mkdirSync(dir, { recursive: true });
  // Route relations with their stop and platform nodes (no way geometry).
  const routes = await overpass(
    `[out:json][timeout:300];
     (relation["type"="route"]["route"="bus"](${BBOX});
      relation["type"="route_master"]["route_master"="bus"](${BBOX}););
     out body;
     relation["type"="route"]["route"="bus"](${BBOX});
     node(r);
     out body;`,
  );
  writeFileSync(join(dir, 'bus-routes.json'), JSON.stringify(routes));
  const stops = await overpass(
    `[out:json][timeout:300];
     (node["highway"="bus_stop"](${BBOX});
      node["public_transport"="platform"]["bus"="yes"](${BBOX});
      node["public_transport"="stop_position"]["bus"="yes"](${BBOX}););
     out body;`,
  );
  writeFileSync(join(dir, 'bus-stops.json'), JSON.stringify(stops));
  // Named places people travel to, with their names in other languages.
  const places = await overpass(
    `[out:json][timeout:300];
     (nwr["place"~"^(city|town|village|suburb|neighbourhood|hamlet|locality)$"]["name"](${BBOX});
      nwr["tourism"~"^(attraction|museum|viewpoint|zoo|theme_park|gallery|hotel)$"]["name"](${BBOX});
      nwr["amenity"~"^(hospital|marketplace|university|college|townhall|ferry_terminal|bus_station|place_of_worship|theatre|casino)$"]["name"](${BBOX});
      nwr["aeroway"="aerodrome"]["name"](${BBOX});
      nwr["aerialway"="station"]["name"](${BBOX});
      nwr["leisure"~"^(park|garden|stadium|marina|water_park)$"]["name"](${BBOX});
      nwr["natural"~"^(beach|peak|cape|bay)$"]["name"](${BBOX});
      nwr["shop"="mall"]["name"](${BBOX});
      nwr["historic"]["name"](${BBOX});
      nwr["highway"="trailhead"]["name"](${BBOX}););
     out center tags;`,
  );
  writeFileSync(join(dir, 'places.json'), JSON.stringify(places));
  // Every way one might walk on, with its shape, for the walking network
  // (`madeirabus-pipeline walk` turns it into walk.bin; the file itself is not kept).
  const ways = await overpass(
    `[out:json][timeout:300];
     way["highway"]["highway"!~"^(motorway|motorway_link|construction|proposed|raceway|bus_guideway|platform|elevator|via_ferrata|abandoned|disused|razed|no)$"]["area"!="yes"](${BBOX});
     out geom qt;`,
  );
  writeFileSync(join(dir, 'walk-ways.json'), JSON.stringify(ways));
  const relations = routes.elements.filter((e) => e.type === 'relation');
  return {
    routeRelations: relations.filter((r) => r.tags?.type === 'route').length,
    routeMasters: relations.filter((r) => r.tags?.type === 'route_master').length,
    operators: [...new Set(relations.map((r) => r.tags?.operator).filter(Boolean))],
    stops: stops.elements.length,
    places: places.elements.length,
  };
}

/** The official Horários do Funchal feed, which mirrors may lag behind. */
async function hfFeed() {
  const url = 'https://www.horariosdofunchal.pt/googletransit.zip';
  const res = await get(url);
  if (!res.ok) return { url, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(OUT, 'hf');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'googletransit.zip');
  writeFileSync(file, buf);
  let feedInfo;
  try {
    feedInfo = execFileSync('unzip', ['-p', file, 'feed_info.txt']).toString('utf8').trim();
  } catch {
    feedInfo = undefined;
  }
  return { url, bytes: buf.length, sha256: sha(buf), feedInfo };
}

mkdirSync(OUT, { recursive: true });
const manifest = { fetchedAt: new Date().toISOString(), seeds: SEEDS };
try {
  manifest.hf = await hfFeed();
} catch (err) {
  manifest.hf = { error: String(err) };
}
try {
  manifest.osm = await osm();
} catch (err) {
  manifest.osm = { error: String(err) };
}
manifest.web = await crawl();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `pages: ${manifest.web.pages}, pdfs: ${manifest.web.pdfs.length}, errors: ${manifest.web.errors.length}`,
);
console.log('osm:', JSON.stringify(manifest.osm));
