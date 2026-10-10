import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { raiseSheet } from './demo.ts';

// Runs only when the build includes the real Horários do Funchal timetable
// (`pnpm data:real` before `pnpm build`), which changes with every release.
test.skip(!existsSync('dist/data/network.json'), 'no real timetable in this build');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
});

test('real timetable: every line, journey, grouped lines and the demo switch', async ({ page }) => {
  await page.goto('./');
  // The whole island's timetable takes a while to read on a slow machine.
  await raiseSheet(page, 20_000);
  await expect(page.locator('.plan__form')).toBeVisible();
  // Every line of CAM and SIGA Rodoeste is in the app: no notice of missing ones.
  await expect(page.getByText(/ще немає/)).toHaveCount(0);

  await page
    .getByRole('button', { name: /Avenida Mar Alfândega → Igreja Curral das Freiras/ })
    .click();
  // Curral das Freiras is served by line 181, the number on the bus since 2026 (it was 81).
  const badge = page.locator('.it-card').first().locator('.route-badge').first();
  await expect(badge).toHaveText('181');

  await page.getByRole('link', { name: 'Лінії' }).click();
  const tile = page.getByRole('button', { name: /^181\b/ });
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText('раніше 81');
  // The express to Ribeira Brava (Rodoeste) and the Camacha – Calheta line (CAM).
  await expect(page.getByRole('button', { name: /^200\b/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^994\b/ })).toHaveCount(1);
  await tile.click();
  await expect(page.getByRole('group', { name: 'Напрямок' })).toBeVisible();
  await expect(page.locator('.stop-line li').first()).toBeVisible();

  await page.getByRole('link', { name: 'Налаштування' }).click();
  await page.getByRole('button', { name: 'Демо', exact: true }).click();
  await expect(page.locator('.badge--demo').first()).toBeVisible();
  await page.getByRole('button', { name: 'Справжній' }).click();
  await expect(page.locator('.badge--demo')).toHaveCount(0);
});

test('the 110 that was the 10A, with its late short runs', async ({ page }) => {
  // Saturday 3 October 2026: a 110 left Avenida do Mar at 21:30 for Barreira only.
  await page.goto('./#/lines?q=10a');
  const tile = page.getByRole('button', { name: /^110\b/ });
  await expect(tile).toContainText('раніше 10A');
  await tile.click();
  await expect(page.locator('.line-hero__number')).toHaveText('110');
  await page.getByLabel('Дата').fill('2026-10-03');
  const evening = page
    .locator('.ways__row')
    .filter({ has: page.locator('.ways__hour', { hasText: '21' }) });
  await expect(evening).toContainText('30a');
  await expect(page.locator('.legend')).toContainText('Caminho Barreira');
});
