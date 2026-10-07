import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Footprints,
  Loader2,
  Navigation,
  Play,
  Route as RouteIcon,
} from 'lucide-react';
import { haversine, madeiraNow } from '@madeirabus/engine';
import { ItineraryCard } from '../components/ItineraryCard.tsx';
import { ItineraryDetail } from '../components/ItineraryDetail.tsx';
import { ScenicArt } from '../components/ScenicCard.tsx';
import { MapContentContext, useMapContent } from '../components/mapContext.tsx';
import { PlaceSearch, type PlaceValue } from '../components/PlaceSearch.tsx';
import { DayTrips } from '../components/DayTrips.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { findOptions, firstDeparture, type Found } from '../lib/ahead.ts';
import { aheadFrom, capitalise, dayAhead, longDate } from '../lib/format.ts';
import { useGeolocation } from '../lib/geolocation.ts';
import { decodePlace, encodePlace } from '../lib/itinerary.ts';
import { itineraryContent, type MapContent } from '../lib/mapContent.ts';
import { goBack, navigate, type Route } from '../lib/router.ts';
import {
  centreStops,
  CENTRE,
  destinationStops,
  hasPhoto,
  photo,
  reachable,
  tripsByLine,
  walkFromCentre,
  type Destination,
} from '../lib/scenic.ts';
import { useNow } from '../lib/useNow.ts';
import { planOptions, useApp, useNetwork } from '../state/app.tsx';

/** How many ways there to list before "more in the planner". */
const SHOWN = 3;
/** Farther than this from Funchal (m), you are not on the island: the trip starts in its centre. */
const ON_ISLAND = 60_000;

