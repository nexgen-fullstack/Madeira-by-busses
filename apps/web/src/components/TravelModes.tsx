import { useEffect, useState } from 'react';
import { Bike, Bus, Car, Footprints, Navigation } from 'lucide-react';
import type { LatLon, Travel, TravelMode } from '@madeirabus/engine';
import { useI18n, type Key } from '../i18n.ts';
import { duration } from '../lib/format.ts';
import { useApp, useNetwork } from '../state/app.tsx';

/** How to go, as the row of a maps app: by bus (the app's own), car, on foot or by bike. */
export type Mode = 'bus' | TravelMode;
export const MODES: readonly Mode[] = ['bus', 'car', 'walk', 'bike'];
const ICONS = { bus: Bus, car: Car, walk: Footprints, bike: Bike } as const;

/** A mode from the address (`m`): the bus unless another is asked for. */
export const modeOf = (value: string | null): Mode =>
  value === 'car' || value === 'walk' || value === 'bike' ? value : 'bus';

/** Going from `from` to `to` by car, on foot and by bike, worked out once both are known. */
export function useTravels(
  from: LatLon | undefined,
  to: LatLon | undefined,
): { travels: Partial<Record<TravelMode, Travel | null>>; loading: boolean } {
  const { planner } = useNetwork();
  const { settings } = useApp();
  const [travels, setTravels] = useState<Partial<Record<TravelMode, Travel | null>>>({});
  const [loading, setLoading] = useState(false);
  const key =
    from && to
      ? `${from.lat.toFixed(5)},${from.lon.toFixed(5)}>${to.lat.toFixed(5)},${to.lon.toFixed(5)}|${settings.walkSpeed}`
      : '';
  useEffect(() => {
    if (!from || !to) {
      setTravels({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    const modes: TravelMode[] = ['car', 'walk', 'bike'];
    planner
      .travel(modes, from, to, settings.walkSpeed)
      .then(
        (r) => !cancelled && setTravels(Object.fromEntries(modes.map((m, i) => [m, r[i] ?? null]))),
      )
      .catch(() => !cancelled && setTravels({}))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, planner]);
  return { travels, loading };
}

/**
 * The row of ways to go, each with how long it takes (the bus: its best option's time), as
 * in a maps app; the one chosen is pressed.
 */
export function ModeTabs({
  mode,
  onMode,
  bus,
  travels,
  loading,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  /** The best bus's time (s), when there is one. */
  bus?: number;
  travels: Partial<Record<TravelMode, Travel | null>>;
  loading: boolean;
}) {
  const t = useI18n();
  return (
    <div className="modes" role="group" aria-label={t.t('mode.label')}>
      {MODES.map((m) => {
        const Icon = ICONS[m];
        const seconds = m === 'bus' ? bus : (travels[m]?.seconds ?? undefined);
        const time =
          seconds !== undefined
            ? duration(t, seconds)
            : m !== 'bus' && loading
              ? '…'
              : m === 'bus' || travels[m] === null
                ? '—'
                : '…';
        return (
          <button
            key={m}
            type="button"
            className={`modes__item modes__item--${m}`}
            aria-pressed={mode === m}
            aria-label={`${t.t(`mode.${m}` as Key)}: ${time}`}
            onClick={() => onMode(m)}
          >
            <Icon size={18} aria-hidden />
            <span>{time}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The way by car, on foot or by bike: how long, how far, how much up and down; to follow it. */
export function TravelCard({
  mode,
  travel,
  loading,
}: {
  mode: TravelMode;
  travel: Travel | null | undefined;
  loading: boolean;
}) {
  const t = useI18n();
  if (!travel) {
    return <p className="muted travel__none">{loading ? t.t('searching') : t.t('travel.none')}</p>;
  }
  const km = (travel.length / 1000).toLocaleString(t.locale, {
    maximumFractionDigits: travel.length < 10_000 ? 1 : 0,
  });
  const ends = [travel.path[0]!, travel.path[travel.path.length - 1]!];
  // Turn-by-turn on the phone's own maps: the app shows the way, Google Maps leads it.
  const navigate = `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: '1',
    origin: `${ends[0]!.lat.toFixed(5)},${ends[0]!.lon.toFixed(5)}`,
    destination: `${ends[1]!.lat.toFixed(5)},${ends[1]!.lon.toFixed(5)}`,
    travelmode: mode === 'car' ? 'driving' : mode === 'bike' ? 'bicycling' : 'walking',
  })}`;
  const Icon = ICONS[mode];
  return (
    <section className={`card travel travel--${mode}`}>
      <div className="travel__head">
        <Icon size={22} aria-hidden className="travel__icon" />
        <div>
          <div className="travel__time">{duration(t, travel.seconds)}</div>
          <div className="muted small">
            {t.t('scenic.km', { km })}
            {travel.up !== undefined && travel.up >= 10 && (
              <>
                {' · '}
                {t.t('travel.climb', {
                  up: Math.round(travel.up),
                  down: Math.round(travel.down ?? 0),
                })}
              </>
            )}
          </div>
        </div>
      </div>
      <p className="muted small">{t.t(`travel.${mode}.note` as Key)}</p>
      <a className="button button--block" href={navigate} target="_blank" rel="noopener noreferrer">
        <Navigation size={16} aria-hidden /> {t.t('travel.navigate')}
      </a>
    </section>
  );
}
