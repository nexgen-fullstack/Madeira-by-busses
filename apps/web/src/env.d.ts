/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Published timetable the phone app checks for updates (see lib/data.ts). */
  readonly VITE_REMOTE_DATA?: string;
  /** Android app download link shown on the website. */
  readonly VITE_ANDROID_APK?: string;
  readonly VITE_SATELLITE_TILES?: string;
  readonly VITE_SATELLITE_ATTRIBUTION?: string;
}

/** generatedAt of the timetable built into this version of the app ('' when none). */
declare const __BUNDLED_DATA__: string;
