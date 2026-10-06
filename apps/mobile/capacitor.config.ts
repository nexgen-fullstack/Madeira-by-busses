import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Madeira by busses phone app: the website's build (apps/web, `--mode app`) inside a
 * native shell, which adds GPS with the screen off, notifications and
 * reminders. Build: `pnpm --filter @madeirabus/mobile build`, then Android
 * Studio or `./gradlew assembleRelease` in android/.
 */
const config: CapacitorConfig = {
  appId: 'io.github.nexgenfullstack.madeirabus',
  appName: 'Madeira by busses',
  webDir: '../web/dist',
  // The splash screen's colour behind the page while it loads: no white flash before the logo.
  backgroundColor: '#0056C7',
  android: {
    // Map tiles and the timetable update come over https only.
    allowMixedContent: false,
    // A build to look inside on a phone (chrome://inspect): MADEIRABUS_DEBUG=1.
    webContentsDebuggingEnabled: process.env.MADEIRABUS_DEBUG === '1',
  },
  plugins: {
    SplashScreen: {
      // Android's splash goes as soon as the page draws; the page's own launch screen
      // (the large logo, apps/web/index.html) takes over until the map is ready.
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#0056C7',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_bus',
      iconColor: '#0066DD',
    },
    // Android 15+ draws the app edge to edge; the page pads itself with the
    // safe-area insets and the bar icons follow the light/dark theme.
    SystemBars: {
      insetsHandling: 'css',
    },
  },
};

export default config;
