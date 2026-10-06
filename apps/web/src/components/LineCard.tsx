import { useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { addDays, fareClassOf, haversine, type LatLon, type Network } from '@madeirabus/engine';
import { useI18n, type I18n } from '../i18n.ts';
import type { Key } from '../locales/uk.ts';
import { aheadFrom, clock, price } from '../lib/format.ts';
import { lineOf } from '../lib/lines.ts';
import { navigate } from '../lib/router.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';
import { LineSheetBlock } from './LineSheetBlock.tsx';
import { RouteBadge } from './RouteBadge.tsx';

/** A line tapped on the map: which, which way, and where (its stop when known). */
export interface LinePick {
  route: number;
  pattern?: number;
  /** The stop it is boarded at on a route; otherwise the stop of the line nearest the tap. */
  stop?: number;
  at?: LatLon;
}

/** The stop of a pattern nearest a point. */
function nearestStop(net: Network, pattern: number, at: LatLon): number | undefined {
  let best: { stop: number; d: number } | undefined;
  for (const s of net.patterns[pattern]!.stops.slice(0, -1)) {
    const d = haversine(net.stops[s]!, at);
    if (!best || d < best.d) best = { stop: s, d };
  }
  return best?.stop;
}

/** What a ticket on the line costs, from the municipalities its main way runs through. */
function linePrice(net: Network, t: I18n, route: number, pattern: number | undefined) {
  const p = pattern !== undefined ? net.patterns[pattern] : undefined;
  const stops = p ? p.stops : [];
  const munis = new Set(stops.map((s) => net.stops[s]!.muni));
  const first = stops[0] !== undefined ? net.stops[stops[0]]!.muni : '';
  const other = [...munis].find((m) => m !== first) ?? first;
  const fareClass = fareClassOf({
    aerobus: Boolean(net.routes[route]!.aerobus),
    fromMunicipality: first,
    toMunicipality: other,
  });
  const table = net.bundle.fares;
  let amount = t.t('price.unknown');
  if (fareClass !== 'aerobus') {
    const fare = table.single[fareClass];
    amount = `${price(t, fare.giro)} ${t.t('pay.giro')} · ${price(t, fare.cash)} ${t.t('pay.cash')}`;
  } else if (table.aerobus.single !== null) {
    amount = price(t, table.aerobus.single);
  }
  return { label: t.t(`fare.${fareClass}` as Key), amount };
}

/**
 * The card of a line tapped on the map: its number in its colour, where it goes, who
 * runs it and what it costs, the next buses from the stop, and its whole timetable as a
 * picture like the sheets at the bus station, to save in the gallery or send on.
 */
export function LineCard({ pick, onClose }: { pick: LinePick; onClose: () => void }) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  const route = net.routes[pick.route]!;
  const variants = useMemo(() => lineOf(net, pick.route), [net, pick.route]);
  const pattern = pick.pattern ?? net.patterns.findIndex((p) => variants.includes(p.route));
  const stop =
    pick.stop ?? (pick.at && pattern >= 0 ? nearestStop(net, pattern, pick.at) : undefined);
  const agency = net.bundle.agencies[route.agency];
  const fare = linePrice(net, t, pick.route, pattern >= 0 ? pattern : undefined);
  const next = useMemo(() => {
    if (stop === undefined) return [];
    return net
      .departures([stop], now.date, now.time, 60)
      .filter((d) => variants.includes(d.route))
      .slice(0, 4);
  }, [net, stop, now.date, now.time, variants]);
  // None more today: the first bus of the next day it runs from here (within a week).
  const later = useMemo(() => {
    if (stop === undefined || next.length > 0) return undefined;
    for (let d = 1; d <= 7; d++) {
      const date = addDays(now.date, d);
      const first = net.departures([stop], date, 0, 1000).find((x) => variants.includes(x.route));
      if (first) return { date, time: first.time };
    }
    return undefined;
  }, [net, stop, next.length, now.date, variants]);

  // The picture alone, filling the map, to read it or take a screenshot of it whole.
  const [whole, setWhole] = useState(false);
  const headsign = pattern >= 0 ? net.patterns[pattern]!.headsign : route.long;

  return (
    <div
      className={`line-card${whole ? ' line-card--whole' : ''}`}
      role="dialog"
      aria-label={`${route.short} ${headsign}`}
    >
      <div className="line-card__head">
        <RouteBadge route={route} size="lg" />
        <div className="line-card__title">
          <div className="strong">{t.t('detail.towards', { h: headsign })}</div>
          <div className="muted small">
            {[agency?.name, `${fare.label}: ${fare.amount}`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button type="button" className="icon-button" aria-label={t.t('close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {stop !== undefined && (
        <div className="line-card__next small">
          <span className="muted">{t.t('lineCard.next', { stop: net.stops[stop]!.name })}</span>{' '}
          {next.length > 0 ? (
            <span className="strong">{next.map((d) => clock(d.time)).join(' · ')}</span>
          ) : later ? (
            <span className="line-card__ahead">
              {t.t('lineCard.gone')} · {aheadFrom(t, later.date, now.date, later.time, false)}
            </span>
          ) : (
            <span>{t.t('lineCard.none')}</span>
          )}
        </div>
      )}
      <LineSheetBlock
        route={pick.route}
        date={now.date}
        board={stop !== undefined ? { stop, pattern: pick.pattern } : undefined}
        look="card"
        whole={whole}
        onWhole={setWhole}
        onOpenLine={() => {
          onClose();
          navigate(`lines/${variants[0] ?? pick.route}`);
        }}
      />
    </div>
  );
}

/** A short list to choose from when several lines lie under the finger. */
export function LineChooser({
  routes,
  onPick,
  onClose,
}: {
  routes: { route: number; pattern?: number }[];
  onPick: (choice: { route: number; pattern?: number }) => void;
  onClose: () => void;
}) {
  const t = useI18n();
  const { net } = useNetwork();
  return (
    <div className="line-card line-card--choose" role="dialog" aria-label={t.t('lineCard.which')}>
      <div className="line-card__head">
        <div className="line-card__title strong">{t.t('lineCard.which')}</div>
        <button type="button" className="icon-button" aria-label={t.t('close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ul className="line-card__list">
        {routes.map((r) => {
          const route = net.routes[r.route]!;
          const headsign = r.pattern !== undefined ? net.patterns[r.pattern]!.headsign : route.long;
          return (
            <li key={`${r.route}:${r.pattern ?? ''}`}>
              <button type="button" onClick={() => onPick(r)}>
                <RouteBadge route={route} size="sm" />
                <span>{headsign}</span>
                <ChevronRight size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