export function DestinationView({ d, route }: { d: Destination; route: Route }) {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { settings, setTrip } = useApp();
  const geo = useGeolocation(false);
  const now = useNow();
  const q = route.query;
  const fromParam = q.get('from');
  const date = q.get('d') ?? now.date;
  const selected = q.get('i') !== null ? Number(q.get('i')) : undefined;
  const served = reachable(net, d);
  const walk = walkFromCentre(d);

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) =>
      navigate(`explore/${d.id}`, { ...Object.fromEntries(q.entries()), ...patch }),
    [d.id, q],
  );

  // Where the trip starts: where you are, as in a maps app, unless you choose a stop, an
  // address or a point on the map; central Funchal when the phone cannot tell where you are
  // or you are not on the island. "none": the field emptied, to type a start.
  const centreName = t.t('scenic.centre');
  const myLocation = t.t('place.myLocation');
  const chosen = useMemo(
    () =>
      fromParam && fromParam !== 'here' && fromParam !== 'none'
        ? decodePlace(net, fromParam, myLocation)
        : undefined,
    [net, fromParam, myLocation],
  );
  const auto = !chosen && fromParam !== 'none';
  const located = useMemo<PlaceValue | undefined>(
    () =>
      geo.position && haversine(geo.position, CENTRE) < ON_ISLAND
        ? { lat: geo.position.lat, lon: geo.position.lon, name: myLocation, kind: 'location' }
        : undefined,
    [geo.position, myLocation],
  );
  const toCentre = auto && !located && (geo.error !== undefined || geo.position !== undefined);
  const origin = useMemo<PlaceValue | undefined>(
    () =>
      chosen ??
      (!auto
        ? undefined
        : (located ??
          (toCentre
            ? { ...CENTRE, name: centreName, stops: centreStops(net), kind: 'location' }
            : undefined))),
    [chosen, auto, located, toCentre, centreName, net],
  );
  useEffect(() => {
    if (auto && !geo.position && !geo.pending && !geo.error) geo.request();
  }, [auto, geo]);
  // Choosing the start on the map: the pin starts where the trip starts now.
  const { setPick } = useContext(MapContentContext);
  useEffect(() => () => setPick(undefined), [setPick]);

  // The ways there, each with its day: today's, or the next day's when none goes any more.
  const [found, setFound] = useState<Found | undefined>();
  const results = found?.options;
  const [loading, setLoading] = useState(false);
  const target = useMemo(() => ({ lat: d.lat, lon: d.lon, name: d.name }), [d]);
  const searchKey = origin
    ? `${encodePlace(origin)}>${d.id}@${date}|${settings.walkSpeed}|${settings.route}`
    : '';
  useEffect(() => {
    if (!origin || !served) {
      setFound(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const today = madeiraNow().date;
    findOptions(
      planner,
      {
        from: origin,
        to: target,
        date,
        // Today from now; another day from the first buses.
        time: date === today ? madeiraNow().time : 5 * 3600,
        options: planOptions(settings),
      },
      // Nothing there any more today: the next day a bus goes.
      date === today,
    )
      .then((r) => !cancelled && setFound(r))
      .catch(() => !cancelled && setFound({ options: [], days: [] }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, planner, served]);

  // The day's direct buses between the centre and the place, both ways.
  const timetable = useMemo(() => {
    if (!served || walk !== undefined) return undefined;
    const centre = centreStops(net);
    const stops = destinationStops(net, d);
    return {
      // Boarded where the bus passes nearest Avenida do Mar, left nearest the place.
      there: tripsByLine(net, centre, stops, date, 'listed'),
      // Back: from the stop nearest the place to the one nearest the centre.
      back: tripsByLine(net, stops, centre, date, 'listed'),
    };
  }, [net, d, date, served, walk]);

  const selectedIt = selected !== undefined ? results?.[selected] : undefined;
  const selectedDay = (selected !== undefined && found?.days[selected]) || date;
  useMapContent(
    useMemo<MapContent>(() => {
      const it = selectedIt ?? results?.find((r) => r.rides > 0);
      if (it) return itineraryContent(net, it, undefined, it === selectedIt);
      return {
        lines: [],
        points: [{ lat: d.lat, lon: d.lon, kind: 'destination', color: '#14181F', label: d.name }],
        fitKey: `place:${d.id}`,
        fit: [
          d,
          { lat: d.lat + 0.01, lon: d.lon + 0.01 },
          { lat: d.lat - 0.01, lon: d.lon - 0.01 },
        ],
      };
    }, [net, d, results, selectedIt]),
  );

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
            if (navigator.share) await navigator.share({ title: d.name, url: location.href });
            else await navigator.clipboard.writeText(location.href);
          } catch {
            // Share sheet dismissed.
          }
        }}
      />
    );
  }

  // A line of the timetable: its way on the map and its timetable from where it is boarded;
  // back returns here.
  const openLine = (route: number, stop: number) =>
    navigate(`lines/${route}`, { s: String(stop), d: q.get('d') ?? undefined });
  const missing = (net.bundle.missingOperators ?? net.bundle.partialOperators)?.join(', ');
  const shownResults = results?.slice(0, SHOWN) ?? [];
  const plannerLink =
    origin &&
    `#/plan?${new URLSearchParams({
      // A start chosen as it is; else a point, not the dozens of central stops, and "my
      // location" unnamed.
      from: chosen
        ? encodePlace(chosen, net)
        : encodePlace({
            lat: origin.lat,
            lon: origin.lon,
            name: origin === located ? undefined : origin.name,
          }),
      to: encodePlace(target),
      ...(q.get('d') ? { d: date, t: '05:00' } : {}),
    })}`;

  return (
    <div className="destination">
      <div className={`destination__hero${hasPhoto(d) ? '' : ' destination__hero--art'}`}>
        {hasPhoto(d) ? (
          <img
            className="destination__photo"
            src={photo(d, 'lg')}
            width={960}
            height={640}
            alt=""
            style={{ backgroundImage: `url("${photo(d, 'sm')}")` }}
          />
        ) : (
          <ScenicArt d={d} className="destination__photo" />
        )}
        <span className="destination__shade" aria-hidden />
        <button
          type="button"
          className="icon-button destination__back"
          onClick={() => goBack('explore')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="destination__title">
          <span className="destination__tag">{t.t(`scenic.${d.id}.tag` as Key)}</span>
          <h2>{d.name}</h2>
        </div>
        {served && (
          <button
            type="button"
            className="destination__start"
            title={t.t('scenic.startHint')}
            // The best way there from where the trip starts (where you are), on the whole map;
            // the sheet with the steps and the timetables comes up from its handle.
            onClick={() => setParams({ i: '0' })}
          >
            <Play size={14} aria-hidden /> {t.t('scenic.start')}
          </button>
        )}
      </div>
      <p className="destination__text">{t.t(`scenic.${d.id}.text` as Key)}</p>

      {!served ? (
        <div className="banner banner--info">
          {t.t('scenic.laterHint', { operators: missing ?? '—' })}
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card__row card__row--wrap">
              <h3 className="card__title">
                <RouteIcon size={16} aria-hidden /> {t.t('scenic.getThere')}
              </h3>
            </div>
            <PlaceSearch
              className="destination__from"
              label={t.t('from')}
              value={origin}
              onChange={(v) => setParams({ from: v ? encodePlace(v, net) : 'none', i: undefined })}
              onUseLocation={() => {
                setParams({ from: undefined, i: undefined });
                geo.request();
              }}
              locating={geo.pending}
              onPickOnMap={(area) => setPick('from', area, origin)}
            />
            {toCentre && <p className="muted small">{t.t('scenic.fromCentreNote')}</p>}
            {(loading || (auto && geo.pending)) && (
              <p className="plan__status" role="status">
                <Loader2 size={16} className="spin" aria-hidden /> {t.t('searching')}
              </p>
            )}
            {!loading && results && results.length === 0 && (
              <p className="muted">{t.t('scenic.noTrips')}</p>
            )}
            {shownResults.length > 0 && found && (
              <div className="results">
                {shownResults.map((it, i) => {
                  const day = found.days[i]!;
                  const later = day !== date;
                  return (
                    <Fragment key={`${day}|${it.key}@${it.depart}`}>
                      {later && found.days[i - 1] !== day && (
                        <div className="banner banner--ahead" role="status">
                          <CalendarClock size={18} aria-hidden />
                          <div>
                            <strong>{t.t('ahead.none')}</strong>
                            {aheadFrom(
                              t,
                              day,
                              now.date,
                              firstDeparture(found.options.filter((_, k) => found.days[k] === day)),
                            )}
                          </div>
                        </div>
                      )}
                      <ItineraryCard
                        it={it}
                        day={later ? capitalise(t, dayAhead(t, day, now.date)) : undefined}
                        now={day === now.date ? now.time : undefined}
                        onSelect={() => setParams({ i: String(i) })}
                      />
                    </Fragment>
                  );
                })}
              </div>
            )}
            {plannerLink && (
              <a
                className="button button--ghost button--block destination__more"
                href={plannerLink}
              >
                <Navigation size={16} aria-hidden /> {t.t('scenic.openPlanner')}
              </a>
            )}
          </section>

          <section className="card day-timetable">
            <div className="card__row card__row--wrap">
              <h3 className="card__title">
                <CalendarClock size={16} aria-hidden />{' '}
                {t.t('lines.timetable', { date: longDate(t, date) })}
              </h3>
              <input
                type="date"
                aria-label={t.t('time.date')}
                value={date}
                min={net.bundle.validity.from}
                max={net.bundle.validity.to}
                onChange={(e) =>
                  e.target.value &&
                  setParams({
                    d: e.target.value === now.date ? undefined : e.target.value,
                    i: undefined,
                  })
                }
              />
            </div>
            {walk !== undefined ? (
              <p className="first-last">
                <Footprints size={16} aria-hidden /> {t.t('scenic.walk', { m: walk })}
              </p>
            ) : timetable && timetable.there.length > 0 ? (
              <>
                <p className="muted small">{t.t('scenic.linesHint')}</p>
                <DayTrips
                  lines={timetable.there}
                  date={date}
                  tag={t.t('scenic.there')}
                  from={centreName}
                  to={d.name}
                  onLine={openLine}
                />
                <DayTrips
                  lines={timetable.back}
                  date={date}
                  tag={t.t('detail.wayBack')}
                  from={d.name}
                  to={centreName}
                  back
                  onLine={openLine}
                />
              </>
            ) : (
              <p className="muted">{t.t('scenic.noDirect')}</p>
            )}
          </section>
        </>
      )}
      {d.credit && (
        <p className="destination__credit muted small">
          <a href={d.credit.source} target="_blank" rel="noopener noreferrer">
            {t.t('scenic.photo', { author: d.credit.author, license: d.credit.license })}
          </a>
        </p>
      )}
    </div>
  );
}
