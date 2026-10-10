import { useMemo } from 'react';
import { ArrowLeft, Bus, ExternalLink, Flag, Navigation, TriangleAlert } from 'lucide-react';
import { trailMinutes, type LatLon, type Trail } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { duration } from '../lib/format.ts';
import { encodePlace } from '../lib/itinerary.ts';
import { FLAG_FOOT, TRAIL_RED, type MapContent, type MapPoint } from '../lib/mapContent.ts';
import { goBack, navigate } from '../lib/router.ts';
import {
  endOf,
  linesAt,
  nearestStop,
  startOf,
  trailById,
  trailLines,
  useTrails,
} from '../lib/trails.ts';
import { useNetwork } from '../state/app.tsx';
import { TrailBadge, trailKm } from './HikesView.tsx';

/** The regional forestry service, which keeps the PR trails and says when one is closed. */
const IFCN = 'https://ifcn.madeira.gov.pt';

/** A bus stop near an end of a trail: its name, how far, its lines. */
function StopNear({ at, label }: { at: LatLon; label: string }) {
  const t = useI18n();
  const { net } = useNetwork();
  const near = nearestStop(net, at);
  return (
    <div className="hike-stop">
      <div className="hike-stop__label">{label}</div>
      {near ? (
        <button
          type="button"
          className="hike-stop__stop"
          onClick={() => navigate('stop', { ids: String(near.stop) })}
        >
          <Bus size={15} aria-hidden />{' '}
          {t.t('hike.stopNear', { stop: net.stops[near.stop]!.name, m: near.metres })}
          <span className="muted small">
            {' '}
            · {t.t('hike.lines', { lines: linesAt(net, near.stop).join(', ') })}
          </span>
        </button>
      ) : (
        <p className="muted small">{t.t('hike.noStop')}</p>
      )}
    </div>
  );
}

/** One trail: on the map from its start flag to its end, its facts, and the buses to it. */
function Hike({ trail }: { trail: Trail }) {
  const t = useI18n();
  const { net } = useNetwork();
  const start = startOf(trail);
  const end = endOf(trail);

  useMapContent(
    useMemo<MapContent>(() => {
      const lines = trailLines(trail);
      const near = [start, ...(trail.roundtrip ? [] : [end])].flatMap((p) => {
        const s = nearestStop(net, p);
        if (!s) return [];
        const st = net.stops[s.stop]!;
        return [
          {
            lat: st.lat,
            lon: st.lon,
            kind: 'stop',
            color: '#002F85',
            label: st.name,
            stops: [s.stop],
          },
        ] as MapPoint[];
      });
      return {
        lines: lines.map((coords) => ({ coords, color: TRAIL_RED, width: 6, arrows: true })),
        points: [
          { ...start, kind: 'board', color: '#ffffff', fill: FLAG_FOOT, label: trail.name },
          ...(trail.roundtrip
            ? []
            : [{ ...end, kind: 'alight' as const, color: '#ffffff', fill: FLAG_FOOT }]),
          ...near,
        ],
        fitKey: `hike:${trail.id}`,
        fit: lines.flat(),
        focus: `hike:${trail.id}`,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trail, net]),
  );

  const minutes = trailMinutes(trail.length, trail.up, trail.down);
  const backSameWay = !trail.roundtrip && !nearestStop(net, end);
  const facts: [Key, string][] = [
    ['hike.length', t.t('scenic.km', { km: trailKm(trail.length, t.locale) })],
    ['hike.time', duration(t, minutes * 60)],
    ['hike.climb', t.t('travel.climb', { up: trail.up, down: trail.down })],
    ['hike.height', t.t('hike.heights', { low: trail.low, high: trail.high })],
  ];
  return (
    <div className="hike">
      <div className="line-hero">
        <button
          type="button"
          className="icon-button line-hero__back"
          onClick={() => goBack('hikes')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="line-hero__text">
          <h2 className="line-hero__name">
            <TrailBadge trail={trail} /> {trail.name}
          </h2>
          <div className="line-hero__meta">
            {t.t(`hikes.kind.${trail.kind}` as Key)} ·{' '}
            {t.t(trail.roundtrip ? 'hike.loop' : 'hike.oneWay')}
          </div>
        </div>
      </div>

      <dl className="hike__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{t.t(k)}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="card">
        <h3 className="card__title">
          <Bus size={16} aria-hidden /> {t.t('hike.byBus')}
        </h3>
        <StopNear at={start} label={t.t('hike.start')} />
        {!trail.roundtrip && <StopNear at={end} label={t.t('hike.end')} />}
        {/* No bus at its end: back the same way, as most walk PR 8 or the 25 Fontes. */}
        {backSameWay && (
          <p className="small hike__back">
            {t.t('hike.backSameWay', {
              time: duration(t, (minutes + trailMinutes(trail.length, trail.down, trail.up)) * 60),
            })}
          </p>
        )}
        <div className="detail__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate('plan', { to: encodePlace({ ...start, name: trail.name }) })}
          >
            <Navigation size={16} aria-hidden /> {t.t('hike.routeTo')}
          </button>
          {!trail.roundtrip && !backSameWay && (
            <button
              type="button"
              className="button"
              onClick={() => navigate('plan', { from: encodePlace({ ...end, name: trail.name }) })}
            >
              <Flag size={16} aria-hidden /> {t.t('hike.routeFrom')}
            </button>
          )}
        </div>
      </section>

      <div className="banner banner--warn hike__safety">
        <TriangleAlert size={18} aria-hidden />
        <div>
          {t.t('hike.safety')}{' '}
          <a href={IFCN} target="_blank" rel="noopener noreferrer">
            {t.t('hike.official')}
          </a>
        </div>
      </div>
      <p className="muted small">
        {t.t('hike.timeNote')}{' '}
        <a
          href={`https://www.openstreetmap.org/relation/${trail.osm}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.t('hike.osm')} <ExternalLink size={12} aria-hidden />
        </a>
      </p>
    </div>
  );
}

/** A trail's page, once the trails are loaded. */
export function HikeView({ id }: { id: string }) {
  const t = useI18n();
  const trails = useTrails();
  const trail = trailById(trails, id);
  if (!trails) return <p className="muted">{t.t('loading')}</p>;
  if (!trail) return <p className="error">{t.t('hikes.none')}</p>;
  return <Hike key={trail.id} trail={trail} />;
}
