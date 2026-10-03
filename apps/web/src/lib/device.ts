import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';

/**
 * Phone features behind one interface: the browser APIs on the website and
 * the native plugins in the Android/iOS app (Capacitor). The native plugins
 * load lazily, so the website never downloads them.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/** True inside the Android/iOS app. */
export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function platform(): 'android' | 'ios' | 'web' {
  const p = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : 'web';
}

const TRIP_CHANNEL = 'trip';
let channelReady: Promise<void> | undefined;

async function nativeNotifications() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  channelReady ??= LocalNotifications.createChannel({
    id: TRIP_CHANNEL,
    name: 'Trip alerts',
    description: 'When to get off, transfers and reminders to leave',
    importance: 5,
    visibility: 1,
    vibration: true,
  }).catch(() => undefined);
  await channelReady;
  return LocalNotifications;
}

/** Whether notifications may be shown now, without asking. */
export async function canNotify(): Promise<boolean> {
  if (isNative()) {
    try {
      const n = await nativeNotifications();
      return (await n.checkPermissions()).display === 'granted';
    } catch {
      return false;
    }
  }
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** Asks for permission to show notifications; true when granted. */
export async function askNotify(): Promise<boolean> {
  if (isNative()) {
    try {
      const n = await nativeNotifications();
      return (await n.requestPermissions()).display === 'granted';
    } catch {
      return false;
    }
  }
  if (typeof Notification === 'undefined') return false;
  return (await Notification.requestPermission()) === 'granted';
}

let nextId = 1;

/**
 * Shows a notification right away. On the website it goes through the service
 * worker, the only way Android browsers allow; the same `tag` replaces the
 * previous one instead of stacking up.
 */
export async function notify(title: string, body: string, tag = 'madeirabus-trip'): Promise<void> {
  if (isNative()) {
    try {
      const n = await nativeNotifications();
      await n.schedule({
        notifications: [
          { id: nextId++, title, body, channelId: TRIP_CHANNEL, autoCancel: true, group: tag },
        ],
      });
    } catch {
      // Notifications turned off: the in-app alert and vibration still work.
    }
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body,
    tag,
    renotify: true,
    vibrate: [400, 150, 400, 150, 400],
    icon: 'icon-192.png',
    badge: 'icon-192.png',
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    // Some browsers refuse notifications in this state; the in-app alert remains.
  }
}

/** Schedules a notification for later (native app only); false on the website. */
export async function remind(at: Date, title: string, body: string): Promise<number | undefined> {
  if (!isNative()) return undefined;
  try {
    const n = await nativeNotifications();
    const id = 100_000 + (Math.floor(at.getTime() / 60_000) % 1_000_000);
    await n.schedule({
      notifications: [
        { id, title, body, channelId: TRIP_CHANNEL, schedule: { at, allowWhileIdle: true } },
      ],
    });
    return id;
  } catch {
    return undefined;
  }
}

export async function cancelReminder(id: number): Promise<void> {
  if (!isNative()) return;
  try {
    const n = await nativeNotifications();
    await n.cancel({ notifications: [{ id }] });
  } catch {
    // Already shown or never scheduled.
  }
}

/** Vibrates in a pattern (ms on, off, on…). */
export function vibrate(pattern: number[]): void {
  if (isNative()) {
    void import('@capacitor/haptics')
      .then(({ Haptics }) => Haptics.vibrate({ duration: pattern.reduce((a, b) => a + b, 0) }))
      .catch(() => undefined);
    return;
  }
  navigator.vibrate?.(pattern);
}

/**
 * Keeps the screen on (during a ride). Returns a function that releases it.
 * The website re-acquires the lock when the page becomes visible again, as
 * browsers drop it whenever the page is hidden.
 */
export function keepScreenOn(): () => void {
  let released = false;
  if (isNative()) {
    void import('@capacitor-community/keep-awake')
      .then(({ KeepAwake }) => (released ? undefined : KeepAwake.keepAwake()))
      .catch(() => undefined);
    return () => {
      released = true;
      void import('@capacitor-community/keep-awake')
        .then(({ KeepAwake }) => KeepAwake.allowSleep())
        .catch(() => undefined);
    };
  }
  type Sentinel = { release: () => Promise<void> };
  const wakeLock = (
    navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }
  ).wakeLock;
  if (!wakeLock) return () => {};
  let sentinel: Sentinel | undefined;
  const acquire = () => {
    if (released || document.visibilityState !== 'visible') return;
    wakeLock
      .request('screen')
      .then((s) => {
        if (released) void s.release();
        else sentinel = s;
      })
      .catch(() => undefined);
  };
  acquire();
  document.addEventListener('visibilitychange', acquire);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', acquire);
    void sentinel?.release().catch(() => undefined);
  };
}

export interface Position {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

let bgPlugin: BackgroundGeolocationPlugin | undefined;

/**
 * Continuous location. In the app, with `background` set, updates keep coming
 * with the screen off (Android shows a notification with that text while the
 * ride is tracked). Returns a function that stops watching.
 */
export function watchPosition(
  onPosition: (p: Position) => void,
  onError: (e: 'denied' | 'unavailable') => void,
  background?: { title: string; text: string },
): () => void {
  if (isNative() && background) {
    let id: string | undefined;
    let stopped = false;
    void (async () => {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        bgPlugin ??= registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
        const watcher = await bgPlugin.addWatcher(
          {
            backgroundTitle: background.title,
            backgroundMessage: background.text,
            requestPermissions: true,
            stale: false,
            distanceFilter: 0,
          },
          (loc, err) => {
            if (err) {
              onError(err.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
              return;
            }
            if (loc) {
              onPosition({
                lat: loc.latitude,
                lon: loc.longitude,
                accuracy: loc.accuracy,
                timestamp: loc.time ?? Date.now(),
              });
            }
          },
        );
        if (stopped) void bgPlugin.removeWatcher({ id: watcher });
        else id = watcher;
      } catch {
        onError('unavailable');
      }
    })();
    return () => {
      stopped = true;
      if (id !== undefined) void bgPlugin?.removeWatcher({ id });
    };
  }
  if (!('geolocation' in navigator)) {
    onError('unavailable');
    return () => {};
  }
  const watchId = navigator.geolocation.watchPosition(
    (p) =>
      onPosition({
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        timestamp: p.timestamp,
      }),
    (e) => onError(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
