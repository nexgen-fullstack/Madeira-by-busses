import { useMemo } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bus,
  Camera,
  ExternalLink,
  Flag,
  Navigation,
  Split,
  TriangleAlert,
} from 'lucide-react';
import { haversine, trailMinutes, type LatLon, type Trail } from '@madeirabus/engine';
import { useMapContent, useSpotlight } from '../components/mapContext.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { duration } from '../lib/format.ts';
import { encodePlace } from '../lib/itinerary.ts';
import { FLAG_FOOT, TRAIL_RED, type MapContent, type MapPoint } from '../lib/mapContent.ts';
import { photoUrl, trailPhoto, trailPhotoSpots, trailViews } from '../lib/photos.ts';
import { goBack, navigate, replaceRoute } from '../lib/router.ts';
import {
  endOf,
  linesAt,
  nearestStop,
  reversedTrail,
  startOf,
  trailBranches,
  trailById,
  trailLines,
  useTrails,
  type TrailBranch,
} from '../lib/trails.ts';
import { useNetwork } from '../state/app.tsx';
import { TrailBadge, trailKm } from './HikesView.tsx';

/** The regional forestry service, which keeps the PR trails and says when one is closed. */
const IFCN = 'https://ifcn.madeira.gov.pt';

/**
 * The other trails met on the way, each in a colour of its own, none the red of the trail
 * chosen nor the yellow and turquoise of the buses.
 */
const BRANCH_COLORS = ['#1565C0', '#8E24AA', '#2E7D32', '#EF6C00', '#D81B60', '#00838F', '#F9A825'];

/** Each other trail met on the way and its colour, in the order they are met. */
function branchColors(branches: readonly TrailBranch[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const b of branches) {
    if (!colors.has(b.trail.id)) {
      colors.set(b.trail.id, BRANCH_COLORS[colors.size % BRANCH_COLORS.length]!);
    }
  }
  return colors;
}

/** Where other trails turn off this close together (m), they turn off at one place. */
const ONE_JUNCTION = 20;

/** A trail's page, walked from its start or (`reversed`) from its end. */
const hikeHref = (id: string, reversed: boolean) => `hikes/${id}${reversed ? '?rev=1' : ''}`;

/** A start flag, or a chequered one (`finish`), with a name. */
const flag = (p: LatLon, finish: boolean, label?: string): MapPoint => ({
  lat: p.lat,
  lon: p.lon,
  kind: finish ? 'alight' : 'board',
  color: '#ffffff',
  fill: FLAG_FOOT,
  ...(label ? { label } : {}),
});

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

/**
 * One trail: on the map from its start flag to its chequered one, the other trails met on
 * the way each in a colour of its own from a start flag where it turns off to a chequered
 * one where it ends (a tap chooses it), its facts, and the buses to it. Walked `reversed`,
 * its end is its start.
 */
