import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  madeiraNow,
  RideTracker,
  type Network,
  type RideLeg,
  type TrackedStop,
  type TrackState,
} from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { askNotify, canNotify, keepScreenOn, notify, vibrate } from '../lib/device.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { ridesOf } from '../lib/itinerary.ts';
import type { LatLon } from '@madeirabus/engine';
import { RideSimulator } from '../lib/simulator.ts';
import { useApp, type ActiveTrip } from './app.tsx';

/**
 * Following a ride runs at the level of the app, not of the trip screen: the
 * passenger can look up a line or the map mid-ride and still be told when to
 * get off.
 */

const SPEEDUP = 20;

export interface RideSetup {
  stops: TrackedStop[];
  shape: LatLon[];
  tracker: RideTracker;
  sim: RideSimulator;
}

export interface TripTracking {
  rides: RideLeg[];
  rideIndex: number;
  ride?: RideLeg;
  nextRide?: RideLeg;
  setup?: RideSetup;
  state?: TrackState;
  phase: 'ride' | 'transfer' | 'done';
  gpsError?: 'denied' | 'unavailable';
  notifyOn: boolean;
  enableNotify: () => void;
  /** The passenger got on the next bus of a transfer. */
  board: () => void;
}

const TripContext = createContext<TripTracking | undefined>(undefined);

export const useTripTracking = () => useContext(TripContext);

export function TripProvider({ children }: { children: ReactNode }) {
  const { data, trip } = useApp();
  const [value, setValue] = useState<TripTracking | undefined>();
  const net = data.status === 'ready' ? data.net : undefined;
  return (
    <TripContext.Provider value={trip ? value : undefined}>
      {net && trip && (
        <TripEngine
          key={`${trip.itinerary.key}@${trip.itinerary.depart}|${trip.date}|${trip.simulate}`}
          net={net}
          trip={trip}
          onChange={setValue}
        />
      )}
      {children}
    </TripContext.Provider>
  );
}

