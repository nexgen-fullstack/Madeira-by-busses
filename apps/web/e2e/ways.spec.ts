import { expect, test } from '@playwright/test';
import { pinDemoData, raiseSheet } from './demo.ts';

// Wednesday 7 Oct 2026, 09:00 in Madeira. Demo data: its timetable never changes.
test.beforeEach(async ({ page }) => {
  await pinDemoData(page);
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
});

test('by bus, or on foot or by bike beside it, as in a maps app', async ({ page }) => {
  await page.goto('./');
  await raiseSheet(page);
  await page.getByRole('combobox', { name: 'Куди' }).fill('Monte');
  await page.getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'Звідки' }).fill('Funchal (Av');
  await page.getByRole('option').first().click();
  // The row of ways, the bus chosen and its options listed.
  const modes = page.getByRole('group', { name: 'Як їхати' });
  await expect(modes.getByRole('button', { name: /^Автобус: / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.it-card').first()).toBeVisible();
  // On foot along the streets: its time, distance and climb, and Google Maps to follow it.
  await modes.getByRole('button', { name: /^Пішки: \d/ }).click();
  await expect(page).toHaveURL(/m=walk/);
  const card = page.locator('.travel--walk');
  await expect(card).toContainText(/\d км/);
  await expect(card.getByRole('link', { name: 'Навігація в Google Maps' })).toHaveAttribute(
    'href',
    /travelmode=walking/,
  );
  await expect(page.locator('.it-card')).toHaveCount(0);
  // By bike, then back to the bus.
  await modes.getByRole('button', { name: /^Велосипед: / }).click();
  await expect(page.locator('.travel--bike')).toBeVisible();
  await modes.getByRole('button', { name: /^Автобус: / }).click();
  await expect(page.locator('.it-card').first()).toBeVisible();
});

test('the hiking trails: by kind and region, each with its buses, on the map', async ({ page }) => {
  await page.goto('./#/hikes');
  await raiseSheet(page);
  await expect(page.getByRole('heading', { name: 'Піші стежки й левади' })).toBeVisible();
  await expect.poll(() => page.locator('.trail-card').count()).toBeGreaterThan(50);
  // The official PR trails only, with their red and yellow plates.
  await page.getByRole('button', { name: 'Офіційні PR' }).click();
  await expect(page.locator('.trail-card .trail-badge--pr').first()).toBeVisible();
  expect(await page.locator('.trail-card').count()).toBe(
    await page.locator('.trail-card .trail-badge--pr').count(),
  );
  // The walk to the tip of the island: its facts, the bus at its start, back the same way.
  await page.locator('.trail-card', { hasText: 'Ponta de São Lourenço' }).click();
  await expect(page).toHaveURL(/#\/hikes\/pr8$/);
  await expect(page.locator('.hike__facts')).toContainText('Довжина');
  await expect(page.locator('.hike-stop').first()).toContainText('Початок');
  await expect(page.locator('.hike__back')).toContainText('назад тим самим шляхом');
  // Its photo over its name, and the places with a view on it: a tap shows one on the map.
  await expect(page.locator('.hike__hero img')).toBeVisible();
  const view = page.locator('.hike-view').first();
  await view.click();
  await expect(page.locator('.map-spot__name')).toHaveText(
    (await view.locator('.hike-view__name').textContent())!,
  );
  await expect(page.locator('.hike .destination__credit')).toContainText('Фото:');
  await page.locator('.hike .destination__back').click();
  await expect(page).toHaveURL(/#\/hikes$/);
  // The trails on the map from any screen, by their button.
  await page.getByRole('link', { name: 'Маршрут' }).click();
  const button = page.getByRole('button', { name: 'Піші стежки' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // The settings are a gear at the top now.
  await page.getByRole('link', { name: 'Налаштування' }).click();
  await expect(page).toHaveURL(/#\/settings/);
});
