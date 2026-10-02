import { useCallback, useEffect, useRef, useState } from 'react';

export interface GeoState {
  position?: { lat: number; lon: number; accuracy: number; timestamp: number };
  error?: 'denied' | 'unavailable';
  pending: boolean;
}

/** One-shot or continuous browser geolocation. */
export function useGeolocation(watch = false): GeoState & { request: () => void } {
  const [state, setState] = useState<GeoState>({ pending: false });
  const watchId = useRef<number | undefined>(undefined);

  const onPos = useCallback((p: GeolocationPosition) => {
    setState({
      pending: false,
      position: {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        timestamp: p.timestamp,
      },
    });
  }, []);
  const onErr = useCallback((e: GeolocationPositionError) => {
    setState((s) => ({
      ...s,
      pending: false,
      error: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable',
    }));
  }, []);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ pending: false, error: 'unavailable' });
      return;
    }
    setState((s) => ({ ...s, pending: true }));
    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
    if (watch) {
      if (watchId.current === undefined)
        watchId.current = navigator.geolocation.watchPosition(onPos, onErr, opts);
    } else {
      navigator.geolocation.getCurrentPosition(onPos, onErr, opts);
    }
  }, [watch, onPos, onErr]);

  useEffect(
    () => () => {
      if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return { ...state, request };
}
