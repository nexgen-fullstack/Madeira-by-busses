import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Loader2, Sparkles } from 'lucide-react';
import { madeiraNow, normalise, type Itinerary } from '@madeirabus/engine';
import { ItineraryCard } from '../components/ItineraryCard.tsx';
import { ItineraryDetail } from '../components/ItineraryDetail.tsx';
import { useMapContent } from '../components/mapContext.tsx';
import { PlaceSearch, type PlaceValue } from '../components/PlaceSearch.tsx';
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
import { useApp, useNetwork } from '../state/app.tsx';

/** Popular trips offered on an empty screen (only those the network can serve). */
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
  const { settings, setTrip } = useApp();
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
  const wantLocation = useRef(false);

  const now = madeiraNow();
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

  // "My location" resolves asynchronously.
  useEffect(() => {
    if (geo.position && wantLocation.current) {
      wantLocation.current = false;
      setParams({ from: encodePlace(geo.position), i: undefined });
    }
  }, [geo.position, setParams]);

  // Plan whenever both ends are known.
  const searchKey =
    from && to
      ? `${encodePlace(from)}>${encodePlace(to)}@${date}T${timeParam ?? 'now'}|${settings.walkSpeed}`
      : '';
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
      .then((r) => !cancelled && setResults(r))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, planner]);

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

  if (selectedIt) {
    return (
      <ItineraryDetail
        it={selectedIt}
        date={date}
        onBack={() => setParams({ i: undefined })}
        onStart={(simulate) => {
          setTrip({ itinerary: selectedIt, date, simulate });
          navigate('trip');
        }}
        onShare={async () => {
          const url = location.href;
          try {
            if (navigator.share) await navigator.share({ title: 'MadeiraBus', url });
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
          onChange={(v) => setParams({ from: v ? encodePlace(v) : undefined, i: undefined })}
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
          onChange={(v) => setParams({ to: v ? encodePlace(v) : undefined, i: undefined })}
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
                aria-label="Date"
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

      {loading && (
        <p className="plan__status" role="status">
          <Loader2 size={16} className="spin" aria-hidden /> {t.t('searching')}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {!loading && results && results.length === 0 && (
        <p className="plan__status">{t.t('results.none')}</p>
      )}

      {results && results.length > 0 && (
        <div className="results" aria-live="polite">
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
          <div className="chips">
            {suggestions.map(([a, b]) => (
              <button
                key={`${a!.name}>${b!.name}`}
                type="button"
                className="chip"
                onClick={() =>
                  setParams({ from: encodePlace(a!), to: encodePlace(b!), i: undefined })
                }
              >
                <Sparkles size={14} aria-hidden /> {a!.name} → {b!.name}
              </button>
            ))}
          </div>
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
