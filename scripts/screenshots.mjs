// Screenshots of the built app: for the README (Ukrainian, docs/screenshots/)
// and for the Google Play listing (English, 1080×2160 JPEG, branding/play/screenshots/).
//
//   pnpm data && pnpm data:real && pnpm --filter @madeirabus/web build
//   pnpm --filter @madeirabus/web preview    # http://localhost:4173/
//   node scripts/screenshots.mjs [docs|play]  # both by default
//
// CHROMIUM_PATH picks the browser. RELAY_TILES=1 fetches the map tiles in Node,
// for sandboxes where the browser has no network of its own. WebP files and
// the picture of the PDF timetable need ImageMagick and poppler (pdftoppm).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE || 'http://localhost:4173/';
const DOCS = 'docs/screenshots/';
const PLAY = 'branding/play/screenshots/';
// Wednesday 7 October 2026, 09:00 in Madeira.
const NOW = new Date('2026-10-07T08:00:00Z');
const only = process.argv[2];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const TILES = /^https:\/\/(tiles\.openfreemap\.org|server\.arcgisonline\.com|s3\.amazonaws\.com)\//;

async function newPage(options, { demo = false } = {}) {
  const ctx = await browser.newContext({
    timezoneId: 'Atlantic/Madeira',
    geolocation: { latitude: 32.6475, longitude: -16.9065 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
    ...options,
  });
  if (process.env.RELAY_TILES) {
    await ctx.route(TILES, async (route) => {
      try {
        const r = await fetch(route.request().url());
        await route.fulfill({
          status: r.status,
          body: Buffer.from(await r.arrayBuffer()),
          headers: {
            'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
            'access-control-allow-origin': '*',
          },
        });
      } catch {
        await route.abort();
      }
    });
  }
  if (demo) {
    // The whole-island demo network instead of the real timetable.
    await ctx.addInitScript(() => {
      const key = 'madeirabus.settings.v1';
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...stored, dataset: 'demo' }));
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  // The clock starts at NOW and runs: the map draws and a simulated ride moves.
  await page.clock.install({ time: NOW });
  return page;
}

/** Waits for the map and the panel to settle, then saves PNG or WebP. */
async function shot(page, path, settle = 2500) {
  await page.waitForTimeout(settle);
  const png = await page.screenshot();
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  if (path.endsWith('.webp')) {
    execFileSync('convert', ['png:-', '-quality', '80', '-define', 'webp:method=6', path], {
      input: png,
    });
  } else {
    // Google Play takes JPEG; no transparency.
    execFileSync('convert', ['png:-', '-quality', '90', path], { input: png });
  }
  console.log(path);
}

async function open(page, hash = '') {
  await page.goto(BASE + hash);
  await page.waitForSelector('.panel .view-title, .plan', { timeout: 30000 });
  // The note about operators still to come is the same on every screen.
  const note = page.locator('.banner--info button');
  if (await note.count()) await note.first().click();
}

/** The tour of the real timetable, in the given language. */
async function realTour(page, out, ext, words) {
  await open(page);
  await shot(page, out + `home.${ext}`);

  await page.locator('a[href="#/explore"]').first().click();
  await page.waitForSelector('.scenic-list');
  await shot(page, out + `scenic.${ext}`);
  await page.locator('.scenic-list a', { hasText: 'Curral das Freiras' }).click();
  await page.waitForSelector('.ride-timetable');
  await shot(page, out + `scenic-place.${ext}`);
  await page.locator('.it-card').first().click();
  await page.waitForSelector('.day-timetable');
  await shot(page, out + `itinerary.${ext}`);
  await page.locator('.day-timetable').first().scrollIntoViewIfNeeded();
  await shot(page, out + `day-timetable.${ext}`);

  await page.getByRole('button', { name: words.simulate }).click();
  await page.waitForSelector('.trip__status');
  await page.waitForSelector('.trip__status--prepare, .trip__status--next', { timeout: 300000 });
  await shot(page, out + `trip.${ext}`, 600);
  await page.getByRole('button', { name: words.end }).first().click();

  await open(page, '#/lines');
  await page.waitForSelector('.line-tile');
  await shot(page, out + `lines.${ext}`);
  await page.getByRole('button', { name: /^110\b/ }).click();
  await page.waitForSelector('.line-hero');
  await shot(page, out + `line.${ext}`);
}

if (only !== 'play') {
  const phone = { ...devices['Pixel 7'], locale: 'uk-UA' };
  await realTour(await newPage(phone), DOCS, 'webp', {
    simulate: 'Симуляція',
    end: 'Завершити',
  });

  // The printable timetable of line 110, first page.
  const p = await newPage({ ...phone, acceptDownloads: true });
  await open(p, '#/lines?q=110');
  await p.getByRole('button', { name: /^110\b/ }).click();
  const [download] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: 'Завантажити PDF' }).click(),
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  execFileSync('pdftoppm', [
    '-png',
    '-r',
    '110',
    '-f',
    '1',
    '-l',
    '1',
    await download.path(),
    join(dir, 'page'),
  ]);
  const page1 = readFileSync(join(dir, 'page-1.png'));
  execFileSync('convert', ['png:-', '-quality', '80', DOCS + 'timetable-pdf.webp'], {
    input: page1,
  });
  console.log(DOCS + 'timetable-pdf.webp');

  // The whole-island demo network: transfers, map layers, the computer.
  const demo = await newPage(phone, { demo: true });
  await open(demo);
  await demo.locator('.chips .chip').first().click();
  await demo.waitForSelector('.it-card');
  await shot(demo, DOCS + 'demo-results.webp');
  await demo.getByRole('button', { name: 'Шари карти' }).click();
  await demo.getByRole('checkbox', { name: /3D-гори/ }).check();
  await demo.locator('.view-title, .plan__form').first().click();
  await shot(demo, DOCS + 'terrain3d.webp', 6000);

  const desk = await newPage(
    { viewport: { width: 1440, height: 900 }, locale: 'uk-UA' },
    { demo: true },
  );
  await open(desk);
  await desk.locator('.chips .chip').nth(1).click();
  await desk.waitForSelector('.it-card');
  await desk.locator('.it-card').first().click();
  await desk.waitForSelector('.timeline');
  await shot(desk, DOCS + 'desktop.webp');
}

if (only !== 'docs') {
  // Google Play: 1080×2160 (2:1), no transparency.
  const phone = {
    viewport: { width: 360, height: 720 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-GB',
  };
  await realTour(await newPage(phone), PLAY, 'jpg', { simulate: 'Simulate', end: 'End' });
}

await browser.close();
console.log('done');
