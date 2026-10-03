import type { CapacitorConfig } from '@capacitor/cli';

/**
 * MadeiraBus phone app: the website's build (apps/web, `--mode app`) inside a
 * native shell, which adds GPS with the screen off, notifications and
 * reminders. Build: `pnpm --filter @madeirabus/mobile build`, then Android
 * Studio or `./gradlew assembleRelease` in android/.
 */
const config: CapacitorConfig = {
  appId: 'io.github.nexgenfullstack.madeirabus',
  appName: 'MadeiraBus',
  webDir: '../web/dist',
  backgroundColor: '#F6F7F9',
  android: {
    // Map tiles and the timetable update come over https only.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#0E7C66',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_bus',
      iconColor: '#0E7C66',
    },
    // Android 15+ draws the app edge to edge; the page pads itself with the
    // safe-area insets and the bar icons follow the light/dark theme.
    SystemBars: {
      insetsHandling: 'css',
    },
  },
};

export default config;
