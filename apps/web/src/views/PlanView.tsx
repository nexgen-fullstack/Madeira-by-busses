import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronRight, History, Loader2, Sparkles } from 'lucide-react';
import { madeiraNow, normalise, type Itinerary } from '@madeirabus/engine';
import { ItineraryCard } from '../components/ItineraryCard.tsx';
import { ItineraryDetail } from '../components/ItineraryDetail.tsx';
import { useMapContent } from '../components/mapContext.tsx';
import { PlaceSearch, type PlaceValue } from '../components/PlaceSearch.tsx';
import { ScenicCard } from '../components/ScenicCard.tsx';
import { useI18n } from '../i18n.ts';
import { parseTimeInput, toTimeInput } from '../lib/format.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { decodePlace, encodePlace } from '../lib/itinerary.ts';
import {
  itineraryContent,
  networkContent,
  stopsContent,
  type MapContent,
} from '../lib/mapContent.ts';
import { navigate, type Route } from '../lib/router.ts';
import { DESTINATIONS, reachable } from '../lib/scenic.ts';
import { APP_NAME } from '../lib/site.ts';
import { useNow } from '../lib/useNow.ts';
import { useApp, useNetwork } from '../state/app.tsx';

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

  const myLocation = t.t('place.myLocation');
  const from = useMemo(() => decodePlace(net, q.get('from'), myLocation), [net, q, myLocation]);
  const to = useMemo(() => decodePlace(net, q.get('to'), myLocation), [net, q, myLocation]);
  const timeParam = q.get('t');
  const dateParam = q.get('d');
  const selected = q.get('i') !== null ? Number(q.get('i')) : undefined;

  const [results, setResults] = useState<Itinerary[] | undefined>();
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

  // "My location" resolves asynchronously.
  useEffect(() => {
    if (geo.position && wantLocation.current) {
      wantLocation.current = false;
      setParams({ from: encodePlace(geo.position), i: undefined });
    }
  }, [geo.position, setParams]);

  // Plan whenever both ends are known.
  const baseKey =
    from && to
      ? `${encodePlace(from)}>${encodePlace(to)}@${date}T${timeParam ?? 'now'}|${settings.walkSpeed}`
      : '';
  const searchKey = baseKey && `${baseKey}|${refresh}`;
  useEffect(() => {
    if (!from || !to) {
      setResults(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    planner
      .plan({
        from,
        to,
        date,
        time: timeParam ? parseTimeInput(timeParam) : madeiraNow().time,
        options: { walkSpeed: settings.walkSpeed },
      })
      .then((r) => {
        if (cancelled) return;
        setResults(r);
        // Remember named trips ("my location" changes, so it is left out).
        const named = (p: PlaceValue) => p.kind === 'stop' || p.name !== myLocation;
        if (r.length > 0 && named(from) && named(to)) {
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

  const mapContent = useMemo<MapContent>(() => {
    if (selectedIt) return itineraryContent(net, selectedIt);
    if (results?.[0] && results[0].rides > 0) return itineraryContent(net, results[0]);
    const pts = [from, to].filter((p): p is PlaceValue => Boolean(p));
    if (pts.length) {
      return stopsContent(
        pts.map((p) => ({ name: p.name, muni: '', stops: p.stops ?? [], lat: p.lat, lon: p.lon })),
        undefined,
        pts.map((p) => encodePlace(p)).join('|'),
      );
    }
    return networkContent(net);
  }, [net, selectedIt, results, from, to]);
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
        date={date}
        onBack={() => setParams({ i: undefined })}
        onStart={(simulate) => {
          setTrip({
            itinerary: selectedIt,
            date,
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
            geo.request();
          }}
          locating={geo.pending}
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
        />
        {geo.error && <p className="error small">{t.t('place.denied')}</p>}
        <div className="plan__time">
          <div className="segmented" role="group" aria-label={t.t('time.depart')}>
            <button
              type="button"
              aria-pressed={!timeParam}
              onClick={() => setParams({ t: undefined, d: undefined, i: undefined })}
            >
              {t.t('time.now')}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(timeParam)}
              onClick={() => setParams({ t: toTimeInput(time), i: undefined })}
            >
              {t.t('time.depart')}
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
                aria-label={t.t('time.depart')}
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
          {results.map((it, i) => (
            <ItineraryCard
              key={`${it.key}@${it.depart}`}
              it={it}
              now={date === now.date ? now.time : undefined}
              onSelect={() => setParams({ i: String(i) })}
            />
          ))}
        </div>
      )}

      {!from && !to && (
        <div className="plan__empty">
          <p className="muted">{t.t('results.hint')}</p>
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
