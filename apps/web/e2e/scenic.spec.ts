import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { pinDemoData } from './demo.ts';

// Wednesday 7 Oct 2026, 09:00 in Madeira. Demo data: its timetable never changes.
test.beforeEach(async ({ page }) => {
  await pinDemoData(page);
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
});

test('a scenic place plans the trip and shows every bus of the day', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Краєвиди' }).click();
  await expect(
    page.getByRole('heading', { name: 'Популярні маршрути з гарними краєвидами' }),
  ).toBeVisible();
  const card = page.getByRole('link', { name: /Curral das Freiras/ });
  await expect(card).toContainText('Долина черниць');
  await expect(card.locator('.route-badge')).toHaveText('D81');
  await card.click();

  await expect(page.getByRole('heading', { name: 'Curral das Freiras' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Фото: Diego Delso, CC BY-SA 4.0' })).toHaveAttribute(
    'href',
    /commons\.wikimedia\.org/,
  );
  // The whole day there and back, first bus to last.
  const there = page.locator('.ride-timetable').first();
  await expect(there).toContainText('Туди');
  await expect(there.locator('.first-last')).toContainText(
    'Перший о 07:30 · останній о 19:30 · 7 автобусів',
  );
  await expect(page.locator('.ride-timetable').filter({ hasText: 'Назад' })).toHaveCount(1);

  // The next bus from the centre is the 09:30; its day timetable marks it.
  const first = page.locator('.it-card').first();
  await expect(first).toContainText('D81');
  await first.click();
  await expect(page.locator('.day-timetable .is-chosen')).toHaveText('30');
  await expect(page.locator('.day-timetable').getByText('Назад')).toBeVisible();
});

test('walks along the sea: listed by the places with a view, then the walk first', async ({
  page,
}) => {
  await page.goto('./#/explore');
  await expect(page.getByRole('heading', { name: 'Прогулянки з краєвидами' })).toBeVisible();
  // The places by region, a place without a photo yet among them.
  await expect(page.getByRole('heading', { name: 'Північне узбережжя' })).toBeVisible();
  // Measured along the streets, with the climb: Marina do Funchal to the Old Town's fort.
  const walk = page.locator('.walk-card').filter({ hasText: 'Forte de São Tiago' });
  await expect(walk).toContainText(/\d+ хв пішки · 1,2 км/);
  await walk.click();
  // In the planner the walk along Avenida do Mar is a way of its own, the best one here.
  const first = page.locator('.it-card').first();
  await expect(first).toContainText('Пішки з краєвидами');
  await first.click();
  await expect(page.locator('.walk-note--view')).toHaveText('Гарні краєвиди по дорозі');
});

test('the planner’s start screen suggests places with a view', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Гарні краєвиди' })).toBeVisible();
  await page.locator('.scenic-strip').getByRole('link', { name: /Monte/ }).click();
  await expect(page.getByRole('heading', { name: 'Monte' })).toBeVisible();
});

test('finds a line by its number and downloads its timetable as a PDF', async ({ page }) => {
  await page.goto('./#/lines');
  await page.getByRole('searchbox', { name: 'Номер або назва лінії' }).fill('d8');
  // D81 (Horários do Funchal) and D80 (Rodoeste), each under its operator.
  await expect(page.locator('.line-tile')).toHaveText([/^D81/, /^D80/]);
  await page.getByRole('button', { name: /^D81/ }).click();

  await expect(page.locator('.first-last')).toContainText('Перший о 07:30 · останній о 19:30');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Завантажити PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Madeira-by-busses-D81-.+\.pdf$/);
  const file = readFileSync((await download.path())!);
  expect(file.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
  await expect(page.getByRole('status')).toHaveText('PDF збережено');
});
