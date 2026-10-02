import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LocateFixed, MapPin, X } from 'lucide-react';
import { municipalityName, type StopGroup } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { useNetwork } from '../state/app.tsx';

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
  locating?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** Accessible combobox over stops, with a "my location" shortcut. */
export function PlaceSearch({
  label,
  value,
  onChange,
  onUseLocation,
  locating,
  autoFocus,
  className,
}: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const [query, setQuery] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setQuery(value?.name ?? ''), [value]);

  const results = useMemo<StopGroup[]>(
    () => (open && query && query !== value?.name ? net.searchStops(query, 8) : []),
    [net, query, open, value],
  );

  const pick = (g: StopGroup) => {
    onChange({ name: g.name, lat: g.lat, lon: g.lon, stops: g.stops, kind: 'stop' });
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
            aria-label="Clear"
            onClick={() => {
              onChange(undefined);
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={16} />
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
          {results.map((g, i) => (
            <li
              key={`${g.name}|${g.muni}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(g);
              }}
            >
              <span className="place-search__name">{g.name}</span>
              <span className="place-search__muni">{municipalityName(g.muni)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
