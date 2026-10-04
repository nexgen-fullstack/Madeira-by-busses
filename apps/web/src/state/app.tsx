import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { madeiraNow, Network, type Itinerary } from '@madeirabus/engine';
import { detectLang, I18nContext, makeI18n, type Lang } from '../i18n.ts';
import { loadBundleText, refreshRemote } from '../lib/data.ts';
import { DEFAULT_LAYERS, type MapLayers } from '../lib/mapStyles.ts';
import { setBusy } from '../lib/pwa.ts';
import { load, remove, save } from '../lib/storage.ts';
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
  /** The timetable the itinerary was planned on (its stop indices belong to it). */
  generatedAt?: string;
  /** Index of the ride in progress, so a reopened app resumes where it was. */
  ride?: number;
}

/** A recent search, places encoded as in URLs (see encodePlace). */
export interface RecentTrip {
  from: string;
  to: string;
  fromName: string;
  toName: string;
}

/** A stop the user starred, by feed ids (stable across timetable updates). */
export interface SavedStop {
  ids: string[];
  name: string;
  muni: string;
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
  recent: RecentTrip[];
  addRecent: (r: RecentTrip) => void;
  saved: SavedStop[];
  toggleSaved: (stop: SavedStop) => void;
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
const TRIP_KEY = 'madeirabus.trip.v1';
const RECENT_KEY = 'madeirabus.recent.v1';
const SAVED_KEY = 'madeirabus.saved.v1';
const MAX_RECENT = 6;
const LOADING: DataState = { status: 'loading' };

/** A stored ride that is still worth resuming on this timetable. */
function resumableTrip(net: Network): ActiveTrip | undefined {
  const stored = load<{ trip?: ActiveTrip }>(TRIP_KEY, {}).trip;
  if (!stored || stored.simulate || stored.generatedAt !== net.bundle.generatedAt) return undefined;
  const now = madeiraNow();
  // Half an hour of slack after the planned arrival.
  const over =
    stored.date < now.date ||
    (stored.date === now.date && stored.itinerary.arrive + 1800 < now.time);
  return over ? undefined : stored;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(() => {
    const stored = load<Settings>(SETTINGS_KEY, {
      lang: detectLang(),
      payment: 'giro',
      walkSpeed: 1.25,
      map: DEFAULT_LAYERS,
      dataset: 'real',
    });
    return { ...stored, map: { ...DEFAULT_LAYERS, ...stored.map } };
  });
  const [data, setData] = useState<DataState>({ status: 'loading' });
  const dataset = settings.dataset;
  const [trip, setTripState] = useState<ActiveTrip | undefined>();
  const [recent, setRecent] = useState<RecentTrip[]>(() => load(RECENT_KEY, { list: [] }).list);
  const [saved, setSaved] = useState<SavedStop[]>(() => load(SAVED_KEY, { list: [] }).list);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [attempt, setAttempt] = useState(0);

  const setTrip = useCallback((next?: ActiveTrip) => {
    setTripState(next);
    if (next && !next.simulate) save(TRIP_KEY, { trip: next });
    else remove(TRIP_KEY);
  }, []);

  const setSettings = useCallback(
    (patch: Partial<Settings>) => {
      // Itineraries hold stop indices of the network they were planned on.
      if (patch.dataset) setTrip(undefined);
      setSettingsState((s) => {
        const next = { ...s, ...patch };
        save(SETTINGS_KEY, next);
        return next;
      });
    },
    [setTrip],
  );

  const addRecent = useCallback((r: RecentTrip) => {
    setRecent((list) => {
      const next = [r, ...list.filter((x) => x.from !== r.from || x.to !== r.to)].slice(
        0,
        MAX_RECENT,
      );
      save(RECENT_KEY, { list: next });
      return next;
    });
  }, []);

  const toggleSaved = useCallback((stop: SavedStop) => {
    setSaved((list) => {
      const key = stop.ids.join(',');
      const next = list.some((s) => s.ids.join(',') === key)
        ? list.filter((s) => s.ids.join(',') !== key)
        : [...list, stop];
      save(SAVED_KEY, { list: next });
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let planner: PlannerClient | undefined;
    (async () => {
      try {
        const { json, fallback } = await loadBundleText(dataset);
        // The worker parses its own copy meanwhile; searches queue up behind it.
        planner = new PlannerClient();
        planner.init(json).catch(() => undefined);
        // Streets for walking: the same for every timetable, loaded once the planner is up.
        const walkUrl = new URL(`${import.meta.env.BASE_URL}data/walk.bin`, document.baseURI).href;
        planner.loadWalk(walkUrl).catch(() => undefined);
        const net = new Network(JSON.parse(json));
        if (cancelled) return;
        setData({ status: 'ready', dataset, net, planner, fallback });
        // Index stop and place names before the first keystroke.
        (window.requestIdleCallback ?? window.setTimeout)(() => net.search('a', 1));
        const resumed = resumableTrip(net);
        if (resumed) setTripState(resumed);
        if (dataset === 'real' && !fallback) void refreshRemote(net.bundle.generatedAt);
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
    setBusy(Boolean(trip && !trip.simulate));
  }, [trip]);

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
    () => ({
      data: current,
      settings,
      setSettings,
      trip,
      setTrip,
      recent,
      addRecent,
      saved,
      toggleSaved,
      online,
      reload,
    }),
    [
      current,
      settings,
      setSettings,
      trip,
      setTrip,
      recent,
      addRecent,
      saved,
      toggleSaved,
      online,
      reload,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>
    </AppContext.Provider>
  );
}
