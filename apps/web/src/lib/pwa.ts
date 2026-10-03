import { registerSW } from 'virtual:pwa-register';
import { isNative } from './device.ts';

/**
 * Service worker updates (new app version or nightly timetable) are applied
 * only while the app is in the background and no ride is being followed, so
 * the page never reloads under the passenger's fingers or mid-trip.
 */

let busy = false;
let apply: (() => void) | undefined;

function maybeApply() {
  if (apply && !busy && document.visibilityState === 'hidden') {
    const run = apply;
    apply = undefined;
    run();
  }
}

/** Marks a ride in progress; updates wait until it ends. */
export function setBusy(value: boolean): void {
  busy = value;
  maybeApply();
}

export function startPwa(): void {
  // The phone app ships its files; it has no use for a service worker.
  if (isNative() || !('serviceWorker' in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      apply = () => void update(true);
      maybeApply();
    },
    onRegisteredSW(_url, registration) {
      // An app left open for days still picks up the nightly timetable.
      if (registration) window.setInterval(() => void registration.update(), 3600 * 1000);
    },
  });
  document.addEventListener('visibilitychange', maybeApply);
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPrompt | undefined;
const installListeners = new Set<() => void>();

// Chrome offers installation once; keep the event for the Settings button.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    installListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    installListeners.forEach((l) => l());
  });
}

export function canInstall(): boolean {
  return installPrompt !== undefined;
}

export function onInstallChange(listener: () => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Shows the browser's install dialog; true when the app was installed. */
export async function install(): Promise<boolean> {
  const p = installPrompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === 'accepted') installPrompt = undefined;
  installListeners.forEach((l) => l());
  return outcome === 'accepted';
}

/** Running as an installed app (home screen), not in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
