import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bus, House, LocateFixed, MapPin, MapPinned, Star, X } from 'lucide-react';
import {
  isBusStation,
  municipalityName,
  nameScore,
  searchKey,
  type BPlace,
  type Network,
  type SearchHit,
} from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { loadAddresses, type AddressHit, type AddressIndex } from '../lib/addresses.ts';
import { placeName, poiLabel } from '../lib/mapStyles.ts';
import { savedGroups } from '../lib/saved.ts';
import { useApp, useNetwork } from '../state/app.tsx';

export interface PlaceValue {
  name: string;
  lat: number;
  lon: number;
  /** Explicit stops; absent for "my location" / free points. */
  stops?: number[];
  kind: 'stop' | 'location';
}

/** A stop, a place or an address in the list under the field. */
type Hit = SearchHit | { kind: 'address'; address: AddressHit };

/** A town or village is reached at its bus station when it has one this close (m). */
const TOWN_STATION = 1500;

/** The bus station of a town or village, if it has one. */
function stationOf(net: Network, place: BPlace) {
  if (place.kind !== 'town' && place.kind !== 'village') return undefined;
  let best: { stop: number; distance: number } | undefined;
  for (const h of net.nearbyStops(place, TOWN_STATION)) {
    if (!isBusStation(net.stops[h.stop]!.name)) continue;
    if (!best || h.distance < best.distance) best = h;
  }
  return best && net.stops[best.stop]!;
}

/** "Street," then the number being typed: the list offers the street's houses. */
const CHOOSING_NUMBER = /,\s*\d*[a-z]?\s*$/i;
/** A number at the end: the address comes first. */
const ENDS_WITH_NUMBER = /\d+[a-z]?\s*$/i;

/**
 * Stops, places and addresses for what was typed, best first: towns and
 * villages before the streets and stops that bear their name.
 */
function searchAll(net: Network, addresses: AddressIndex | undefined, query: string): Hit[] {
  const found = addresses?.search(query) ?? [];
  if (CHOOSING_NUMBER.test(query) && found.length > 0) {
    return found.map((address) => ({ kind: 'address', address }));
  }
  const scored = net.search(query, 8).map((hit) => {
    const name = hit.kind === 'stop' ? hit.group.name : hit.place.name;
    const town =
      hit.kind === 'place' && (hit.place.kind === 'town' || hit.place.kind === 'village');
    return { hit: hit as Hit, score: nameScore(query, searchKey(name)) - (town ? 500 : 0) };
  });
  const numbered = ENDS_WITH_NUMBER.test(query);
  return [
    ...scored,
    ...found.map((address) => ({
      hit: { kind: 'address', address } as Hit,
      score: numbered ? -Infinity : address.score,
    })),
  ]
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((s) => s.hit);
}

