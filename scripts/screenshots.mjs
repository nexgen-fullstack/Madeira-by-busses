import { chromium, devices } from '@playwright/test';
const BASE = 'http://localhost:4173/';
const OUT = 'docs/screenshots/';
// Run against `pnpm preview` (port 4173). Set CHROMIUM_PATH to use a pre-installed browser.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({
  ...devices['Pixel 7'],
  locale: 'uk-UA',
  timezoneId: 'Atlantic/Madeira',
  geolocation: { latitude: 32.6475, longitude: -16.9065 },
  permissions: ['geolocation'],
  serviceWorkers: 'block',
});
// RELAY_TILES=1: fetch elevation tiles from Node (for sandboxes where the browser has no network).
async function relayTiles(context) {
  if (!process.env.RELAY_TILES) return;
  await context.route('https://s3.amazonaws.com/**', async (route) => {
    try {
      const r = await fetch(route.request().url());
      await route.fulfill({
        status: r.status,
        body: Buffer.from(await r.arrayBuffer()),
        headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' },
      });
    } catch {
      await route.abort();
    }
  });
}
// The tour below shows the whole-island demo network; real data comes last.
async function pinDemo(context) {
  await context.addInitScript(() => {
    const key = 'madeirabus.settings.v1';
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...stored, dataset: stored.dataset ?? 'demo' }));
  });
}
await relayTiles(ctx);
await pinDemo(ctx);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
await page.goto(BASE);
await page.waitForSelector('.plan');
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + 'plan-empty.png' });
await page.locator('.chip').first().click();
await page.waitForSelector('.it-card');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'plan-results.png' });
await page.locator('.it-card').first().click();
await page.waitForSelector('.timeline');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'itinerary.png' });
await page.locator('.panel').evaluate((el) => el.scrollBy(0, 700));
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + 'itinerary-fares.png' });
// Trip simulation on a longer ride: Funchal → Santana.
await page.goto(BASE + '#/plan');
await page.locator('.chip').nth(1).click();
await page.waitForSelector('.it-card');
await page.locator('.it-card').first().click();
await page.waitForSelector('.timeline');
await page.getByRole('button', { name: 'Симуляція' }).click();
await page.waitForSelector('.trip__status');
await page.waitForTimeout(6000);
await page.screenshot({ path: OUT + 'trip.png' });
await page.waitForSelector('.trip__status--prepare, .trip__status--next', { timeout: 240000 });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 'trip-prepare.png' });
await page.getByRole('button', { name: 'Показати водієві' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 'driver.png' });
await page.locator('.driver').click();
await page.getByRole('button', { name: 'Завершити' }).first().click();
await page.goto(BASE + '#/lines');
await page.waitForSelector('.line-list');
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + 'lines.png' });
await page.getByRole('button', { name: /D139/ }).click();
await page.waitForSelector('.timetable');
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + 'line-detail.png' });
await page.getByRole('button', { name: 'Шари карти' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + 'layers.png' });
await page.getByRole('checkbox', { name: /3D-гори/ }).check();
await page.locator('.view-title').click();
await page.waitForTimeout(5000);
await page.screenshot({ path: OUT + 'terrain3d.png' });
await page.getByRole('button', { name: 'Шари карти' }).click();
await page.getByRole('checkbox', { name: /3D-гори/ }).uncheck();
await page.locator('.view-title').click();
await page.goto(BASE + '#/nearby');
await page.waitForSelector('.departures');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'nearby.png' });

const desk = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'uk-UA',
  timezoneId: 'Atlantic/Madeira',
  serviceWorkers: 'block',
});
await relayTiles(desk);
await pinDemo(desk);
const d = await desk.newPage();
await d.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
await d.goto(BASE);
await d.waitForSelector('.chip');
await d.locator('.chip').nth(1).click();
await d.waitForSelector('.it-card');
await d.locator('.it-card').first().click();
await d.waitForSelector('.timeline');
await d.waitForTimeout(2500);
await d.screenshot({ path: OUT + 'desktop.png' });

// Real Horários do Funchal timetable (needs `pnpm data:real` before the build).
const real = await browser.newContext({
  ...devices['Pixel 7'],
  locale: 'uk-UA',
  timezoneId: 'Atlantic/Madeira',
  serviceWorkers: 'block',
});
await relayTiles(real);
const r = await real.newPage();
await r.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
await r.goto(BASE);
await r.waitForSelector('.plan');
await r.getByRole('button', { name: /Igreja Curral das Freiras/ }).click();
await r.waitForSelector('.it-card');
await r.locator('.it-card').first().click();
await r.waitForSelector('.timeline');
await r.waitForTimeout(2500);
await r.screenshot({ path: OUT + 'real-itinerary.png' });
await r.goto(BASE + '#/lines');
await r.waitForSelector('.line-list');
await r.waitForTimeout(1500);
await r.screenshot({ path: OUT + 'real-lines.png' });
await r.getByRole('button', { name: /^181\b/ }).click();
await r.waitForSelector('.timetable');
await r.waitForTimeout(2500);
await r.screenshot({ path: OUT + 'real-line.png' });
await browser.close();
console.log('done');
