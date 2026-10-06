import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CalendarClock,
  ChevronRight,
  History,
  Loader2,
  MapPinned,
  Sparkles,
} from 'lucide-react';
import { madeiraNow, normalise } from '@madeirabus/engine';
import { ItineraryCard } from '../components/ItineraryCard.tsx';
import { ItineraryDetail } from '../components/ItineraryDetail.tsx';
import { MapContentContext, useMapContent } from '../components/mapContext.tsx';
import { PlaceSearch, type PlaceValue } from '../components/PlaceSearch.tsx';
import { ScenicCard } from '../components/ScenicCard.tsx';
import { useI18n } from '../i18n.ts';
import { dayGroups, findOptions, firstDeparture, type Found } from '../lib/ahead.ts';
import { aheadFrom, capitalise, dayAhead, parseTimeInput, toTimeInput } from '../lib/format.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { decodePlace, encodePlace, optionTags, type OptionTag } from '../lib/itinerary.ts';
import {
  EMPTY_CONTENT,
  itineraryContent,
  placesContent,
  type MapContent,
} from '../lib/mapContent.ts';
import { navigate, type Route } from '../lib/router.ts';
import { DESTINATIONS, reachable } from '../lib/scenic.ts';
import { APP_NAME } from '../lib/site.ts';
import { useNow } from '../lib/useNow.ts';
import { planOptions, useApp, useNetwork } from '../state/app.tsx';

/** Popular trips; the ones whose stops exist in the loaded network are offered. */
const SUGGESTIONS: [string, string][] = [
  // Demo network
  ['Aeroporto', 'Porto Moniz'],
  ['Funchal (Avenida', 'Santana'],
  ['Mercado dos Lavradores', 'Monte'],
  ['Funchal (Avenida', 'Curral das Freiras'],
  // Horários do Funchal
  ['Avenida Mar Alfândega', 'Igreja Curral das Freiras'],
  ['Forum Madeira', 'Monte Tanque'],
  ['Lido', 'Jardim Botânico'],
  ['Madeira Shopping', 'Avenida Mar EEM'],
];

