import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Flag, Loader2 } from 'lucide-react';
import { haversine, madeiraNow, type Itinerary } from '@madeirabus/engine';
import { ItineraryCard } from '../components/ItineraryCard.tsx';
import { ItineraryDetail } from '../components/ItineraryDetail.tsx';
import { MapContentContext, useMapContent } from '../components/mapContext.tsx';
import { type PlaceValue } from '../components/PlaceSearch.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { RouteFields, type RouteEnd } from '../components/RouteFields.tsx';
import { useI18n } from '../i18n.ts';
import { findOptions, type Found } from '../lib/ahead.ts';
import { clock } from '../lib/format.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { decodePlace, encodePlace } from '../lib/itinerary.ts';
import {
  itineraryContent,
  WAY_WIDTH,
  WAY_YELLOW,
  type MapContent,
  type MapPoint,
} from '../lib/mapContent.ts';
import { goBack, navigate, type Route } from '../lib/router.ts';
import { CENTRE } from '../lib/scenic.ts';
import { useNow } from '../lib/useNow.ts';
import { planOptions, useApp, useNetwork } from '../state/app.tsx';

/** How many ways to list. */
const SHOWN = 3;
/** Farther than this from Funchal (m), you are not on the island: the trip starts at the stop. */
const ON_ISLAND = 60_000;
/** Looked for from this long before the bus leaves the stop (s): time to walk to it. */
const LEAD = 45 * 60;

/** Whether a way takes this very bus. */
const takes = (it: Itinerary, pattern: number, dayTrip: number) =>
  it.legs.some((l) => l.kind === 'ride' && l.pattern === pattern && l.dayTrip === dayTrip);

/**
 * One bus of a line, tapped in its timetable: its way on the map, its stops with their
 * times, and the way from where you are (or its stop) to where you go with it, as in a maps
 * app: "from", "to" and the button that turns the trip round; this bus first.
 */
