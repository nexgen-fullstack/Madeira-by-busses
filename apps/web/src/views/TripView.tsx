import { useMemo, useState } from 'react';
import {
  BellRing,
  Bus,
  Flag,
  Footprints,
  Info,
  Megaphone,
  Satellite,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useMapContent } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { isNative } from '../lib/device.ts';
import { clock } from '../lib/format.ts';
import { encodePlace } from '../lib/itinerary.ts';
import {
  RIDE_END,
  RIDE_START,
  rideColor,
  type MapContent,
  type MapPoint,
} from '../lib/mapContent.ts';
import { goBack, navigate } from '../lib/router.ts';
import { useApp, useNetwork } from '../state/app.tsx';
import { useTripTracking } from '../state/trip.tsx';

/** The ride being followed (the following itself runs in state/trip.tsx). */
export function TripView() {
  const t = useI18n();
  const { net } = useNetwork();
  const { trip, setTrip } = useApp();
  const tracking = useTripTracking();
  const [driver, setDriver] = useState(false);
  const {
    rides = [],
    rideIndex = 0,
    ride,
    nextRide,
    setup,
    state,
    phase = 'ride',
  } = tracking ?? {};

  const content = useMemo<MapContent | undefined>(() => {
    if (!setup || !ride) return undefined;
    const color = `#${net.routes[ride.route]!.color}`;
    const last = setup.stops.length - 1;
    const points: MapPoint[] = setup.stops.map((s, i) => ({
      lat: s.lat,
      lon: s.lon,
      kind: i === last ? 'alight' : i === 0 ? 'board' : 'stop',
      // Boarded at the red dot, left at the dark blue one, as on the route.
      color: i === 0 || i === last ? '#ffffff' : '#14181F',
      ...(i === 0 ? { fill: RIDE_START } : i === last ? { fill: RIDE_END } : {}),
      label: i === 0 || i === last ? s.name : undefined,
    }));
    if (state) points.push({ ...state.position, kind: 'bus', color });
    // The ride in the colour it has on the route, alone on the map.
    return {
      lines: [{ coords: setup.shape, color: rideColor(rideIndex), width: 6, arrows: true }],
      points,
      fitKey: `trip:${rideIndex}`,
      fit: setup.shape,
      focus: 'trip',
    };
  }, [setup, ride, net, state, rideIndex]);
  useMapContent(content);

  if (!trip || !tracking || !ride || !setup) {
    return (
      <div className="trip">
        <p className="muted">{t.t('trip.done')}</p>
        <button type="button" className="button" onClick={() => navigate('plan')}>
          {t.t('back')}
        </button>
      </div>
    );
  }

  const route = net.routes[ride.route]!;
  const alightName = setup.stops[setup.stops.length - 1]!.name;
  const end = () => {
    setTrip(undefined);
    goBack('plan');
  };

  const walkBefore = nextRide
    ? trip.itinerary.legs
        .slice(trip.itinerary.legs.indexOf(ride) + 1, trip.itinerary.legs.indexOf(nextRide))
        .find((l) => l.kind === 'walk')
    : undefined;
  const walkSeconds = walkBefore ? walkBefore.end - walkBefore.start : 0;
  const missing = Boolean(
    nextRide &&
    state &&
    phase === 'ride' &&
    !setup.tracker.canConnect(state, nextRide.start, walkSeconds),
  );

  const status = state?.status ?? 'waiting';
  const headline =
    status === 'next'
      ? t.t('trip.getOff')
      : status === 'prepare'
        ? t.t('trip.prepare')
        : status === 'arrived'
          ? t.t('trip.arrived')
          : status === 'off-route'
            ? t.t('trip.offRoute')
            : t.t('trip.ride', { route: route.short });

  return (
    <div className="trip">
      <div className="trip__header">
        <RouteBadge route={route} size="lg" />
        <div className="trip__headsign">
          <div className="strong">{ride.headsign}</div>
          <div className="muted small">
            {rides.length > 1 && `${rideIndex + 1}/${rides.length} · `}
            {trip.simulate
              ? t.t('trip.simulate')
              : state?.source === 'timetable'
                ? t.t('trip.gpsLost')
                : 'GPS'}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={end} aria-label={t.t('trip.end')}>
          <X size={20} />
        </button>
      </div>

      {phase === 'ride' && (
        <>
          <section className={`trip__status trip__status--${status}`} aria-live="assertive">
            <div className="trip__headline">
              {status === 'next' && <Megaphone size={22} aria-hidden />}
              {status === 'off-route' && <TriangleAlert size={22} aria-hidden />}
              {headline}
            </div>
            {status === 'next' && <div className="trip__hint">{t.t('trip.pressStop')}</div>}
            <div className="trip__label">{t.t('trip.next')}</div>
            <div className="trip__stop">
              {state ? setup.stops[state.nextStop]!.name : setup.stops[1]?.name}
            </div>
            {state && (
              <div className="trip__facts">
                {state.stopsRemaining > 0 && <span>{t.tn('trip.left', state.stopsRemaining)}</span>}
                <span>{t.t('trip.eta', { t: clock(state.eta) })}</span>
                <span>
                  {Math.abs(state.delay) < 60
                    ? t.t('trip.onTime')
                    : state.delay > 0
                      ? t.t('trip.late', { n: Math.round(state.delay / 60) })
                      : t.t('trip.early', { n: Math.round(-state.delay / 60) })}
                </span>
              </div>
            )}
            {!state && !trip.simulate && (
              <div className="trip__facts">
                {tracking.gpsError ? t.t('trip.gpsDenied') : t.t('trip.gpsWaiting')}
              </div>
            )}
            {state?.source === 'timetable' && (
              <div className="trip__gps">
                <Satellite size={14} aria-hidden /> {t.t('trip.gpsLost')}
              </div>
            )}
          </section>

          {missing && nextRide && (
            <div className="banner banner--warn" role="alert">
              <TriangleAlert size={16} aria-hidden />
              <span>{t.t('trip.missed')}</span>
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  const last = trip.itinerary.legs[trip.itinerary.legs.length - 1]!;
                  const dest =
                    last.kind === 'ride' ? { ...last.to, stops: [last.to.stop!] } : last.to;
                  navigate('plan', {
                    from: encodePlace({ ...ride.to, stops: [ride.to.stop!] }, net),
                    to: encodePlace(dest, net),
                    t: clock(state!.eta),
                    d: trip.date,
                  });
                }}
              >
                {t.t('trip.replan')}
              </button>
            </div>
          )}

          <ol className="trip__stops" style={{ ['--route' as string]: `#${route.color}` }}>
            {setup.stops.map((s, i) => {
              const passed = state ? i < state.nextStop : i === 0;
              const isNext = state ? i === state.nextStop : i === 1;
              return (
                <li
                  key={`${s.name}-${i}`}
                  className={`${passed ? 'is-passed' : ''} ${isNext ? 'is-next' : ''} ${i === setup.stops.length - 1 ? 'is-alight' : ''}`}
                >
                  <span className="trip__stop-time">{clock(s.arr)}</span>
                  <span className="trip__stop-name">{s.name}</span>
                  {i === setup.stops.length - 1 && <Flag size={14} aria-hidden />}
                </li>
              );
            })}
          </ol>

          <div className="detail__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => setDriver(true)}
            >
              <Bus size={18} /> {t.t('trip.showDriver')}
            </button>
            {!tracking.notifyOn && (isNative() || typeof Notification !== 'undefined') && (
              <button type="button" className="button" onClick={tracking.enableNotify}>
                <BellRing size={18} /> {t.t('trip.notify')}
              </button>
            )}
          </div>
          {trip.simulate && <p className="muted small">{t.t('trip.simulateHint')}</p>}
          {!trip.simulate && !isNative() && (
            <p className="muted small trip__note">
              <Info size={14} aria-hidden /> {t.t('trip.keepOpen')}
            </p>
          )}
        </>
      )}

      {phase === 'transfer' && nextRide && (
        <section className="trip__status trip__status--transfer">
          <div className="trip__headline">
            {t.t('trip.transfer', { route: net.routes[nextRide.route]!.short })}
          </div>
          {walkBefore && (
            <div className="trip__facts">
              <Footprints size={16} aria-hidden />{' '}
              {t.t('trip.walkTo', {
                stop: nextRide.from.name,
                m: Math.max(1, Math.round(walkSeconds / 60)),
              })}
            </div>
          )}
          <div className="trip__stop">
            {t.t('trip.waitBus', {
              route: net.routes[nextRide.route]!.short,
              t: clock(nextRide.start),
            })}
          </div>
          <div className="muted">{nextRide.from.name}</div>
          {!trip.simulate && (
            <button type="button" className="button button--primary" onClick={tracking.board}>
              <Bus size={18} /> {t.t('detail.board')}
            </button>
          )}
        </section>
      )}

      {phase === 'done' && (
        <section className="trip__status trip__status--arrived">
          <div className="trip__headline">{t.t('trip.done')}</div>
          <button type="button" className="button" onClick={end}>
            {t.t('trip.end')}
          </button>
        </section>
      )}

      {driver && (
        <div className="driver" role="dialog" aria-modal="true" onClick={() => setDriver(false)}>
          <div className="driver__text">{t.t('trip.driverText')}</div>
          <div className="driver__stop">{alightName}</div>
          <div className="driver__route">
            <RouteBadge route={route} size="lg" />
          </div>
        </div>
      )}
    </div>
  );
}
