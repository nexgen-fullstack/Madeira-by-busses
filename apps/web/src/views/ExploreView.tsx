import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Waves } from 'lucide-react';
import { isScenicWalk, type Itinerary, type WalkLeg } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { ScenicCard } from '../components/ScenicCard.tsx';
import { useI18n } from '../i18n.ts';
import { encodePlace } from '../lib/itinerary.ts';
import { VIEW_WALK, walkPath, type MapContent, type MapLine } from '../lib/mapContent.ts';
import {
  byRegion,
  DESTINATIONS,
  hasPhoto,
  outlook,
  reachable,
  regionKey,
  SCENIC_WALKS,
  scenicSpots,
  type ScenicWalk,
} from '../lib/scenic.ts';
import { useNow } from '../lib/useNow.ts';
import { planOptions, useApp, useNetwork } from '../state/app.tsx';

/** Kilometres with one decimal, as the language writes them. */
const km = (m: number, locale: string) =>
  (m / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A walk with a view: from where to where, how long and how much it climbs; a tap plans it. */
function WalkCard({ w, it }: { w: ScenicWalk; it?: Itinerary }) {
  const t = useI18n();
  const leg = it?.legs[0] as WalkLeg | undefined;
  const href = `#/plan?${new URLSearchParams({ from: encodePlace(w.from), to: encodePlace(w.to) })}`;
  return (
    <a className="walk-card" href={href}>
      <span className="walk-card__icon" aria-hidden>
        <Waves size={18} />
      </span>
      <span className="walk-card__body">
        <span className="walk-card__region">{t.t(regionKey(w.region))}</span>
        <span className="walk-card__name">
          {w.from.name} → {w.to.name}
        </span>
        {it && leg && (
          <span className="walk-card__facts">
            {t.t('walk.min', { m: Math.max(1, Math.round(it.duration / 60)) })} ·{' '}
            {t.t('scenic.km', { km: km(leg.distance, t.locale) })}
            {(leg.up ?? 0) >= 10 && (
              <>
                {' '}
                ·{' '}
                <span className="nowrap">
                  <TrendingUp size={13} aria-hidden />{' '}
                  {t.t('walk.dist', { d: Math.round((leg.up ?? 0) / 10) * 10 })}
                </span>
              </>
            )}
          </span>
        )}
      </span>
    </a>
  );
}

/** Popular trips with beautiful views: photos of places by region, and walks along the sea. */
export function ExploreView() {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { settings } = useApp();
  const { date } = useNow();
  const served = useMemo(() => DESTINATIONS.filter((d) => reachable(net, d)), [net]);
  const later = useMemo(() => DESTINATIONS.filter((d) => !reachable(net, d)), [net]);
  const outlooks = useMemo(
    () => new Map(served.map((d) => [d.id, outlook(net, d, date)])),
    [net, served, date],
  );

  // The walks with a view, measured along the streets at the passenger's own pace: those the
  // planner would offer as one (all of them, unless one walks slowly).
  const [walks, setWalks] = useState<(Itinerary | null)[] | undefined>();
  const pace = useMemo(() => planOptions(settings), [settings]);
  useEffect(() => {
    let cancelled = false;
    planner
      .walks(
        SCENIC_WALKS.map((w) => ({ from: w.from, to: w.to, date, time: 9 * 3600, options: pace })),
      )
      .then((r) => !cancelled && setWalks(r))
      .catch(() => !cancelled && setWalks(undefined));
    return () => {
      cancelled = true;
    };
  }, [planner, pace, date]);
  const shownWalks = SCENIC_WALKS.map((w, i) => ({ w, it: walks?.[i] ?? undefined })).filter(
    ({ it }) => !walks || (it && isScenicWalk(it)),
  );

  const walkLines = useMemo<MapLine[]>(
    () =>
      (walks ?? []).flatMap((it) => {
        const leg = it?.legs[0];
        return it && leg?.kind === 'walk' && isScenicWalk(it)
          ? [{ coords: walkPath(leg), color: VIEW_WALK, dashed: true }]
          : [];
      }),
    [walks],
  );
  useMapContent(
    useMemo<MapContent>(
      () => ({
        lines: walkLines,
        points: [],
        // Every place by its photo where it is; zooming in brings out those that crowd.
        scenic: scenicSpots(
          [...served].sort((a, b) => Number(!hasPhoto(a)) - Number(!hasPhoto(b))),
        ),
        fitKey: `explore:${served.map((d) => d.id).join(',')}`,
        fit: served,
      }),
      [served, walkLines],
    ),
  );
  const missing = (net.bundle.missingOperators ?? net.bundle.partialOperators)?.join(', ');

  return (
    <div className="explore">
      <h2 className="view-title">{t.t('scenic.title')}</h2>
      <p className="explore__hint">{t.t('scenic.hint')}</p>
      {shownWalks.length > 0 && (
        <section className="explore__walks">
          <h3 className="plan__subtitle">
            <Waves size={16} aria-hidden /> {t.t('scenic.walks')}
          </h3>
          <p className="muted small">{t.t('scenic.walksHint')}</p>
          <ul className="walk-strip">
            {shownWalks.map(({ w, it }) => (
              <li key={`${w.from.name}>${w.to.name}`}>
                <WalkCard w={w} it={it} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {byRegion(served).map(([region, places]) => (
        <section key={region} className="explore__region">
          <h3 className="plan__subtitle">{t.t(regionKey(region))}</h3>
          <ul className="scenic-list">
            {places.map((d) => (
              <li key={d.id}>
                <ScenicCard d={d} outlook={outlooks.get(d.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
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