function Hike({ trail: asMapped, reversed }: { trail: Trail; reversed: boolean }) {
  const t = useI18n();
  const { net } = useNetwork();
  const trail = useMemo(
    () => (reversed ? reversedTrail(asMapped) : asMapped),
    [asMapped, reversed],
  );
  const start = startOf(trail);
  const end = endOf(trail);
  const all = useTrails();
  const branches = useMemo(() => (all ? trailBranches(trail, all) : []), [trail, all]);
  const colors = useMemo(() => branchColors(branches), [branches]);

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
      // A loop ends where it started: the two flags side by side.
      const loop = trail.roundtrip ? { pair: true } : {};
      return {
        lines: [
          ...branches.map((b) => ({
            coords: b.coords,
            color: colors.get(b.trail.id)!,
            width: 4.5,
            arrows: true,
            href: hikeHref(b.trail.id, b.reversed),
          })),
          ...lines.map((coords) => ({ coords, color: TRAIL_RED, width: 6, arrows: true })),
        ],
        points: [
          // One start flag where a trail crosses, though it turns off both ways there.
          ...branches
            .map((b) => b.coords[0]!)
            .filter((p, i, all) => all.findIndex((q) => haversine(p, q) < ONE_JUNCTION) === i)
            .map((p) => flag(p, false)),
          ...branches.map((b) => flag(b.coords.at(-1)!, true, b.trail.ref ?? b.trail.name)),
          { ...flag(start, false, trail.name), ...loop },
          { ...flag(end, true), ...loop },
          ...near,
        ],
        // Its photos where they were taken: its own, its viewpoints'.
        scenic: trailPhotoSpots(trail),
        fitKey: `hike:${trail.id}`,
        fit: lines.flat(),
        focus: `hike:${trail.id}`,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trail, net, branches, colors]),
  );
  // Each other trail met, once, as listed under the trail: walked the way it turns off.
  const met = [...colors].map(([id, color]) => {
    const of = branches.filter((b) => b.trail.id === id);
    return { trail: of[0]!.trail, reversed: of.every((b) => b.reversed), color };
  });

  const pic = trailPhoto(trail.id);
  const views = trailViews(trail.id);
  const credits = [
    ...new Map(
      [pic, ...views.map((v) => v.photo)].flatMap((p) => (p ? [[p.file, p] as const] : [])),
    ).values(),
  ];
  // A viewpoint tapped: shown on the map.
  const spot = useSpotlight();
  const minutes = trailMinutes(trail.length, trail.up, trail.down);
  const backSameWay = !trail.roundtrip && !nearestStop(net, end);
  const facts: [Key, string][] = [
    ['hike.length', t.t('scenic.km', { km: trailKm(trail.length, t.locale) })],
    ['hike.time', duration(t, minutes * 60)],
    ['hike.climb', t.t('travel.climb', { up: trail.up, down: trail.down })],
    ['hike.height', t.t('hike.heights', { low: trail.low, high: trail.high })],
  ];
  const kind = (
    <>
      {t.t(`hikes.kind.${trail.kind}` as Key)} ·{' '}
      {t.t(trail.roundtrip ? 'hike.loop' : 'hike.oneWay')}
    </>
  );
  return (
    <div className="hike">
      {pic ? (
        // Its photo, its name over it, as a place with a view.
        <div className="destination__hero hike__hero" data-peek>
          <img
            className="destination__photo"
            src={photoUrl(pic, 'lg')}
            width={960}
            height={640}
            alt=""
            style={{ backgroundImage: `url("${photoUrl(pic, 'sm')}")` }}
          />
          <span className="destination__shade" aria-hidden />
          <button
            type="button"
            className="icon-button destination__back"
            onClick={() => goBack('hikes')}
            aria-label={t.t('back')}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="destination__title">
            <span className="destination__tag">{kind}</span>
            <h2>
              <TrailBadge trail={trail} /> {trail.name}
            </h2>
          </div>
        </div>
      ) : (
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
            <div className="line-hero__meta">{kind}</div>
          </div>
        </div>
      )}

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
          {/* Its end the start: the flags, the arrows, the climb and the buses swap round. */}
          <button
            type="button"
            className="button"
            aria-pressed={reversed}
            onClick={() => replaceRoute(`hikes/${trail.id}`, reversed ? {} : { rev: '1' })}
          >
            <ArrowLeftRight size={16} aria-hidden />{' '}
            {t.t(trail.roundtrip ? 'hike.reverseLoop' : 'hike.reverse')}
          </button>
        </div>
      </section>

      {met.length > 0 && (
        <section className="card">
          <h3 className="card__title">
            <Split size={16} aria-hidden /> {t.t('hike.branches')}
          </h3>
          <p className="muted small">{t.t('hike.branchesNote')}</p>
          <ul className="hike-branches">
            {met.map((m) => (
              <li key={m.trail.id}>
                <button
                  type="button"
                  className="hike-branch"
                  onClick={() => navigate(hikeHref(m.trail.id, m.reversed))}
                >
                  <span
                    className="hike-branch__swatch"
                    style={{ background: m.color }}
                    aria-hidden
                  />
                  <span className="hike-branch__name">
                    <TrailBadge trail={m.trail} /> {m.trail.name}
                  </span>
                  <span className="muted small">
                    {t.t('scenic.km', { km: trailKm(m.trail.length, t.locale) })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {views.length > 0 && (
        <section className="card">
          <h3 className="card__title">
            <Camera size={16} aria-hidden /> {t.t('hike.views')}
          </h3>
          <ul className="hike-views">
            {views.map((v) => (
              <li key={`${v.lat},${v.lon}`}>
                <button
                  type="button"
                  className="hike-view"
                  aria-pressed={spot.isShown(v)}
                  title={t.t('map.showStop')}
                  onClick={() => spot.show({ lat: v.lat, lon: v.lon, name: v.name })}
                >
                  {v.photo ? (
                    <img
                      className="hike-view__photo"
                      src={photoUrl(v.photo, 'sm')}
                      width={480}
                      height={320}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="hike-view__photo hike-view__photo--none" aria-hidden>
                      <Camera size={22} />
                    </span>
                  )}
                  <span className="hike-view__name">{v.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
      {credits.length > 0 && (
        <p className="destination__credit muted small">
          {credits.map((c, i) => (
            <span key={c.file}>
              {i > 0 && ' · '}
              <a href={c.source} target="_blank" rel="noopener noreferrer">
                {t.t('scenic.photo', { author: c.author, license: c.license })}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** A trail's page, once the trails are loaded; `reversed`: walked from its end. */
export function HikeView({ id, reversed = false }: { id: string; reversed?: boolean }) {
  const t = useI18n();
  const trails = useTrails();
  const trail = trailById(trails, id);
  if (!trails) return <p className="muted">{t.t('loading')}</p>;
  if (!trail) return <p className="error">{t.t('hikes.none')}</p>;
  return <Hike key={trail.id} trail={trail} reversed={reversed} />;
}
