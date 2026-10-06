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
 * The simulated ride is for developers and these tests only: a production build offers
 * it once this key is set (the phone app never does).
 */
export async function allowSimulation(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('madeirabus.simulator', '1'));
}
