// Renders the PWA PNG icons and the Android launcher icons (for Android 7,
// which has no adaptive icons) from public/icon.svg with headless Chromium.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../apps/web/public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function render(size, path, round = false) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const clip = round ? 'clip-path:circle(50%);' : '';
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block;${clip}}</style>${svg}`,
  );
  await page.screenshot({ path: new URL(path, import.meta.url).pathname, omitBackground: true });
  await page.close();
}

for (const size of [192, 512]) await render(size, `../apps/web/public/icon-${size}.png`);

const res = '../apps/mobile/android/app/src/main/res';
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  await render(size, `${res}/mipmap-${density}/ic_launcher.png`);
  await render(size, `${res}/mipmap-${density}/ic_launcher_round.png`, true);
}
await browser.close();
console.log('Icons rendered');
