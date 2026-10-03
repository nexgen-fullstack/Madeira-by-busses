import { useCallback, useEffect, useRef, useState } from 'react';
import { watchPosition, type Position } from './device.ts';

export interface GeoState {
  position?: Position;
  error?: 'denied' | 'unavailable';
  pending: boolean;
}

/**
 * One-shot or continuous geolocation. With `background`, the app keeps
 * receiving positions with the screen off (see `watchPosition`).
 */
export function useGeolocation(
  watch = false,
  background?: { title: string; text: string },
): GeoState & { request: () => void } {
  const [state, setState] = useState<GeoState>({ pending: false });
  const stop = useRef<(() => void) | undefined>(undefined);
  const backgroundRef = useRef(background);
  backgroundRef.current = background;

  const onPos = useCallback((position: Position) => {
    setState({ pending: false, position });
  }, []);
  const onErr = useCallback((error: 'denied' | 'unavailable') => {
    setState((s) => ({ ...s, pending: false, error }));
  }, []);

  const request = useCallback(() => {
    setState((s) => ({ ...s, pending: true }));
    if (watch) {
      stop.current ??= watchPosition(onPos, onErr, backgroundRef.current);
      return;
    }
    if (!('geolocation' in navigator)) {
      onErr('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        onPos({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        }),
      (e) => onErr(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }, [watch, onPos, onErr]);

  useEffect(
    () => () => {
      stop.current?.();
      stop.current = undefined;
    },
    [],
  );

  return { ...state, request };
}
