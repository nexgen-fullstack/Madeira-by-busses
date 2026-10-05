import { existsSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** When the timetable built into the app was generated (the phone app compares downloads with it). */
function bundledData(): string {
  const path = new URL('public/data/network.json', import.meta.url);
  if (!existsSync(path)) return '';
  const head = readFileSync(path, 'utf8').slice(0, 400);
  return /"generatedAt":"([^"]+)"/.exec(head)?.[1] ?? '';
}

export default defineConfig({
  // Relative base: the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  define: { __BUNDLED_DATA__: JSON.stringify(bundledData()) },
  worker: { format: 'es' },
  // The map library is a single ~1 MB chunk that loads lazily after the UI.
  build: { chunkSizeWarningLimit: 1100 },
  plugins: [
    react(),
    VitePWA({
      // Updates wait for a quiet moment (see src/lib/pwa.ts).
      registerType: 'prompt',
      includeAssets: ['favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Madeira by busses',
        short_name: 'Madeira by busses',
        description:
          'Explore Madeira with ease: routes with transfers, fares, timetables and GPS get-off alerts for the Madeira buses.',
        lang: 'uk',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#002F85',
        background_color: '#F3F7FC',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Photos of the scenic trips and the fonts of printable timetables work offline too.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest,webp,ttf,bin}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Open elevation tiles for the relief layer: also available offline once seen.
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'terrain',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Basemap tiles, styles and fonts: cache what the user has seen for offline use.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
