import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

/** Minimal hash router: works from any base path and offline. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string, query?: Record<string, string | undefined>): void {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  location.hash = `#/${path}${qs ? `?${qs}` : ''}`;
  // Marks the entry as reached from inside the app, so "back" can return to it.
  try {
    history.replaceState({ ...(history.state as object | null), inApp: true }, '');
  } catch {
    // History state unavailable (sandboxed frames): back falls back to the planner.
  }
}

/**
 * Goes back when the current screen was opened from inside the app, or to
 * `fallback` when it was opened directly (a shared link, a restored tab), so
 * "back" never leaves the app.
 */
export function goBack(fallback = 'plan'): void {
  if ((history.state as { inApp?: boolean } | null)?.inApp) history.back();
  else navigate(fallback);
}