export function RideView({
  pattern,
  dayTrip,
  route,
}: {
  pattern: number;
  dayTrip: number;
  route: Route;
}) {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { settings, setTrip } = useApp();
  const geo = useGeolocation(false);
  const now = useNow();
  const q = route.query;
  const date = q.get('d') ?? now.date;
  const selected = q.get('i') !== null ? Number(q.get('i')) : undefined;
  const p = net.patterns[pattern];
  const times = useMemo(() => {
    if (!p || net.timetable(date).patterns[pattern]!.start.length <= dayTrip) return [];
    return net.tripStops(pattern, date, dayTrip);
  }, [net, p, pattern, date, dayTrip]);
  const boardPos = Math.max(
    0,
    times.findIndex((x) => String(x.stop) === q.get('s')),
  );
  const board = times[boardPos];
  const end = times[times.length - 1];

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) =>
      navigate(`ride/${pattern}/${dayTrip}`, { ...Object.fromEntries(q.entries()), ...patch }),
    [pattern, dayTrip, q],
  );

  // The two ends: "here", where you are (this bus's stop when the phone cannot tell);
  // "board" and "end", its stop and its last; "none", a field emptied to type in it.
  const myLocation = t.t('place.myLocation');
  const fromToken = q.get('from') ?? 'here';
  const toToken = q.get('to') ?? 'end';
  const stopValue = useCallback(
    (s: number): PlaceValue => {
      const st = net.stops[s]!;
      return { name: st.name, lat: st.lat, lon: st.lon, stops: [s], kind: 'stop' };
    },
    [net],
  );
  const located = useMemo<PlaceValue | undefined>(
    () =>
      geo.position && haversine(geo.position, CENTRE) < ON_ISLAND
        ? { lat: geo.position.lat, lon: geo.position.lon, name: myLocation, kind: 'location' }
        : undefined,
    [geo.position, myLocation],
  );
  const wantsHere = fromToken === 'here' || toToken === 'here';
  const atStop = wantsHere && !located && (geo.error !== undefined || geo.position !== undefined);
  const resolve = useCallback(
    (token: string): PlaceValue | undefined => {
      if (token === 'none' || !board || !end) return undefined;
      if (token === 'board') return stopValue(board.stop);
      if (token === 'end') return stopValue(end.stop);
      if (token === 'here') return located ?? (atStop ? stopValue(board.stop) : undefined);
      return decodePlace(net, token, myLocation);
    },
    [board, end, stopValue, located, atStop, net, myLocation],
  );
  const from = useMemo(() => resolve(fromToken), [resolve, fromToken]);
  const to = useMemo(() => resolve(toToken), [resolve, toToken]);
  useEffect(() => {
    if (wantsHere && !geo.position && !geo.pending && !geo.error) geo.request();
  }, [wantsHere, geo]);
  const { setPick } = useContext(MapContentContext);
  useEffect(() => () => setPick(undefined), [setPick]);

  // The ways with this bus, first; from a while before it leaves its stop.
  const [found, setFound] = useState<Found | undefined>();
  const [loading, setLoading] = useState(false);
  const searchKey =
    from && to && board
      ? `${encodePlace(from)}>${encodePlace(to)}@${date}|${settings.walkSpeed}|${settings.route}`
      : '';
  useEffect(() => {
    if (!from || !to || !board) {
      setFound(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const today = madeiraNow().date;
    const earliest = date === today ? madeiraNow().time : 0;
    const request = { from, to, date, options: planOptions(settings) };
    // Leaving just in time for this bus (the walk to its stop guessed from the crow's
    // flight), so that it is among the ways even when an earlier one gets there sooner.
    const stop = net.stops[board.stop]!;
    const walk = Math.round((haversine(from, stop) * 1.3) / settings.walkSpeed) + 120;
    Promise.all([
      findOptions(
        planner,
        { ...request, time: Math.max(board.dep - LEAD, earliest) },
        date === today,
      ),
      board.dep - walk >= earliest
        ? findOptions(planner, { ...request, time: board.dep - walk }, false)
        : undefined,
    ])
      .then(([around, exact]) => {
        if (cancelled) return;
        const all: { it: Itinerary; day: string }[] = [];
        const seen = new Set<string>();
        for (const r of [exact, around]) {
          r?.options.forEach((it, i) => {
            const key = `${r.days[i]}|${it.key}@${it.depart}`;
            if (seen.has(key)) return;
            seen.add(key);
            all.push({ it, day: r.days[i]! });
          });
        }
        // This bus first; the others in the order they were found (the earliest first).
        const mine = all.filter((x) => takes(x.it, pattern, dayTrip));
        const rest = all
          .filter((x) => !takes(x.it, pattern, dayTrip))
          .sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.it.depart - y.it.depart));
        const sorted = [...mine.slice(0, 1), ...rest, ...mine.slice(1)];
        setFound({ options: sorted.map((x) => x.it), days: sorted.map((x) => x.day) });
      })
      .catch(() => !cancelled && setFound({ options: [], days: [] }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, planner]);
  const results = found?.options;
  const selectedIt = selected !== undefined ? results?.[selected] : undefined;
  const selectedDay = (selected !== undefined && found?.days[selected]) || date;

  // The bus alone on the map until there is a way with it: its line, its stops, a flag at
  // the stop it is taken at.
  useMapContent(
    useMemo<MapContent | undefined>(() => {
      if (!p || !board) return undefined;
      const best = results?.[0];
      if (selectedIt) return itineraryContent(net, selectedIt, undefined, true);
      if (best && takes(best, pattern, dayTrip)) return itineraryContent(net, best);
      const points: MapPoint[] = times.map((x, i) => {
        const st = net.stops[x.stop]!;
        return i === boardPos
          ? {
              lat: st.lat,
              lon: st.lon,
              kind: 'board',
              color: '#ffffff',
              fill: '#14181F',
              label: st.name,
            }
          : { lat: st.lat, lon: st.lon, kind: 'stop', color: '#14181F', fill: WAY_YELLOW };
      });
      const coords = net.lane(pattern);
      return {
        lines: [
          { coords, color: WAY_YELLOW, width: WAY_WIDTH, arrows: true, route: p.route, pattern },
        ],
        points,
        fitKey: `ride:${pattern}:${dayTrip}`,
        fit: coords,
      };
    }, [net, p, board, boardPos, times, results, selectedIt, pattern, dayTrip]),
  );

  if (!p || !board || !end) return <p className="error">?</p>;
  const line = net.routes[p.route]!;

  if (selectedIt) {
    return (
      <ItineraryDetail
        it={selectedIt}
        date={selectedDay}
        ahead={selectedDay !== date}
        onBack={() => setParams({ i: undefined })}
        onStart={(simulate) => {
          setTrip({
            itinerary: selectedIt,
            date: selectedDay,
            simulate,
            generatedAt: net.bundle.generatedAt,
          });
          navigate('trip');
        }}
        onShare={async () => {
          try {
            if (navigator.share) await navigator.share({ title: line.short, url: location.href });
            else await navigator.clipboard.writeText(location.href);
          } catch {
            // Share sheet dismissed.
          }
        }}
      />
    );
  }

  const field = (name: 'from' | 'to', value: PlaceValue | undefined): RouteEnd => ({
    value,
    onChange: (v) => setParams({ [name]: v ? encodePlace(v, net) : 'none', i: undefined }),
    onUseLocation: () => {
      setParams({ [name]: 'here', i: undefined });
      geo.request();
    },
    locating: geo.pending && (name === 'from' ? fromToken : toToken) === 'here',
    onPickOnMap: (area) => setPick(name, area, value),
  });
  const chosenName = to?.kind === 'stop' ? to.name : undefined;

  return (
    <div className="ride">
      <div className="line-hero">
        <button
          type="button"
          className="icon-button line-hero__back"
          onClick={() => goBack('lines')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="line-hero__number">
          <RouteBadge route={line} size="xl" />
        </span>
        <div className="line-hero__text">
          <h2 className="line-hero__name">{t.t('ride.title', { time: clock(board.dep) })}</h2>
          <div className="line-hero__meta">→ {net.stops[end.stop]!.name}</div>
        </div>
      </div>

      <section className="card">
        <div className="plan__form plan__form--flat">
          <RouteFields
            from={field('from', from)}
            to={field('to', to)}
            onSwap={() => setParams({ from: toToken, to: fromToken, i: undefined })}
          />
        </div>
        {atStop && fromToken === 'here' && (
          <p className="muted small">
            {t.t('ride.fromBoardNote', { stop: net.stops[board.stop]!.name })}
          </p>
        )}
        {(loading || (wantsHere && geo.pending)) && (
          <p className="plan__status" role="status">
            <Loader2 size={16} className="spin" aria-hidden /> {t.t('searching')}
          </p>
        )}
        {!loading && results && results.length === 0 && (
          <p className="muted">{t.t('results.none')}</p>
        )}
        {results && results.length > 0 && (
          <div className="results">
            {results.slice(0, SHOWN).map((it, i) => (
              <ItineraryCard
                key={`${found!.days[i]}|${it.key}@${it.depart}`}
                it={it}
                now={found!.days[i] === now.date ? now.time : undefined}
                onSelect={() => setParams({ i: String(i) })}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="card__title">{t.t('ride.stops')}</h3>
        <ol className="ride__stops">
          {times.map((x, i) => {
            const name = net.stops[x.stop]!.name;
            return (
              <li
                key={`${x.stop}-${i}`}
                className={[
                  i < boardPos ? 'is-past' : '',
                  i === boardPos ? 'is-board' : '',
                  i > boardPos && name === chosenName ? 'is-chosen' : '',
                ]
                  .join(' ')
                  .trim()}
              >
                <span className="ride__time">{clock(i === 0 ? x.dep : x.arr)}</span>
                <span className="ride__name">{name}</span>
                {i > boardPos && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t.t('ride.toStop', { stop: name })}
                    title={t.t('ride.toStop', { stop: name })}
                    onClick={() =>
                      setParams({ to: encodePlace(stopValue(x.stop), net), i: undefined })
                    }
                  >
                    <Flag size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
