import { useMemo, useState } from 'react';
import { Bus, Clock, MoveHorizontal, Repeat, TrendingUp } from 'lucide-react';
import { trailMinutes, type Trail, type TrailKind } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { duration } from '../lib/format.ts';
import { EMPTY_CONTENT, ISLAND, type MapContent } from '../lib/mapContent.ts';
import { photoUrl, trailPhoto } from '../lib/photos.ts';
import { REGIONS, regionKey } from '../lib/scenic.ts';
import { nearestStop, startOf, TRAIL_KINDS, trailRegion, useTrails } from '../lib/trails.ts';
import { useNetwork } from '../state/app.tsx';

/** Kilometres with one decimal, as the language writes them. */
export const trailKm = (m: number, locale: string) =>
  (m / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A trail's number on a plate in the red and yellow of its waymarks (PR), or plain. */
export function TrailBadge({ trail }: { trail: Trail }) {
  if (!trail.ref) return null;
  return (
    <span className={`trail-badge${trail.kind === 'pr' ? ' trail-badge--pr' : ''}`}>
      {trail.ref}
    </span>
  );
}

/** One trail in the list: its number, name, length, climb and time, and its bus. */
function TrailCard({ trail, bus }: { trail: Trail; bus?: number }) {
  const t = useI18n();
  const pic = trailPhoto(trail.id);
  return (
    <a className={`trail-card${pic ? ' trail-card--photo' : ''}`} href={`#/hikes/${trail.id}`}>
      {pic && (
        <img
          className="trail-card__photo"
          src={photoUrl(pic, 'sm')}
          width={480}
          height={320}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <span className="trail-card__head">
        <TrailBadge trail={trail} />
        <span className="trail-card__name">{trail.name}</span>
      </span>
      <span className="trail-card__facts">
        <span className="nowrap">
          <MoveHorizontal size={13} aria-hidden />{' '}
          {t.t('scenic.km', { km: trailKm(trail.length, t.locale) })}
        </span>
        {trail.up >= 20 && (
          <span className="nowrap">
            <TrendingUp size={13} aria-hidden /> {t.t('hike.upShort', { m: trail.up })}
          </span>
        )}
        <span className="nowrap">
          <Clock size={13} aria-hidden />{' '}
          {duration(t, trailMinutes(trail.length, trail.up, trail.down) * 60)}
        </span>
        {trail.roundtrip && (
          <span className="nowrap">
            <Repeat size={13} aria-hidden /> {t.t('hike.loopShort')}
          </span>
        )}
      </span>
      <span className={`trail-card__bus${bus === undefined ? ' muted' : ''}`}>
        <Bus size={13} aria-hidden />{' '}
        {bus === undefined ? t.t('hikes.noBus') : t.t('hikes.byBus', { m: bus })}
      </span>
    </a>
  );
}

/**
 * The trails tab: the island's official PR trails, its levadas and veredas, by region,
 * each with how long, how high and how far its start is from a bus; the trails on the map.
 */
export function HikesView() {
  const t = useI18n();
  const { net } = useNetwork();
  const trails = useTrails();
  const [kind, setKind] = useState<TrailKind | 'all'>('all');
  const [busOnly, setBusOnly] = useState(false);

  useMapContent(
    useMemo<MapContent>(
      () => ({ ...EMPTY_CONTENT, trails: true, fitKey: 'island', fit: ISLAND }),
      [],
    ),
  );

  // How far each trail's start is from a bus stop (m), where one is near.
  const bus = useMemo(
    () => new Map((trails ?? []).map((tr) => [tr.id, nearestStop(net, startOf(tr))?.metres])),
    [trails, net],
  );
  const shown = (trails ?? []).filter(
    (tr) => (kind === 'all' || tr.kind === kind) && (!busOnly || bus.get(tr.id) !== undefined),
  );
  const kinds = TRAIL_KINDS.filter((k) => trails?.some((tr) => tr.kind === k));

  return (
    <div className="hikes">
      <h2 className="view-title">{t.t('hikes.title')}</h2>
      <p className="muted">{t.t('hikes.intro')}</p>
      <div className="chips hikes__filters" role="group" aria-label={t.t('hikes.filter')}>
        {(['all', ...kinds] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {t.t(k === 'all' ? 'hikes.all' : (`hikes.kind.${k}` as Key))}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={busOnly}
          onClick={() => setBusOnly((b) => !b)}
        >
          <Bus size={14} aria-hidden /> {t.t('hikes.busOnly')}
        </button>
      </div>
      {!trails && <p className="muted">{t.t('loading')}</p>}
      {trails && shown.length === 0 && <p className="muted">{t.t('hikes.none')}</p>}
      {REGIONS.map((region) => {
        const list = shown.filter((tr) => trailRegion(tr) === region);
        if (list.length === 0) return null;
        return (
          <section key={region}>
            <h3 className="plan__subtitle">{t.t(regionKey(region))}</h3>
            <div className="trail-list">
              {list.map((tr) => (
                <TrailCard key={tr.id} trail={tr} bus={bus.get(tr.id)} />
              ))}
            </div>
          </section>
        );
      })}
      <p className="muted small">{t.t('hike.timeNote')}</p>
    </div>
  );
}
