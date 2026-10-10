import { ArrowUpDown } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import type { PickArea } from './mapContext.tsx';
import { PlaceSearch, type PlaceValue } from './PlaceSearch.tsx';

/** One end of a trip in the form: the place, and what can be done to it. */
export interface RouteEnd {
  value?: PlaceValue;
  onChange: (v: PlaceValue | undefined) => void;
  onPickOnMap: (area?: PickArea) => void;
  onUseLocation?: () => void;
  locating?: boolean;
}

/**
 * "From", "to" and the button between them that turns the trip round, as in a maps app:
 * the same on the planner, on a place's page and on a bus's trip. Laid out by the grid of
 * `.plan__form` round it.
 */
export function RouteFields({
  from,
  to,
  onSwap,
}: {
  from: RouteEnd;
  to: RouteEnd;
  onSwap: () => void;
}) {
  const t = useI18n();
  return (
    <>
      <PlaceSearch
        className="plan__from"
        label={t.t('from')}
        value={from.value}
        onChange={from.onChange}
        onUseLocation={from.onUseLocation}
        locating={from.locating}
        onPickOnMap={from.onPickOnMap}
      />
      <button
        type="button"
        className="plan__swap icon-button"
        aria-label={t.t('swap')}
        title={t.t('swap')}
        onClick={onSwap}
      >
        <ArrowUpDown size={18} />
      </button>
      <PlaceSearch
        className="plan__to"
        label={t.t('to')}
        value={to.value}
        onChange={to.onChange}
        onUseLocation={to.onUseLocation}
        locating={to.locating}
        onPickOnMap={to.onPickOnMap}
      />
    </>
  );
}
