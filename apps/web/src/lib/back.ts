import { useEffect } from 'react';
import { isNative } from './device.ts';

/**
 * The phone's "back" button in the app. Whatever is open on top takes it first
 * (a line's card on the map, choosing a place on the map), then the screen
 * (a route's steps go back to the list, the list to the start screen), and on
 * the start screen two presses close the app, as Android apps do.
 */
type Handler = () => boolean;

const handlers: Handler[] = [];

/** While mounted, `handler` may take "back": it returns true when it did something. */
export function useBack(handler: Handler | undefined): void {
  useEffect(() => {
    if (!handler) return;
    handlers.push(handler);
    return () => {
      const i = handlers.lastIndexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [handler]);
}

/** Gives "back" to the handlers, the last one mounted first; false when none took it. */
export function handleBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]!()) return true;
  return false;
}

/**
 * In the Android app, routes the button to the handlers; `onUnhandled` (the
 * start screen) decides whether to close the app. Returns a way to stop.
 */
export function listenBackButton(onUnhandled: (exit: () => void) => void): () => void {
  if (!isNative()) return () => undefined;
  let remove: (() => void) | undefined;
  let stopped = false;
  void import('@capacitor/app').then(async ({ App }) => {
    const listener = await App.addListener('backButton', () => {
      if (!handleBack()) onUnhandled(() => void App.exitApp());
    });
    if (stopped) void listener.remove();
    else remove = () => void listener.remove();
  });
  return () => {
    stopped = true;
    remove?.();
  };
}
