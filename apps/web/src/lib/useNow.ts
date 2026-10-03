import { useEffect, useState } from 'react';
import { madeiraNow } from '@madeirabus/engine';

/**
 * Madeira's date and time of day, refreshed every `everyMs` and whenever the
 * app comes back to the foreground, so "in 5 min" and departure lists never
 * go stale on a screen left open.
 */
export function useNow(everyMs = 30_000): { date: string; time: number } {
  const [now, setNow] = useState(madeiraNow);
  useEffect(() => {
    const tick = () => setNow(madeiraNow());
    const id = window.setInterval(tick, everyMs);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [everyMs]);
  return now;
}
