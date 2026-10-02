import { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { madeiraNow, municipalityName, type StopGroup } from '@madeirabus/engine';
import { DepartureList } from '../components/DepartureList.tsx';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n } from '../i18n.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { stopsContent } from '../lib/mapContent.ts';
import { navigate } from '../lib/router.ts';
import { useNetwork } from '../state/app.tsx';

const FUNCHAL = { lat: 32.6469, lon: -16.9086 };
const RADIUS = 700;

export function NearbyView() {
  const t = useI18n();
  const { net } = useNetwork();
  const geo = useGeolocation(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => geo.request(), []);

  const fallback = Boolean(geo.error);
  const here = geo.position ?? (fallback ? FUNCHAL : undefined);

  const groups = useMemo(() => {
    if (!here) return [];
    const byStop = new Map<number, StopGroup>();
    for (const g of net.stopGroups()) for (const s of g.stops) byStop.set(s, g);
    const seen = new Map<StopGroup, number>();
    for (const hit of net.nearbyStops(here, RADIUS)) {
      const g = byStop.get(hit.stop)!;
      if (!seen.has(g)) seen.set(g, hit.distance);
    }
    return [...seen.entries()].slice(0, 6);
  }, [net, here]);

  const content = useMemo(
    () =>
      here
        ? stopsContent(
            groups.map(([g]) => g),
            geo.position,
            `nearby:${here.lat.toFixed(3)},${here.lon.toFixed(3)}`,
          )
        : undefined,
    [groups, here, geo.position],
  );
  useMapContent(content);

  const now = madeiraNow();
  return (
    <div className="nearby">
      <h2 className="view-title">{t.t('nearby.title')}</h2>
      {!here && (
        <p className="plan__status" role="status">
          <Loader2 size={16} className="spin" aria-hidden /> {t.t('place.locating')}
        </p>
      )}
      {fallback && <p className="muted small">{t.t('nearby.fallback')}</p>}
      {here && groups.length === 0 && <p className="muted">{t.t('nearby.none')}</p>}
      {groups.map(([g, distance]) => (
        <section key={`${g.name}|${g.muni}`} className="card">
          <button
            type="button"
            className="card__link"
            onClick={() => navigate('stop', { ids: g.stops.join(',') })}
          >
            <h3 className="card__title">{g.name}</h3>
            <span className="muted small">
              {municipalityName(g.muni)} · {Math.round(distance)} m
            </span>
          </button>
          <DepartureList
            departures={net.departures(g.stops, now.date, now.time, 4)}
            date={now.date}
          />
        </section>
      ))}
    </div>
  );
}
