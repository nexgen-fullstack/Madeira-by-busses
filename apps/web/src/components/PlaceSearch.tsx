import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bus, LocateFixed, MapPin, MapPinned, Star, X } from 'lucide-react';
import { municipalityName, type SearchHit } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
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

  useEffect(() => setQuery(value?.name ?? ''), [value]);

  // An empty field offers the saved stops; typing searches stops and places.
  const showSaved = open && !query && !value;
  const results = useMemo<SearchHit[]>(
    () =>
      showSaved
        ? savedGroups(net, saved).map((group) => ({ kind: 'stop', group }))
        : open && query && query !== value?.name
          ? net.search(query, 8)
          : [],
    [net, query, open, value, saved, showSaved],
  );

  const pick = (hit: SearchHit) => {
    if (hit.kind === 'stop') {
      const g = hit.group;
      onChange({ name: g.name, lat: g.lat, lon: g.lon, stops: g.stops, kind: 'stop' });
    } else {
      // A place is a point: the planner walks to whichever stops serve it best.
      const p = hit.place;
      onChange({ name: placeName(p, settings.lang), lat: p.lat, lon: p.lon, kind: 'location' });
    }
    setOpen(false);
    inputRef.current?.blur();
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
              ) : (
                <>
                  <MapPin size={16} aria-hidden className="place-search__kind" />
                  <span className="place-search__name">{placeName(hit.place, settings.lang)}</span>
                  <span className="place-search__muni">
                    {poiLabel(settings.lang, hit.place.kind)}
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
