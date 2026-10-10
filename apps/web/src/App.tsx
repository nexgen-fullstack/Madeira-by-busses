import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { List, Map as MapIcon, Mountain, Navigation, Settings, Signpost } from 'lucide-react';
import {
  SheetHandle,
  snapInset,
  useBottomSheet,
  type SheetSnap,
} from './components/BottomSheet.tsx';
import { StatusBanners } from './components/DemoBanner.tsx';
import { MapContentContext, MapProvider } from './components/mapContext.tsx';
import { useI18n, type Key } from './i18n.ts';
import { listenBackButton, useBack } from './lib/back.ts';
import { goBack, navigate, onLeave, useRoute, type Route } from './lib/router.ts';
import { APP_NAME } from './lib/site.ts';
import { destination } from './lib/scenic.ts';
import { AppProvider, useApp } from './state/app.tsx';
import { TripProvider } from './state/trip.tsx';
import { DestinationView } from './views/DestinationView.tsx';
import { ExploreView } from './views/ExploreView.tsx';
import { HikesView } from './views/HikesView.tsx';
import { HikeView } from './views/HikeView.tsx';
import { LineDetail } from './views/LineDetail.tsx';
import { LinesView } from './views/LinesView.tsx';
import { NearbyView } from './views/NearbyView.tsx';
import { PlanView } from './views/PlanView.tsx';
import { RideView } from './views/RideView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { StopView } from './views/StopView.tsx';
import { TripView } from './views/TripView.tsx';

const MapView = lazy(() => import('./components/MapView.tsx'));

const TABS: { path: string; key: Key; icon: typeof MapIcon }[] = [
  { path: 'plan', key: 'tab.plan', icon: Navigation },
  { path: 'explore', key: 'tab.explore', icon: Mountain },
  { path: 'hikes', key: 'tab.hikes', icon: Signpost },
  { path: 'nearby', key: 'tab.nearby', icon: MapIcon },
  { path: 'lines', key: 'tab.lines', icon: List },
];

function Screen() {
  const route = useRoute();
  const { data, reload } = useApp();
  const t = useI18n();
  if (data.status === 'loading') {
    return (
      <div className="splash" role="status">
        <img className="splash__logo" src="logo.png" alt="" width={112} height={112} />
        <p>{t.t('loading')}</p>
      </div>
    );
  }
  if (data.status === 'error') {
    return (
      <div className="splash">
        <p className="error">
          {t.t('load.error')} ({data.error})
        </p>
        <button type="button" className="button" onClick={reload}>
          {t.t('retry')}
        </button>
      </div>
    );
  }
  const [head, sub] = route.path;
  switch (head) {
    case 'nearby':
      return <NearbyView />;
    case 'lines':
      return sub !== undefined ? (
        <LineDetail
          key={sub}
          routeIndex={Number(sub)}
          at={route.query.has('s') ? Number(route.query.get('s')) : undefined}
          day={route.query.get('d') ?? undefined}
        />
      ) : (
        <LinesView key={route.query.get('q') ?? ''} route={route} />
      );
    case 'explore': {
      const place = destination(sub);
      return place ? <DestinationView key={place.id} d={place} route={route} /> : <ExploreView />;
    }
    case 'ride':
      return (
        <RideView
          key={route.path.join('/')}
          pattern={Number(sub)}
          dayTrip={Number(route.path[2])}
          route={route}
        />
      );
    case 'hikes':
      return sub !== undefined ? <HikeView key={sub} id={sub} /> : <HikesView />;
    case 'stop':
      return <StopView route={route} />;
    case 'settings':
      return <SettingsView />;
    case 'trip':
      return <TripView />;
    default:
      return <PlanView route={route} />;
  }
}

/**
 * Where the sheet rests on a phone when a screen opens: a chosen way or a trip under way
 * leave the whole map to the route, the settings take most of the screen.
 */
