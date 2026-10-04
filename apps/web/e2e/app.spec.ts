import { pinDemoData } from './demo.ts';
import { expect, test } from '@playwright/test';

// Wednesday 7 Oct 2026, 09:00 in Madeira (WEST = UTC+1). Demo data only.
test.beforeEach(async ({ page }) => {
  await pinDemoData(page);
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
});

test('plans a trip with transfers, fares and the last bus back', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Madeira by busses');
  await expect(page.getByRole('link', { name: 'Madeira by busses' })).toBeVisible();
  await expect(page.getByText(/Демо-дані/)).toBeVisible();
  await page.getByRole('button', { name: /Aeroporto da Madeira → Porto Moniz/ }).click();

  const best = page.locator('.it-card').first();
  await expect(best).toContainText('09:00 – 12:50');
  await expect(best).toContainText('2 пересадки');
  await best.click();

  await expect(page.locator('.timeline')).toContainText('Ribeira Brava');
  await expect(page.locator('.timeline')).toContainText('Очікування 30 хв');
  await expect(page.getByText('Останній автобус назад сьогодні — о 17:15')).toBeVisible();
  await expect(page.getByText(/Найвигідніше: туристичний на 1 день/)).toBeVisible();
});

test('the simulated ride warns before the stop and arrives', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Mercado dos Lavradores → Monte/ }).click();
  await page.locator('.it-card').first().click();
  await page.getByRole('button', { name: 'Симуляція' }).click();

  await expect(page.locator('.trip__status--next')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Виходьте на наступній!')).toBeVisible();
  await page.getByRole('button', { name: 'Показати водієві' }).click();
  await expect(page.locator('.driver__stop')).toHaveText('Monte');
  await page.locator('.driver').click();
  await expect(page.getByText(/Поїздку завершено/)).toBeVisible({ timeout: 90_000 });
});

test('shows a line timetable and switches language', async ({ page }) => {
  await page.goto('./#/lines');
  await page.getByRole('button', { name: /D139/ }).click();
  await expect(page.locator('.timetable')).toContainText('08');
  await page.getByRole('link', { name: 'Налаштування' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('finds places by their name in the reader’s language', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Куди' }).fill('аеропорт');
  const option = page.getByRole('option', { name: /Аеропорт Мадейри/ });
  await expect(option).toContainText('Аеропорт');
  await option.click();
  await page.getByRole('combobox', { name: 'Звідки' }).fill('Funchal (Av');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: 'Куди' })).toHaveValue('Аеропорт Мадейри');
  await expect(page.locator('.it-card').first()).toContainText('09:00 – 09:44');
});