export function PlanView({ route }: { route: Route }) {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { settings, setTrip, recent, addRecent } = useApp();
  const geo = useGeolocation(false);
  const q = route.query;
  // "Choose on the map" ends when the planner closes.
  const { setPick } = useContext(MapContentContext);
  useEffect(() => () => setPick(undefined), [setPick]);

  const myLocation = t.t('place.myLocation');
  const from = useMemo(() => decodePlace(net, q.get('from'), myLocation), [net, q, myLocation]);
  const to = useMemo(() => decodePlace(net, q.get('to'), myLocation), [net, q, myLocation]);
  const timeParam = q.get('t');
  // With a time: be there by it ("a=1"), or leave at it.
  const arriveBy = Boolean(timeParam) && q.get('a') === '1';
  const dateParam = q.get('d');
  const selected = q.get('i') !== null ? Number(q.get('i')) : undefined;

  // The options found, each with its day: today's, and tomorrow's when nothing goes any more.
  const [found, setFound] = useState<Found | undefined>();
  const results = found?.options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [toast, setToast] = useState<string | undefined>();
  // Bumped to plan again when "now" moves past the first option.
  const [refresh, setRefresh] = useState(0);
  const wantLocation = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const shownSearch = useRef('');

  const now = useNow();
  const date = dateParam ?? now.date;
  const time = timeParam ? parseTimeInput(timeParam) : now.time;

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next: Record<string, string | undefined> = Object.fromEntries(q.entries());
      Object.assign(next, patch);
      navigate('plan', next);
    },
    [q],
  );
  const encode = useCallback(
    (p: { stops?: number[]; lat: number; lon: number; name?: string }) => encodePlace(p, net),
    [net],
  );

  const toParam = q.get('to');
  const fromParam = q.get('from');
  // Asked for by the planner itself, not by a tap: then a refusal is not worth a message.
  const autoLocate = useRef(false);

  // "My location" resolves asynchronously.
  useEffect(() => {
    if (geo.position && wantLocation.current) {
      wantLocation.current = false;
      // A start typed in meanwhile stays.
      if (autoLocate.current && fromParam) return;
      setParams({ from: encodePlace(geo.position), i: undefined });
    }
  }, [geo.position, setParams, fromParam]);

  // As in a maps app, a trip to somewhere starts where you are, unless you say otherwise.
  const locatedFor = useRef<string | null>(null);
  const requestLocation = geo.request;
  useEffect(() => {
    if (!toParam || fromParam || locatedFor.current === toParam) return;
    locatedFor.current = toParam;
    const permission = navigator.permissions?.query({ name: 'geolocation' });
    void (permission ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then((status) => {
        if (status?.state === 'denied' || locatedFor.current !== toParam) return;
        wantLocation.current = true;
        autoLocate.current = true;
        requestLocation();
      });
  }, [toParam, fromParam, requestLocation]);

  // Plan whenever both ends are known.
  const baseKey =
    from && to
      ? `${encodePlace(from)}>${encodePlace(to)}@${date}T${timeParam ?? 'now'}${arriveBy ? '<' : ''}|${settings.walkSpeed}|${settings.route}`
      : '';
  const searchKey = baseKey && `${baseKey}|${refresh}`;
  useEffect(() => {
    if (!from || !to) {
      setFound(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    findOptions(
      planner,
      {
        from,
        to,
        date,
        time: timeParam ? parseTimeInput(timeParam) : madeiraNow().time,
        arriveBy,
        options: planOptions(settings),
      },
      // No bus any more today: the first day one goes. Another day chosen is shown as it is.
      date === madeiraNow().date,
    )
      .then((r) => {
        if (cancelled) return;
        setFound(r);
        // Remember named trips ("my location" changes, so it is left out).
        const named = (p: PlaceValue) => p.kind === 'stop' || p.name !== myLocation;
        if (r.options.length > 0 && named(from) && named(to)) {
          addRecent({ from: encode(from), to: encode(to), fromName: from.name, toName: to.name });
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, planner]);

  // Leaving "now" open: once the first option has left, look again.
  const firstGone =
    !timeParam &&
    !loading &&
    date === now.date &&
    results !== undefined &&
    results.length > 0 &&
    found?.days[0] === now.date &&
    results[0]!.depart < now.time - 60;
  useEffect(() => {
    if (firstGone && selected === undefined) setRefresh((r) => r + 1);
  }, [firstGone, selected]);

  // A new search (not the automatic refresh) brings its first result into view.
  useEffect(() => {
    if (!results?.length || loading || shownSearch.current === baseKey) return;
    shownSearch.current = baseKey;
    resultsRef.current?.firstElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [results, loading, baseKey]);

  const selectedIt = selected !== undefined ? results?.[selected] : undefined;
  // The day of the option chosen: a later one when nothing went any more on the day asked.
  const selectedDay = (selected !== undefined && found?.days[selected]) || date;
  // The options in runs of one day; each run has its best, fastest, cheapest…
  const groups = useMemo(() => (found ? dayGroups(found) : []), [found]);
  const tags = useMemo(() => {
    const all = new Map<number, OptionTag[]>();
    for (const g of groups) {
      for (const [k, v] of optionTags(g.options, settings.payment, arriveBy)) {
        all.set(g.start + k, v);
      }
    }
    return all;
  }, [groups, settings.payment, arriveBy]);
  // A step of the selected route tapped: the map shows it close up, as a maps app does.
  const [focusLeg, setFocusLeg] = useState<number | undefined>();
  useEffect(() => setFocusLeg(undefined), [selectedIt]);

  const mapContent = useMemo<MapContent>(() => {
    if (selectedIt) return itineraryContent(net, selectedIt, focusLeg, true);
    if (results?.[0]) return itineraryContent(net, results[0]);
    // Nothing chosen yet: the plain island, as a maps app opens.
    if (!from && !to) return EMPTY_CONTENT;
    const point = (p: PlaceValue | undefined) =>
      p && { lat: p.lat, lon: p.lon, label: p.name, kind: 'stop' as const };
    return placesContent(point(from), point(to));
  }, [selectedIt, results, from, to, net, focusLeg]);
  useMapContent(mapContent);

  const suggestions = useMemo(() => {
    // Only a stop whose name starts with the query: "Aeroporto" must not pick
    // "Estrada Aeroporto", a street in Funchal far from the airport.
    const find = (q: string) =>
      net.searchStops(q, 1).find((g) => normalise(g.name).startsWith(normalise(q)));
    return SUGGESTIONS.map(([a, b]) => [find(a), find(b)] as const)
      .filter((pair) => pair[0] && pair[1])
      .slice(0, 4);
  }, [net]);

  // Places with a view that this timetable's buses reach, for the start screen.
  const scenic = useMemo(() => DESTINATIONS.filter((d) => reachable(net, d)), [net]);

  // Recent trips whose places still exist in this timetable.
  const recentTrips = useMemo(
    () =>
      recent.filter(
        (r) => decodePlace(net, r.from, myLocation) && decodePlace(net, r.to, myLocation),
      ),
    [recent, net, myLocation],
  );

  if (selectedIt) {
    return (
      <ItineraryDetail
        it={selectedIt}
        date={selectedDay}
        ahead={selectedDay !== date}
        onFocusLeg={setFocusLeg}
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
          const url = location.href;
          try {
            if (navigator.share) await navigator.share({ title: APP_NAME, url });
            else {
              await navigator.clipboard.writeText(url);
              setToast(t.t('detail.shared'));
              window.setTimeout(() => setToast(undefined), 2000);
            }
          } catch {
            // Share sheet dismissed.
          }
        }}
      />
    );
  }

  return (
    <div className="plan">
      <form className="plan__form" onSubmit={(e) => e.preventDefault()}>
        <PlaceSearch
          className="plan__from"
          label={t.t('from')}
          value={from}
          onChange={(v) => setParams({ from: v ? encode(v) : undefined, i: undefined })}
          onUseLocation={() => {
            wantLocation.current = true;
            autoLocate.current = false;
            geo.request();
          }}
          locating={geo.pending}
          onPickOnMap={() => setPick('from')}
        />
        <button
          type="button"
          className="plan__swap icon-button"
          aria-label={t.t('swap')}
          title={t.t('swap')}
          onClick={() =>
            setParams({
              from: q.get('to') ?? undefined,
              to: q.get('from') ?? undefined,
              i: undefined,
            })
          }
        >
          <ArrowUpDown size={18} />
        </button>
        <PlaceSearch
          className="plan__to"
          label={t.t('to')}
          value={to}
          onChange={(v) => setParams({ to: v ? encode(v) : undefined, i: undefined })}
          onPickOnMap={() => setPick('to')}
        />
        {geo.error && !autoLocate.current && <p className="error small">{t.t('place.denied')}</p>}
        <div className="plan__time">
          <div className="segmented" role="group" aria-label={t.t('time.depart')}>
            <button
              type="button"
              aria-pressed={!timeParam}
              onClick={() => setParams({ t: undefined, d: undefined, a: undefined, i: undefined })}
            >
              {t.t('time.now')}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(timeParam) && !arriveBy}
              onClick={() => setParams({ t: toTimeInput(time), a: undefined, i: undefined })}
            >
              {t.t('time.depart')}
            </button>
            <button
              type="button"
              aria-pressed={arriveBy}
              onClick={() => setParams({ t: toTimeInput(time), a: '1', i: undefined })}
            >
              {t.t('time.arrive')}
            </button>
          </div>
          {timeParam && (
            <>
              <input
                type="date"
                aria-label={t.t('time.date')}
                value={date}
                min={net.bundle.validity.from}
                max={net.bundle.validity.to}
                onChange={(e) => e.target.value && setParams({ d: e.target.value, i: undefined })}
              />
              <input
                type="time"
                aria-label={t.t(arriveBy ? 'time.arrive' : 'time.depart')}
                value={timeParam}
                onChange={(e) => e.target.value && setParams({ t: e.target.value, i: undefined })}
              />
            </>
          )}
        </div>
      </form>

      {loading && !results?.length && (
        <p className="plan__status" role="status">
          <Loader2 size={16} className="spin" aria-hidden /> {t.t('searching')}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {!loading && results && results.length === 0 && (
        <p className="plan__status">{t.t('results.none')}</p>
      )}

      {results && results.length > 0 && (
        <div className="results" aria-live="polite" aria-busy={loading} ref={resultsRef}>
          {groups.map((g) => {
            // Nothing goes there any more on the day asked: the first day one does, in red.
            const later = g.day !== date;
            const label = later ? capitalise(t, dayAhead(t, g.day, now.date)) : undefined;
            return (
              <Fragment key={g.day}>
                {later && (
                  <div className="banner banner--ahead" role="status">
                    <CalendarClock size={18} aria-hidden />
                    <div>
                      <strong>{t.t('ahead.none')}</strong>
                      {aheadFrom(t, g.day, now.date, firstDeparture(g.options))}
                    </div>
                  </div>
                )}
                {g.options.map((it, k) => (
                  <ItineraryCard
                    key={`${g.day}|${it.key}@${it.depart}`}
                    it={it}
                    best={k === 0 && g.options.length > 1}
                    tags={tags.get(g.start + k)}
                    day={label}
                    now={g.day === now.date ? now.time : undefined}
                    onSelect={() => setParams({ i: String(g.start + k) })}
                  />
                ))}
              </Fragment>
            );
          })}
        </div>
      )}

      {!from && !to && (
        <div className="plan__empty">
          <p className="muted">{t.t('results.hint')}</p>
          <p className="plan__tip small">
            <MapPinned size={16} aria-hidden /> {t.t('plan.mapTip')}
          </p>
          {recentTrips.length > 0 && (
            <>
              <h3 className="plan__subtitle">{t.t('plan.recent')}</h3>
              <div className="chips">
                {recentTrips.map((r) => (
                  <button
                    key={`${r.from}>${r.to}`}
                    type="button"
                    className="chip"
                    onClick={() => setParams({ from: r.from, to: r.to, i: undefined })}
                  >
                    <History size={14} aria-hidden /> {r.fromName} → {r.toName}
                  </button>
                ))}
              </div>
            </>
          )}
          {suggestions.length > 0 && (
            <>
              {recentTrips.length > 0 && <h3 className="plan__subtitle">{t.t('plan.ideas')}</h3>}
              <div className="chips">
                {suggestions.map(([a, b]) => (
                  <button
                    key={`${a!.name}>${b!.name}`}
                    type="button"
                    className="chip"
                    onClick={() => setParams({ from: encode(a!), to: encode(b!), i: undefined })}
                  >
                    <Sparkles size={14} aria-hidden /> {a!.name} → {b!.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {scenic.length > 0 && (
            <>
              <div className="plan__row">
                <h3 className="plan__subtitle">{t.t('plan.scenic')}</h3>
                <a className="plan__more" href="#/explore">
                  {t.t('scenic.all')} <ChevronRight size={14} aria-hidden />
                </a>
              </div>
              <ul className="scenic-strip">
                {scenic.map((d) => (
                  <li key={d.id}>
                    <ScenicCard d={d} size="small" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
