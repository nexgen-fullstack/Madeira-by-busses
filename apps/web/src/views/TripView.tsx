import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Bus,
  Flag,
  Footprints,
  Megaphone,
  Satellite,
  TriangleAlert,
  X,
} from 'lucide-react';
import { madeiraNow, RideTracker, type TrackedStop, type TrackState } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { clock } from '../lib/format.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { encodePlace, ridesOf } from '../lib/itinerary.ts';
import type { MapContent, MapPoint } from '../lib/mapContent.ts';
import { navigate } from '../lib/router.ts';
import { RideSimulator } from '../lib/simulator.ts';
import { useApp, useNetwork } from '../state/app.tsx';

const SPEEDUP = 20;

export function TripView() {
  const t = useI18n();
  const { net } = useNetwork();
  const { trip, setTrip } = useApp();
  const [rideIndex, setRideIndex] = useState(0);
  const [phase, setPhase] = useState<'ride' | 'transfer' | 'done'>('ride');
  const [state, setState] = useState<TrackState | undefined>();
  const [driver, setDriver] = useState(false);
  const [notify, setNotify] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );
  const geo = useGeolocation(true);

  const rides = useMemo(() => (trip ? ridesOf(trip.itinerary) : []), [trip]);
  const ride = rides[rideIndex];
  const nextRide = rides[rideIndex + 1];

  const setup = useMemo(() => {
    if (!ride) return undefined;
    const stops: TrackedStop[] = ride.stops.map((s) => {
      const st = net.stops[s.stop]!;
      return { name: st.name, lat: st.lat, lon: st.lon, arr: s.arr, dep: s.dep };
    });
    const shape = net.rideShape(ride.pattern, ride.boardPos, ride.alightPos);
    return {
      stops,
      shape,
      tracker: new RideTracker(stops, shape),
      sim: new RideSimulator(stops, shape),
    };
  }, [ride, net]);

  // Real GPS: start watching unless simulating.
  useEffect(() => {
    if (trip && !trip.simulate) geo.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.simulate]);

  const alertUser = useCallback(
    (s: TrackState) => {
      if (!s.alert || !setup) return;
      const pattern = s.alert === 'next' ? [400, 150, 400, 150, 400] : [200, 100, 200];
      navigator.vibrate?.(pattern);
      const stopName = setup.stops[setup.stops.length - 1]!.name;
      const text =
        s.alert === 'next'
          ? t.t('trip.getOff')
          : s.alert === 'prepare'
            ? t.t('trip.prepare')
            : s.alert === 'arrived'
              ? t.t('trip.arrived')
              : t.t('trip.offRoute');
      if (notify && document.hidden && typeof Notification !== 'undefined') {
        try {
          new Notification(text, { body: stopName, tag: 'madeirabus-trip' });
        } catch {
          // Some mobile browsers only allow notifications from a service worker.
        }
      }
    },
    [notify, setup, t],
  );

  // Simulation clock: 20× real time, starting 45 s before departure.
  const simStart = useRef<number>(0);
  useEffect(() => {
    if (!trip?.simulate || !setup || phase !== 'ride') return;
    simStart.current = performance.now();
    const t0 = setup.stops[0]!.dep - 45;
    const id = window.setInterval(() => {
      const now = t0 + ((performance.now() - simStart.current) / 1000) * SPEEDUP;
      const fix = setup.sim.fixAt(now);
      const s = fix ? setup.tracker.update(fix) : setup.tracker.tick(now);
      setState(s);
      alertUser(s);
    }, 250);
    return () => window.clearInterval(id);
  }, [trip?.simulate, setup, phase, alertUser]);

  // Real GPS fixes.
  useEffect(() => {
    if (trip?.simulate || !setup || phase !== 'ride' || !geo.position) return;
    const s = setup.tracker.update({ ...geo.position, time: madeiraNow().time });
    setState(s);
    alertUser(s);
  }, [geo.position, trip?.simulate, setup, phase, alertUser]);

  // Real mode heartbeat: keeps going on the timetable when GPS goes quiet.
  useEffect(() => {
    if (trip?.simulate || !setup || phase !== 'ride') return;
    const id = window.setInterval(() => {
      const s = setup.tracker.tick(madeiraNow().time);
      setState(s);
      alertUser(s);
    }, 5000);
    return () => window.clearInterval(id);
  }, [trip?.simulate, setup, phase, alertUser]);

  // Arrival → transfer or done.
  useEffect(() => {
    if (state?.status !== 'arrived' || phase !== 'ride') return;
    const id = window.setTimeout(
      () => setPhase(nextRide ? 'transfer' : 'done'),
      trip?.simulate ? 1500 : 3000,
    );
    return () => window.clearTimeout(id);
  }, [state?.status, phase, nextRide, trip?.simulate]);

  // In the simulation, board the next bus automatically.
  useEffect(() => {
    if (phase !== 'transfer' || !trip?.simulate) return;
    const id = window.setTimeout(() => {
      setRideIndex((i) => i + 1);
      setState(undefined);
      setPhase('ride');
    }, 3500);
    return () => window.clearTimeout(id);
  }, [phase, trip?.simulate]);

  const content = useMemo<MapContent | undefined>(() => {
    if (!setup || !ride) return undefined;
    const color = `#${net.routes[ride.route]!.color}`;
    const points: MapPoint[] = setup.stops.map((s, i) => ({
      lat: s.lat,
      lon: s.lon,
      kind: i === setup.stops.length - 1 ? 'alight' : i === 0 ? 'board' : 'stop',
      color,
      label: i === 0 || i === setup.stops.length - 1 ? s.name : undefined,
    }));
    if (state) points.push({ ...state.position, kind: 'bus', color });
    return {
      lines: [{ coords: setup.shape, color, width: 5 }],
      points,
      fitKey: `trip:${rideIndex}`,
      fit: setup.shape,
    };
  }, [setup, ride, net, state, rideIndex]);
  useMapContent(content);

  if (!trip || !ride || !setup) {
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
    history.back();
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
                {geo.error ? t.t('trip.gpsDenied') : t.t('trip.gpsWaiting')}
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
                    from: encodePlace({ ...ride.to, stops: [ride.to.stop!] }),
                    to: encodePlace(dest),
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
            {typeof Notification !== 'undefined' && !notify && (
              <button
                type="button"
                className="button"
                onClick={async () =>
                  setNotify((await Notification.requestPermission()) === 'granted')
                }
              >
                <BellRing size={18} /> {t.t('trip.notify')}
              </button>
            )}
          </div>
          {trip.simulate && <p className="muted small">{t.t('trip.simulateHint')}</p>}
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
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setRideIndex((i) => i + 1);
                setState(undefined);
                setPhase('ride');
              }}
            >
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
