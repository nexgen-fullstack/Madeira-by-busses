import { lazy, Suspense, useContext, useEffect, useRef } from 'react';
import { List, Map as MapIcon, Mountain, Navigation, Settings } from 'lucide-react';
import { StatusBanners } from './components/DemoBanner.tsx';
import { MapContentContext, MapProvider } from './components/mapContext.tsx';
import { useI18n, type Key } from './i18n.ts';
import { navigate, useRoute } from './lib/router.ts';
import { APP_NAME } from './lib/site.ts';
import { destination } from './lib/scenic.ts';
import { AppProvider, useApp } from './state/app.tsx';
import { TripProvider } from './state/trip.tsx';
import { DestinationView } from './views/DestinationView.tsx';
import { ExploreView } from './views/ExploreView.tsx';
import { LineDetail } from './views/LineDetail.tsx';
import { LinesView } from './views/LinesView.tsx';
import { NearbyView } from './views/NearbyView.tsx';
import { PlanView } from './views/PlanView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { StopView } from './views/StopView.tsx';
import { TripView } from './views/TripView.tsx';

const MapView = lazy(() => import('./components/MapView.tsx'));

const TABS: { path: string; key: Key; icon: typeof MapIcon }[] = [
  { path: 'plan', key: 'tab.plan', icon: Navigation },
  { path: 'explore', key: 'tab.explore', icon: Mountain },
  { path: 'nearby', key: 'tab.nearby', icon: MapIcon },
  { path: 'lines', key: 'tab.lines', icon: List },
  { path: 'settings', key: 'tab.settings', icon: Settings },
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
        <LineDetail key={sub} routeIndex={Number(sub)} />
      ) : (
        <LinesView key={route.query.get('q') ?? ''} route={route} />
      );
    case 'explore': {
      const place = destination(sub);
      return place ? <DestinationView key={place.id} d={place} route={route} /> : <ExploreView />;
    }
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

function Shell() {
  const t = useI18n();
  const route = useRoute();
  const { data, trip } = useApp();
  // Choosing a place on the map: the map takes the screen, as in a maps app.
  const { pick } = useContext(MapContentContext);
  const head = route.path[0] ?? 'plan';
  const demo = data.status === 'ready' && data.net.bundle.demo;
  const panel = useRef<HTMLElement>(null);
  const screenKey = `${route.path.join('/')}|${route.query.get('i') ?? ''}`;
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [screenKey]);
  return (
    <div className={`app ${head === 'trip' ? 'app--trip' : ''}${pick ? ' app--picking' : ''}`}>
      <header className="topbar">
        <a className="brand" href="#/plan" aria-label={APP_NAME}>
          <img className="brand__mark" src="brand-mark.png" alt="" width={57} height={36} />
          <img className="brand__words" src="brand-words.png" alt="" width={84} height={34} />
        </a>
        {demo && <span className="badge badge--demo">{t.t('demo.badge')}</span>}
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
        <main className="panel" ref={panel}>
          <StatusBanners />
          <Screen />
        </main>
      </div>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ path, key, icon: Icon }) => (
          <a
            key={path}
            href={`#/${path}`}
            className="tabbar__item"
            aria-current={
              head === path || (path === 'lines' && head === 'lines') ? 'page' : undefined
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
