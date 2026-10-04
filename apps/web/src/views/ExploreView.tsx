import { useMemo } from 'react';
import { useMapContent } from '../components/mapContext.tsx';
import { ScenicCard } from '../components/ScenicCard.tsx';
import { useI18n } from '../i18n.ts';
import type { MapContent } from '../lib/mapContent.ts';
import { DESTINATIONS, outlook, reachable } from '../lib/scenic.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';

/** Popular trips with beautiful views: photos of places; a tap plans the trip. */
export function ExploreView() {
  const t = useI18n();
  const { net } = useNetwork();
  const { date } = useNow();
  const served = useMemo(() => DESTINATIONS.filter((d) => reachable(net, d)), [net]);
  const later = useMemo(() => DESTINATIONS.filter((d) => !reachable(net, d)), [net]);
  const outlooks = useMemo(
    () => new Map(served.map((d) => [d.id, outlook(net, d, date)])),
    [net, served, date],
  );
  useMapContent(
    useMemo<MapContent>(
      () => ({
        lines: [],
        points: served.map((d) => ({
          lat: d.lat,
          lon: d.lon,
          kind: 'destination',
          color: '#14181F',
          label: d.name,
        })),
        fitKey: `explore:${served.map((d) => d.id).join(',')}`,
        fit: served,
      }),
      [served],
    ),
  );
  const missing = net.bundle.missingOperators?.join(', ');

  return (
    <div className="explore">
      <h2 className="view-title">{t.t('scenic.title')}</h2>
      <p className="explore__hint">{t.t('scenic.hint')}</p>
      <ul className="scenic-list">
        {served.map((d) => (
          <li key={d.id}>
            <ScenicCard d={d} outlook={outlooks.get(d.id)} />
          </li>
        ))}
      </ul>
      {later.length > 0 && (
        <section className="explore__later">
          <h3 className="plan__subtitle">{t.t('scenic.later')}</h3>
          {missing && (
            <p className="muted small">{t.t('scenic.laterHint', { operators: missing })}</p>
          )}
          <ul className="scenic-grid">
            {later.map((d) => (
              <li key={d.id}>
                <ScenicCard d={d} size="small" soon />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
