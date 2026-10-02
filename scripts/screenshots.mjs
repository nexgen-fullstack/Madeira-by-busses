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
});
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
await page.goto(BASE + '#/nearby');
await page.waitForSelector('.departures');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + 'nearby.png' });

const desk = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'uk-UA',
  timezoneId: 'Atlantic/Madeira',
});
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
await browser.close();
console.log('done');
