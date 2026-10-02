import { pinDemoData } from './demo.ts';
import { expect, test, type Page } from '@playwright/test';

// A 1×1 PNG used for imagery tiles.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGeoBwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Liberty-like style with places and 3D buildings; tiles themselves are not served. */
const STYLE = {
  version: 8,
  glyphs: 'https://tiles.test/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: { type: 'vector', tiles: ['https://tiles.test/{z}/{x}/{y}.pbf'], maxzoom: 14 },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
    },
    {
      id: 'poi',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      layout: { 'text-field': '{name}' },
    },
  ],
};

async function stubMapServers(page: Page) {
  // Keep the service worker out of the way so routes see every request.
  await page.context().route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://tiles.openfreemap.org/styles/'))
      return route.fulfill({ json: STYLE });
    if (url.startsWith('https://server.arcgisonline.com/'))
      return route.fulfill({ body: PNG, contentType: 'image/png' });
    if (url.startsWith('https://')) return route.abort();
    return route.continue();
  });
}

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await pinDemoData(page);
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
  await stubMapServers(page);
});

test('switches map layers and remembers them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/lines');
  await page.getByRole('button', { name: 'Шари карти' }).click();
  await page.getByRole('radio', { name: 'Супутник' }).click();
  await page.getByRole('checkbox', { name: /3D-будинки/ }).check();
  await page.getByRole('checkbox', { name: /Місця й установи/ }).uncheck();
  await expect(page.getByRole('radio', { name: 'Супутник' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.waitForTimeout(1500);

  await page.reload();
  await page.getByRole('button', { name: 'Шари карти' }).click();
  await expect(page.getByRole('radio', { name: 'Супутник' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('checkbox', { name: /3D-будинки/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Місця й установи/ })).not.toBeChecked();

  await page.getByRole('radio', { name: 'Рельєф' }).click();
  await page.getByRole('checkbox', { name: /3D-гори/ }).check();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('a dropped pin becomes the destination', async ({ page }) => {
  await page.goto('./#/plan');
  await page.waitForSelector('.map-canvas canvas');
  await page.waitForTimeout(1000);
  await page.locator('.map-canvas canvas').click({ button: 'right', position: { x: 160, y: 140 } });
  const card = page.getByRole('dialog', { name: 'Точка на карті' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Маршрут сюди' }).click();
  await expect(page).toHaveURL(/to=p%3A/);
  await expect(page.getByRole('combobox', { name: 'Куди' })).toHaveValue('Точка на карті');
});
