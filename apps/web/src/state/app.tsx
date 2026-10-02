import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Network, type Itinerary } from '@madeirabus/engine';
import { detectLang, I18nContext, makeI18n, type Lang } from '../i18n.ts';
import { load, save } from '../lib/storage.ts';
import { PlannerClient } from '../worker/client.ts';

export interface Settings {
  lang: Lang;
  payment: 'giro' | 'cash';
  /** m/s */
  walkSpeed: number;
}

export interface ActiveTrip {
  itinerary: Itinerary;
  date: string;
  simulate: boolean;
}

type DataState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; net: Network; planner: PlannerClient };

interface AppValue {
  data: DataState;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  trip?: ActiveTrip;
  setTrip: (trip?: ActiveTrip) => void;
  online: boolean;
  reload: () => void;
}

const AppContext = createContext<AppValue | undefined>(undefined);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Ready data or a thrown error; only call inside screens rendered when data is ready. */
export function useNetwork(): { net: Network; planner: PlannerClient } {
  const { data } = useApp();
  if (data.status !== 'ready') throw new Error('Network not ready');
  return data;
}

const SETTINGS_KEY = 'madeirabus.settings.v1';

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(() =>
    load<Settings>(SETTINGS_KEY, { lang: detectLang(), payment: 'giro', walkSpeed: 1.25 }),
  );
  const [data, setData] = useState<DataState>({ status: 'loading' });
  const [trip, setTrip] = useState<ActiveTrip | undefined>();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [attempt, setAttempt] = useState(0);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      save(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/network.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.text();
        const net = new Network(JSON.parse(json));
        const planner = new PlannerClient();
        await planner.init(json);
        if (!cancelled) setData({ status: 'ready', net, planner });
      } catch (err) {
        if (!cancelled)
          setData({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  const i18n = useMemo(() => makeI18n(settings.lang), [settings.lang]);
  const reload = useCallback(() => {
    setData({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);
  const value = useMemo<AppValue>(
    () => ({ data, settings, setSettings, trip, setTrip, online, reload }),
    [data, settings, setSettings, trip, online, reload],
  );

  return (
    <AppContext.Provider value={value}>
      <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>
    </AppContext.Provider>
  );
}
