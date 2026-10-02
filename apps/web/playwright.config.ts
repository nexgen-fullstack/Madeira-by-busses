import { defineConfig, devices } from '@playwright/test';

/** End-to-end tests against the production build (`pnpm build` first). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    locale: 'uk-UA',
    timezoneId: 'Atlantic/Madeira',
    trace: 'retain-on-failure',
    // Use a pre-installed Chromium when provided (e.g. in sandboxes without downloads).
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
});