function TripEngine({
  net,
  trip,
  onChange,
}: {
  net: Network;
  trip: ActiveTrip;
  onChange: (v: TripTracking | undefined) => void;
}) {
  const t = useI18n();
  const { setTrip } = useApp();
  const [rideIndex, setRideIndex] = useState(() => trip.ride ?? 0);
  const [phase, setPhase] = useState<'ride' | 'transfer' | 'done'>('ride');
  const [state, setState] = useState<TrackState | undefined>();
  const [notifyOn, setNotifyOn] = useState(false);

  const rides = useMemo(() => ridesOf(trip.itinerary), [trip.itinerary]);
  const ride = rides[rideIndex];
  const nextRide = rides[rideIndex + 1];
  const finalStop = rides[rides.length - 1]?.to.name ?? '';
  // In the phone app, the ride is followed with the screen off too.
  const geo = useGeolocation(true, {
    title: t.t('trip.bgTitle'),
    text: t.t('trip.bgText', { stop: finalStop }),
  });

  useEffect(() => {
    void canNotify().then(setNotifyOn);
  }, []);

  // The screen stays on while a ride is followed.
  useEffect(() => keepScreenOn(), []);

  // A reopened app resumes at the same ride.
  const tripRef = useRef(trip);
  tripRef.current = trip;
  useEffect(() => {
    const current = tripRef.current;
    if (!current.simulate && current.ride !== rideIndex) setTrip({ ...current, ride: rideIndex });
  }, [rideIndex, setTrip]);

  const setup = useMemo<RideSetup | undefined>(() => {
    if (!ride) return undefined;
    const stops: TrackedStop[] = ride.stops.map((s) => {
      const st = net.stops[s.stop]!;
      return { name: st.name, lat: st.lat, lon: st.lon, arr: s.arr, dep: s.dep };
    });
    // In the bus's lane, as the map draws it: the bus on the line, not beside it.
    const shape = net.rideLane(ride.pattern, ride.boardPos, ride.alightPos);
    return {
      stops,
      shape,
      tracker: new RideTracker(stops, shape),
      sim: new RideSimulator(stops, shape),
    };
  }, [ride, net]);

  // Real GPS: start watching unless simulating.
  useEffect(() => {
    if (!trip.simulate) geo.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alertUser = useCallback(
    (s: TrackState) => {
      if (!s.alert || !setup) return;
      vibrate(s.alert === 'next' ? [400, 150, 400, 150, 400] : [200, 100, 200]);
      const stopName = setup.stops[setup.stops.length - 1]!.name;
      const text =
        s.alert === 'next'
          ? t.t('trip.getOff')
          : s.alert === 'prepare'
            ? t.t('trip.prepare')
            : s.alert === 'arrived'
              ? t.t('trip.arrived')
              : t.t('trip.offRoute');
      if (notifyOn && document.hidden) void notify(text, stopName);
    },
    [notifyOn, setup, t],
  );

  // Simulation clock: 20× real time, starting 45 s before departure.
  useEffect(() => {
    if (!trip.simulate || !setup || phase !== 'ride') return;
    const started = performance.now();
    const t0 = setup.stops[0]!.dep - 45;
    const id = window.setInterval(() => {
      const now = t0 + ((performance.now() - started) / 1000) * SPEEDUP;
      const fix = setup.sim.fixAt(now);
      const s = fix ? setup.tracker.update(fix) : setup.tracker.tick(now);
      setState(s);
      alertUser(s);
    }, 250);
    return () => window.clearInterval(id);
  }, [trip.simulate, setup, phase, alertUser]);

  // Real GPS fixes.
  useEffect(() => {
    if (trip.simulate || !setup || phase !== 'ride' || !geo.position) return;
    const s = setup.tracker.update({ ...geo.position, time: madeiraNow().time });
    setState(s);
    alertUser(s);
  }, [geo.position, trip.simulate, setup, phase, alertUser]);

  // Real mode heartbeat: keeps going on the timetable when GPS goes quiet.
  useEffect(() => {
    if (trip.simulate || !setup || phase !== 'ride') return;
    const id = window.setInterval(() => {
      const s = setup.tracker.tick(madeiraNow().time);
      setState(s);
      alertUser(s);
    }, 5000);
    return () => window.clearInterval(id);
  }, [trip.simulate, setup, phase, alertUser]);

  // Arrival → transfer or done.
  useEffect(() => {
    if (state?.status !== 'arrived' || phase !== 'ride') return;
    const id = window.setTimeout(
      () => setPhase(nextRide ? 'transfer' : 'done'),
      trip.simulate ? 1500 : 3000,
    );
    return () => window.clearTimeout(id);
  }, [state?.status, phase, nextRide, trip.simulate]);

  const board = useCallback(() => {
    setRideIndex((i) => i + 1);
    setState(undefined);
    setPhase('ride');
  }, []);

  // In the simulation, board the next bus automatically.
  useEffect(() => {
    if (phase !== 'transfer' || !trip.simulate) return;
    const id = window.setTimeout(board, 3500);
    return () => window.clearTimeout(id);
  }, [phase, trip.simulate, board]);

  const enableNotify = useCallback(() => {
    void askNotify().then(setNotifyOn);
  }, []);

  const value = useMemo<TripTracking>(
    () => ({
      rides,
      rideIndex,
      ride,
      nextRide,
      setup,
      state,
      phase,
      gpsError: geo.error,
      notifyOn,
      enableNotify,
      board,
    }),
    [
      rides,
      rideIndex,
      ride,
      nextRide,
      setup,
      state,
      phase,
      geo.error,
      notifyOn,
      enableNotify,
      board,
    ],
  );
  useEffect(() => onChange(value), [value, onChange]);
  useEffect(() => () => onChange(undefined), [onChange]);
  return null;
}
