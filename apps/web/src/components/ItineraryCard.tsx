import { AlertTriangle, ChevronRight, Footprints } from 'lucide-react';
import type { Itinerary } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { clock, duration, price } from '../lib/format.ts';
import { useApp, useNetwork } from '../state/app.tsx';
import { RouteBadge } from './RouteBadge.tsx';

interface Props {
  it: Itinerary;
  /** Seconds after midnight now, when planning for today. */
  now?: number;
  onSelect: () => void;
}

export function ItineraryCard({ it, now, onSelect }: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const { settings } = useApp();
  const fare = settings.payment === 'cash' ? it.fare.cash : it.fare.giro;
  const leaveIn = now !== undefined ? Math.round((it.depart - now) / 60) : undefined;

  return (
    <button type="button" className="it-card" onClick={onSelect}>
      <div className="it-card__top">
        <span className="it-card__times">
          {clock(it.depart)} – {clock(it.arrive)}
        </span>
        <span className="it-card__duration">{duration(t, it.duration)}</span>
      </div>
      <div className="it-card__legs" aria-hidden>
        {it.legs.map((leg, i) => (
          <span key={i} className="it-card__leg">
            {i > 0 && <ChevronRight size={14} className="it-card__sep" />}
            {leg.kind === 'walk' ? (
              <span className="walk-chip">
                <Footprints size={14} />
                {Math.max(1, Math.round((leg.end - leg.start) / 60))}
              </span>
            ) : (
              <RouteBadge route={net.routes[leg.route]!} size="sm" />
            )}
          </span>
        ))}
      </div>
      <div className="it-card__meta">
        {leaveIn !== undefined && leaveIn >= 0 && leaveIn <= 120 && (
          <span className="it-card__leave">
            {leaveIn === 0 ? t.t('it.leaveNow') : t.tn('it.leaveIn', leaveIn)}
          </span>
        )}
        <span>
          {it.rides === 0
            ? t.t('it.walkOnly')
            : it.transfers === 0
              ? t.t('it.direct')
              : t.tn('it.transfers', it.transfers)}
        </span>
        {it.rides > 0 && (
          <span className="it-card__price">
            {fare !== null ? price(t, fare) : t.t('price.unknown')}
          </span>
        )}
        {it.risky && (
          <span className="it-card__risky" title={t.t('it.riskyHint')}>
            <AlertTriangle size={14} aria-hidden /> {t.t('it.risky')}
          </span>
        )}
      </div>
    </button>
  );
}
