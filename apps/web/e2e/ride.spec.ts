import { allowSimulation, pinDemoData } from './demo.ts';
import { expect, test } from '@playwright/test';

// A clock that only moves when told to: Wednesday 7 Oct 2026, 08:59:30 in
// Madeira, half a minute before the 09:00 bus the test rides.
test.beforeEach(async ({ page }) => {
  await pinDemoData(page);
  await page.clock.install({ time: new Date('2026-10-07T07:58:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T07:59:30Z'));
});

test('the ride keeps being followed on other screens', async ({ page }) => {
  await allowSimulation(page);
  await page.goto('./');
  await page.getByRole('button', { name: /Funchal \(Avenida.* → Santana/ }).click();
  await page.locator('.it-card').first().click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.locator('.trip__header')).toBeVisible();

  // Look at the lines for 100 s: 33 minutes of the 20× simulation.
  await page.getByRole('link', { name: 'Лінії' }).click();
  await expect(page.locator('.chip--live')).toBeVisible();
  await page.clock.runFor(100_000);
  await page.locator('.chip--live').click();

  // Past Funchal, Garajau and Caniço: the ride went on, it did not restart.
  await expect(page.locator('.trip__stops li.is-passed')).toHaveCount(3);
});
