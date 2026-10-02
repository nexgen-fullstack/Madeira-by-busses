// Renders the PWA PNG icons from public/icon.svg with headless Chromium.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../apps/web/public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  );
  await page.screenshot({
    path: new URL(`../apps/web/public/icon-${size}.png`, import.meta.url).pathname,
    omitBackground: true,
  });
  await page.close();
}
await browser.close();
console.log('Icons rendered');
