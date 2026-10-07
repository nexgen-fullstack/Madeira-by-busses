import type { Page } from '@playwright/test';

/**
 * These tests describe the invented demo network, whose timetable never
 * changes; make the app load it even when the build also has the real one.
 */
export async function pinDemoData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'madeirabus.settings.v1';
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as { dataset?: string };
    localStorage.setItem(key, JSON.stringify({ ...stored, dataset: stored.dataset ?? 'demo' }));
  });
}

/**
 * On a phone the screen is a sheet over the whole map: down to its handle when the app
 * opens, a way is chosen or a ride follows it. Pulls it up to half the map when it is down.
 */
export async function raiseSheet(page: Page, timeout?: number): Promise<void> {
  await page.locator('.sheet-handle').waitFor({ timeout });
  if ((await page.locator('.panel--min').count()) === 0) return;
  await page.locator('.panel--min .sheet-handle').click();
  await page.locator('.panel--min').waitFor({ state: 'detached' });
}

/**
 * The simulated ride is for developers and these tests only: a production build offers
 * it once this key is set (the phone app never does).
 */
export async function allowSimulation(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('madeirabus.simulator', '1'));
}
