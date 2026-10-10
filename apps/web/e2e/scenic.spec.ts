import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { pinDemoData, raiseSheet } from './demo.ts';

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

  // Where you are is not known here: the trip starts in the centre, and says so.
  await expect(page.locator('.destination .plan__from input')).toHaveValue('Центр Фуншала');
  await expect(page.getByText(/Не знаю, де ви/)).toBeVisible();
  // The next bus from the centre is the 09:30; its day timetable marks it.
  const first = page.locator('.it-card').first();
  await expect(first).toContainText('D81');
  await first.click();
  // The way chosen on the whole map, its steps and timetable in the sheet.
  await raiseSheet(page);
  await expect(page.locator('.day-timetable .is-chosen')).toHaveText('30');
  await expect(page.locator('.day-timetable').getByText('Назад')).toBeVisible();
});

test('a place’s trip starts where you are, or at an address or a point chosen', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 32.6487, longitude: -16.9036 });
  await page.goto('./#/explore/curral');
  const from = page.locator('.destination .plan__from input');
  await expect(from).toHaveValue('Моє місцезнаходження');
  await expect(page.locator('.it-card').first()).toContainText('D81');
  // A house on a street instead.
  await from.fill('Rua da Carreira, 1');
  await page.locator('.destination .plan__from [role=option]').first().click();
  await expect(from).toHaveValue(/^Rua da Carreira \d+/);
  await expect(page).toHaveURL(/#\/explore\/curral\?from=p/);
  await expect(page.locator('.it-card').first()).toContainText('D81');
  // Or a point on the map: the pin starts at the start, and the place's page takes it.
  await page
    .locator('.destination .plan__from')
    .getByRole('button', { name: 'Вибрати на карті' })
    .click();
  await page.getByRole('button', { name: /Вибрати цю точку/ }).click();
  await expect(page).toHaveURL(/#\/explore\/curral\?from=p/);
  await expect(page.getByRole('heading', { name: 'Curral das Freiras' })).toBeVisible();
  // "To" is the place, and the trip turns round as in a maps app: back from the place.
  const to = page.locator('.destination .plan__to input');
  await expect(to).toHaveValue('Curral das Freiras');
  await page.locator('.destination').getByRole('button', { name: 'Поміняти місцями' }).click();
  await expect(from).toHaveValue('Curral das Freiras');
  await expect(to).not.toHaveValue('Curral das Freiras');
  await expect(to).not.toHaveValue('');
  await expect(page.locator('.it-card').first()).toContainText('D81');
});

test('walks along the sea: listed by the places with a view, then the walk first', async ({
  page,
}) => {
  await page.goto('./#/explore');
  await expect(page.getByRole('heading', { name: 'Прогулянки з краєвидами' })).toBeVisible();
  // The places by region.
  await expect(page.getByRole('heading', { name: 'Північне узбережжя' })).toBeVisible();
  // Measured along the streets, with the climb: Marina do Funchal to the Old Town's fort.
  const walk = page.locator('.walk-card').filter({ hasText: 'Forte de São Tiago' });
  await expect(walk).toContainText(/\d+ хв пішки · 1,2 км/);
  // On the photo of where it goes.
  await expect(walk.locator('.walk-card__photo')).toBeVisible();
  await walk.click();
  // In the planner the walk along Avenida do Mar is a way of its own, the best one here.
  const first = page.locator('.it-card').first();
  await expect(first).toContainText('Пішки з краєвидами');
  await first.click();
  await expect(page.locator('.walk-note--view')).toHaveText('Гарні краєвиди по дорозі');
});

test('the island opens with its places with a view by their photos; a tap opens one', async ({
  page,
}) => {
  await page.goto('./#/plan');
  await page.waitForSelector('.map-canvas canvas');
  // Each where it is; far out those that would crowd the others wait for a closer look.
  await expect(page.locator('.scenic-pin').first()).toBeVisible();
  const monte = page.locator('.scenic-pin[aria-label="Monte"]');
  await expect(monte.locator('.scenic-pin__photo')).toHaveCSS('background-image', /monte-sm\.webp/);
  await monte.click({ force: true });
  await expect(page.getByRole('heading', { name: 'Monte' })).toBeVisible();
  // A place page shows its trip on the map, not the photos.
  await expect(page.locator('.scenic-pin')).toHaveCount(0);
});

test('the planner’s start screen suggests places with a view', async ({ page }) => {
  await page.goto('./');
  await raiseSheet(page);
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

test('a place: Start on its photo, its lines by their numbers, back to the same spot in the list', async ({
  page,
}) => {
  await page.goto('./#/explore');
  const panel = page.locator('.panel');
  await panel.evaluate((el) => el.scrollTo({ top: 600 }));
  await page.getByRole('link', { name: /Curral das Freiras/ }).click();
  await expect(page.getByRole('heading', { name: 'Curral das Freiras' })).toBeVisible();
  // The photo's credit is at the end of the page, not on it; on it, a small "Start".
  await expect(page.locator('.destination__hero .destination__credit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Почати' }).click();
  // The best way there on the whole map, the sheet down to its handle.
  await expect(page).toHaveURL(/explore\/curral\?i=0/);
  await expect(page.locator('.panel--min')).toHaveCount(1);
  await page.goBack();

  // A line's number in the day's timetable opens the line from where it is boarded.
  await page.locator('.day-trips__line').first().click();
  await expect(page).toHaveURL(/#\/lines\/\d+\?s=\d+/);
  await expect(page.locator('.line-detail')).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).first().click();
  await expect(page).toHaveURL(/#\/explore\/curral/);

  // Back to the list where it was left.
  await page.locator('.destination__back').click();
  await expect(page).toHaveURL(/#\/explore$/);
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
});