function sheetRest(route: Route): SheetSnap {
  const [head = 'plan'] = route.path;
  if (head === 'trip' || route.query.has('i')) return 'min';
  if (head === 'plan') return route.query.has('to') ? 'half' : 'peek';
  if (head === 'settings') return 'full';
  // A place: its photo, name and "start" over the map, the way there on the map above them;
  // the rest when the sheet is pulled up. Its "from" or "to" changed: the ways there in view.
  if (head === 'explore' && route.path[1]) {
    return route.query.has('from') || route.query.has('to') ? 'half' : 'peek';
  }
  return 'half';
}

/**
 * Whether the screen is a phone's, upright or on its side: the map takes the screen and
 * the panel is a sheet over it, not beside it.
 */
function usePhone(): boolean {
  const query = '(max-width: 899px), (max-height: 500px)';
  const [phone, setPhone] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

function Shell() {
  const t = useI18n();
  const route = useRoute();
  const { data, trip } = useApp();
  // Choosing a place on the map: the map takes the screen, as in a maps app.
  const { pick, setPick } = useContext(MapContentContext);
  const head = route.path[0] ?? 'plan';
  const demo = data.status === 'ready' && data.net.bundle.demo;
  const panel = useRef<HTMLElement>(null);
  // A screen opens at its top; back on one seen before (the list of places after one of
  // them), where it was left.
  const screenKey = `${route.path.join('/')}|${route.query.get('i') ?? ''}`;
  const scrolled = useRef(new Map<string, number>());
  const shownKey = useRef(screenKey);
  useEffect(
    () =>
      onLeave(() => {
        if (panel.current) scrolled.current.set(shownKey.current, panel.current.scrollTop);
      }),
    [],
  );
  useEffect(() => {
    shownKey.current = screenKey;
    panel.current?.scrollTo({ top: scrolled.current.get(screenKey) ?? 0 });
  }, [screenKey]);

  // On a phone the map takes the screen between the bars, as in a maps app, and the screen
  // itself is a sheet over it, pulled up and down by its handle; when the app opens, just
  // the handle above the tabs, the island on the whole screen.
  const phone = usePhone();
  const sheetMode = phone && !pick && data.status === 'ready';
  const frame = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const measureArea = useCallback(
    () =>
      (frame.current?.clientHeight ?? 0) -
      (top.current?.offsetHeight ?? 0) -
      (tabs.current?.offsetHeight ?? 0),
    [],
  );
  const searchKey = [route.path.join('/'), ...['from', 'to', 'i'].map((k) => route.query.get(k))]
    .map((k) => k ?? '')
    .join('|');
  const rest = sheetRest(route);
  // The strip a screen asks for as the sheet's lowest but one: down to the bottom of what
  // it marks `data-peek` (a place's photo, name and "start").
  const [peek, setPeek] = useState<number>();
  useEffect(() => {
    const el = panel.current?.querySelector<HTMLElement>('[data-peek]');
    if (!sheetMode || !el || !panel.current) {
      setPeek(undefined);
      return;
    }
    const box = panel.current;
    const measure = () =>
      setPeek(
        Math.round(
          el.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop,
        ),
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [screenKey, sheetMode]);
  const sheet = useBottomSheet(
    sheetMode,
    frame,
    measureArea,
    searchKey,
    rest,
    head === 'plan' && [...route.query.keys()].length === 0 ? 'min' : rest,
    peek,
  );
  // The map keeps the route clear of the sheet once it rests.
  const inset = sheetMode ? snapInset(sheet.snap, sheet.areaHeight, peek) : 0;
  useEffect(() => {
    window.dispatchEvent(new Event('mb-map-inset'));
  }, [inset]);

  // The phone's back button: up a level at a time to the start screen, as it was when the
  // app opened; there, twice to close the app.
  const back = useCallback(() => {
    if (pick) {
      setPick(undefined);
      return true;
    }
    const q = route.query;
    const [where, sub] = route.path;
    if (!where || where === 'plan') {
      if (q.has('i')) {
        const rest = Object.fromEntries([...q.entries()].filter(([k]) => k !== 'i'));
        navigate('plan', rest);
        return true;
      }
      if ([...q.keys()].length > 0) {
        navigate('plan');
        return true;
      }
      return false;
    }
    // A line or a place: back where it was opened from (a place's timetable, the list).
    if ((where === 'lines' || where === 'explore' || where === 'hikes') && sub !== undefined)
      goBack(where);
    else if (where === 'ride') goBack('lines');
    else if (where === 'stop') goBack('plan');
    else navigate('plan');
    return true;
  }, [pick, setPick, route]);
  useBack(back);
  const [exitHint, setExitHint] = useState(false);
  useEffect(() => {
    let last = 0;
    let timer: number | undefined;
    const stop = listenBackButton((exit) => {
      const now = Date.now();
      if (now - last < 2000) {
        exit();
        return;
      }
      last = now;
      setExitHint(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setExitHint(false), 2000);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={frame}
      className={`app ${head === 'trip' ? 'app--trip' : ''}${pick ? ' app--picking' : ''}${
        sheetMode ? ' app--sheet' : ''
      }`}
      style={
        // Until the map area is measured the sheet takes half of it (the CSS default).
        sheetMode && sheet.areaHeight > 0
          ? ({
              '--sheet-h': `${sheet.height}px`,
              '--map-bottom-inset': `${inset}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <header className="topbar" ref={top}>
        <a className="brand" href="#/plan" aria-label={APP_NAME}>
          <img className="brand__mark" src="brand-mark.png" alt="" width={38} height={38} />
          <img className="brand__words" src="brand-words.png" alt="" width={84} height={37} />
        </a>
        {demo && <span className="badge badge--demo">{t.t('demo.badge')}</span>}
        {/* The settings, as a maps app keeps them: a gear at the top, the tabs for the island. */}
        <a
          className="topbar__settings"
          href="#/settings"
          aria-label={t.t('tab.settings')}
          title={t.t('tab.settings')}
          aria-current={head === 'settings' ? 'page' : undefined}
        >
          <Settings size={22} aria-hidden />
        </a>
        {trip && head !== 'trip' && (
          <button type="button" className="chip chip--live" onClick={() => navigate('trip')}>
            <span className="live-dot" aria-hidden /> {t.t('trip.title')}
          </button>
        )}
      </header>
      <div className="layout">
        <Suspense fallback={<div className="map" />}>
          <MapView className="map" />
        </Suspense>
        <main
          className={`panel${sheetMode ? ' panel--sheet' : ''}${sheet.dragging ? ' panel--dragging' : ''}${
            sheetMode && sheet.snap === 'min' && !sheet.dragging ? ' panel--min' : ''
          }`}
          ref={panel}
          onFocus={(e) => {
            // Typing a place: the sheet makes room for the list of places.
            if (sheetMode && e.target instanceof HTMLInputElement) sheet.setSnap('full');
          }}
        >
          {sheetMode && (
            <SheetHandle
              height={sheet.height}
              areaHeight={sheet.areaHeight}
              peek={peek}
              snap={sheet.snap}
              onSnap={sheet.setSnap}
              onDrag={sheet.setDrag}
            />
          )}
          <StatusBanners />
          <Screen />
        </main>
      </div>
      {exitHint && (
        <div className="toast toast--exit" role="status">
          {t.t('back.exit')}
        </div>
      )}
      <nav className="tabbar" aria-label="Main" ref={tabs}>
        {TABS.map(({ path, key, icon: Icon }) => (
          <a
            key={path}
            href={`#/${path}`}
            className="tabbar__item"
            aria-current={
              head === path || (path === 'lines' && head === 'ride') ? 'page' : undefined
            }
          >
            <Icon size={20} aria-hidden />
            <span>{t.t(key)}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <MapProvider>
        <TripProvider>
          <Shell />
        </TripProvider>
      </MapProvider>
    </AppProvider>
  );
}