interface Props {
  label: string;
  value?: PlaceValue;
  onChange: (v: PlaceValue | undefined) => void;
  onUseLocation?: () => void;
  /** Offers "choose on the map" (a café, a hotel, any point). */
  onPickOnMap?: () => void;
  locating?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** Accessible combobox over stops and named places, with a "my location" shortcut. */
export function PlaceSearch({
  label,
  value,
  onChange,
  onUseLocation,
  onPickOnMap,
  locating,
  autoFocus,
  className,
}: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const { settings, saved } = useApp();
  const [query, setQuery] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Streets and house numbers, loaded once someone types.
  const [addresses, setAddresses] = useState<AddressIndex>();

  useEffect(() => setQuery(value?.name ?? ''), [value]);
  useEffect(() => {
    if (addresses || !open || query.length < 2) return;
    let cancelled = false;
    void loadAddresses().then((index) => !cancelled && index && setAddresses(index));
    return () => {
      cancelled = true;
    };
  }, [addresses, open, query]);

  // An empty field offers the saved stops; typing searches stops, places and addresses.
  const showSaved = open && !query && !value;
  const choosingNumber = CHOOSING_NUMBER.test(query);
  const results = useMemo<Hit[]>(
    () =>
      showSaved
        ? savedGroups(net, saved).map((group) => ({ kind: 'stop', group }))
        : open && query && query !== value?.name
          ? searchAll(net, addresses, query)
          : [],
    [net, addresses, query, open, value, saved, showSaved],
  );

  const choose = (v: PlaceValue) => {
    onChange(v);
    setOpen(false);
    inputRef.current?.blur();
  };
  const pick = (hit: Hit) => {
    if (hit.kind === 'stop') {
      const g = hit.group;
      choose({ name: g.name, lat: g.lat, lon: g.lon, stops: g.stops, kind: 'stop' });
    } else if (hit.kind === 'address') {
      const a = hit.address;
      if (a.number === undefined && !choosingNumber) {
        // A street: its name and a comma, for the house number; the list then offers
        // the whole street and its numbers.
        setQuery(`${a.street}, `);
        setActive(0);
        inputRef.current?.focus();
        return;
      }
      choose({ name: a.name, lat: a.lat, lon: a.lon, kind: 'location' });
    } else {
      // A place is a point: the planner walks to whichever stops serve it best. A town
      // or village with a bus station is reached there, where its buses call.
      const p = hit.place;
      const station = stationOf(net, p);
      const at = station ?? p;
      choose({ name: placeName(p, settings.lang), lat: at.lat, lon: at.lon, kind: 'location' });
    }
  };

  return (
    <div className={`place-search ${className ?? ''}`}>
      <label className="place-search__label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="place-search__field">
        <MapPin size={18} aria-hidden className="place-search__icon" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={locating ? t.t('place.locating') : t.t('place.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter' && results[active]) {
              e.preventDefault();
              pick(results[active]!);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label={t.t('place.clear')}
            onClick={() => {
              onChange(undefined);
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
        {onPickOnMap && (
          <button
            type="button"
            className="icon-button"
            aria-label={t.t('place.pickOnMap')}
            title={t.t('place.pickOnMap')}
            onClick={onPickOnMap}
          >
            <MapPinned size={18} />
          </button>
        )}
        {onUseLocation && (
          <button
            type="button"
            className="icon-button"
            aria-label={t.t('place.myLocation')}
            title={t.t('place.myLocation')}
            onClick={onUseLocation}
          >
            <LocateFixed size={18} className={locating ? 'spin' : undefined} />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="place-search__list" role="listbox" id={listId}>
          {results.map((hit, i) => (
            <li
              key={
                hit.kind === 'stop'
                  ? `s|${hit.group.name}|${hit.group.muni}`
                  : hit.kind === 'address'
                    ? `a|${hit.address.name}|${hit.address.lat}|${hit.address.lon}`
                    : `p|${hit.place.name}|${hit.place.lat}|${hit.place.lon}`
              }
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
            >
              {hit.kind === 'stop' ? (
                <>
                  {showSaved ? (
                    <Star
                      size={16}
                      aria-hidden
                      className="place-search__kind place-search__kind--saved"
                    />
                  ) : (
                    <Bus size={16} aria-hidden className="place-search__kind" />
                  )}
                  <span className="place-search__name">{hit.group.name}</span>
                  <span className="place-search__muni">{municipalityName(hit.group.muni)}</span>
                </>
              ) : hit.kind === 'address' ? (
                <>
                  <House size={16} aria-hidden className="place-search__kind" />
                  <span className="place-search__name">{hit.address.name}</span>
                  <span className="place-search__muni">
                    {[
                      hit.address.number === undefined && choosingNumber
                        ? t.t('place.wholeStreet')
                        : undefined,
                      hit.address.near
                        ? t.t('place.nearNumber', { n: hit.address.near })
                        : undefined,
                      hit.address.area,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </>
              ) : (
                <>
                  <MapPin size={16} aria-hidden className="place-search__kind" />
                  <span className="place-search__name">{placeName(hit.place, settings.lang)}</span>
                  <span className="place-search__muni">
                    {[
                      poiLabel(settings.lang, hit.place.kind),
                      stationOf(net, hit.place) ? t.t('place.toStation') : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
