import { pinDemoData } from './demo.ts';
import { expect, test } from '@playwright/test';

// Wednesday 7 Oct 2026, 09:00 in Madeira. Demo data only.
test.beforeEach(async ({ page, context }) => {
  await pinDemoData(page);
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 32.6487, longitude: -16.9036 });
});

test('speaks French', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('link', { name: 'Itinéraire' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
  await page.getByRole('link', { name: 'Itinéraire' }).click();
  await page.getByRole('combobox', { name: 'Arrivée' }).fill('aéroport');
  await expect(page.getByRole('option', { name: /Aéroport de Madère/ })).toBeVisible();
});

test('remembers recent trips', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Mercado dos Lavradores → Monte/ }).click();
  await expect(page.locator('.it-card').first()).toBeVisible();
  await page.goto('./#/plan');
  await expect(page.getByText('Нещодавні поїздки')).toBeVisible();
  const chips = page.getByRole('button', { name: /Mercado dos Lavradores → Monte/ });
  await expect(chips).toHaveCount(2); // the recent one and the suggestion
  await chips.first().click();
  await expect(page.locator('.it-card').first()).toBeVisible();
});

test('saved stops show their departures nearby and in the search', async ({ page }) => {
  await page.goto('./#/lines');
  await page.getByRole('button', { name: /D139/ }).click();
  await page.locator('.stop-line li button').first().click();
  const name = (await page.locator('.stop-view .view-title').textContent())!;
  await page.getByRole('button', { name: 'Зберегти зупинку' }).click();
  await expect(page.getByRole('button', { name: 'Прибрати зі збережених' })).toBeVisible();

  await page.getByRole('link', { name: 'Поруч' }).click();
  await expect(page.getByRole('heading', { name: 'Збережені зупинки' })).toBeVisible();
  await expect(page.locator('.nearby .card').first()).toContainText(name);

  await page.getByRole('link', { name: 'Маршрут' }).click();
  await page.getByRole('combobox', { name: 'Звідки' }).focus();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.getByRole('combobox', { name: 'Звідки' })).toHaveValue(name);
});

test('a ride survives closing the app', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Mercado dos Lavradores → Monte/ }).click();
  await page.locator('.it-card').first().click();
  await page.getByRole('button', { name: 'Почати поїздку' }).click();
  await expect(page.locator('.trip__header')).toBeVisible();
  await page.reload();
  await expect(page.locator('.trip__header')).toBeVisible();
  await page.getByRole('link', { name: 'Лінії' }).click();
  await expect(page.locator('.chip--live')).toBeVisible();
  await page.locator('.chip--live').click();
  await page.getByRole('button', { name: 'Завершити' }).click();
  await expect(page.locator('.chip--live')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.chip--live')).toHaveCount(0);
});

test('back from a shared link stays in the app', async ({ page }) => {
  await page.goto('./#/stop?ids=0');
  await expect(page.locator('.stop-view')).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page).toHaveURL(/#\/nearby/);
  await expect(page.getByRole('heading', { name: 'Відправлення поруч' })).toBeVisible();
});
