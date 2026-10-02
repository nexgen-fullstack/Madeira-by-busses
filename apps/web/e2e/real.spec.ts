import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Runs only when the build includes the real Horários do Funchal timetable
// (`pnpm data:real` before `pnpm build`), which changes with every release.
test.skip(!existsSync('dist/data/network.json'), 'no real timetable in this build');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
});

test('real timetable: notice, journey, grouped lines and the demo switch', async ({ page }) => {
  await page.goto('./');
  const notice = page.locator('.banner--info');
  await expect(notice).toContainText('Ще не додано: CAM, SIGA Rodoeste');
  await notice.getByRole('button', { name: 'Закрити' }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.locator('.plan__form')).toBeVisible();
  await expect(notice).toBeHidden();

  await page
    .getByRole('button', { name: /Avenida Mar Alfândega → Igreja Curral das Freiras/ })
    .click();
  await expect(page.locator('.it-card').first()).toContainText('181');

  await page.getByRole('link', { name: 'Лінії' }).click();
  await expect(page.getByRole('button', { name: /^181\b/ })).toHaveCount(1);
  await page.getByRole('button', { name: /^181\b/ }).click();
  await expect(page.getByRole('combobox', { name: 'Напрямок' })).toBeVisible();
  await expect(page.locator('.stop-line li').first()).toBeVisible();

  await page.getByRole('link', { name: 'Налаштування' }).click();
  await page.getByRole('button', { name: 'Демо', exact: true }).click();
  await expect(page.locator('.badge--demo').first()).toBeVisible();
  await page.getByRole('button', { name: 'Справжній' }).click();
  await expect(page.locator('.badge--demo')).toHaveCount(0);
});
