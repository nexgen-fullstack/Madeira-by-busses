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
import { DEFAULT_LAYERS, type MapLayers } from '../lib/mapStyles.ts';
import { load, save } from '../lib/storage.ts';
import { PlannerClient } from '../worker/client.ts';

export interface Settings {
  lang: Lang;
  payment: 'giro' | 'cash';
  /** m/s */
  walkSpeed: number;
  map: MapLayers;
  /** Real timetables, or the invented whole-island demo network. */
  dataset: 'real' | 'demo';
}

export interface ActiveTrip {
  itinerary: Itinerary;
  date: string;
  simulate: boolean;
}

type DataState =
  | { status: 'loading' }
  | { status: 'error'; error: string; dataset?: Settings['dataset'] }
  | {
      status: 'ready';
      dataset?: Settings['dataset'];
      net: Network;
      planner: PlannerClient;
      /** The real timetable was asked for but is not part of this build. */
      fallback?: boolean;
    };

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
const LOADING: DataState = { status: 'loading' };

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(() =>
    (() => {
      const stored = load<Settings>(SETTINGS_KEY, {
        lang: detectLang(),
        payment: 'giro',
        walkSpeed: 1.25,
        map: DEFAULT_LAYERS,
        dataset: 'real',
      });
      return { ...stored, map: { ...DEFAULT_LAYERS, ...stored.map } };
    })(),
  );
  const [data, setData] = useState<DataState>({ status: 'loading' });
  const dataset = settings.dataset;
  const [trip, setTrip] = useState<ActiveTrip | undefined>();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [attempt, setAttempt] = useState(0);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    // Itineraries hold stop indices of the network they were planned on.
    if (patch.dataset) setTrip(undefined);
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      save(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let planner: PlannerClient | undefined;
    (async () => {
      try {
        const fetchBundle = (name: string) => fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
        let res = dataset === 'real' ? await fetchBundle('network') : undefined;
        // Builds without the real timetable (local dev, CI) still work on the demo.
        // A dev server answers a missing file with the app page instead of a 404.
        const fallback =
          res !== undefined &&
          (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json'));
        if (!res || fallback) res = await fetchBundle('demo');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.text();
        const net = new Network(JSON.parse(json));
        planner = new PlannerClient();
        await planner.init(json);
        if (!cancelled) setData({ status: 'ready', dataset, net, planner, fallback });
      } catch (err) {
        if (!cancelled)
          setData({
            status: 'error',
            dataset,
            error: err instanceof Error ? err.message : String(err),
          });
      }
    })();
    return () => {
      cancelled = true;
      planner?.dispose();
    };
  }, [attempt, dataset]);

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
  // While another dataset loads, screens see "loading" rather than stale data.
  const current: DataState = data.status !== 'loading' && data.dataset !== dataset ? LOADING : data;
  const value = useMemo<AppValue>(
    () => ({ data: current, settings, setSettings, trip, setTrip, online, reload }),
    [current, settings, setSettings, trip, online, reload],
  );

  return (
    <AppContext.Provider value={value}>
      <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>
    </AppContext.Provider>
  );
}
