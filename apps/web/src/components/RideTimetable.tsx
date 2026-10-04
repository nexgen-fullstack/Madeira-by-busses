import { useMemo } from 'react';
import { directConnections, haversine, type Network, type RideLeg } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { lineOf } from '../lib/lines.ts';
import { useNetwork } from '../state/app.tsx';
import { TripsBlock } from './TripsBlock.tsx';

/**
 * Stops within a short walk: buses back often stop across the road or round
 * the corner, under another name, and end at another stop in town.
 */
export function stopsAround(net: Network, stop: number, radius: number): number[] {
  return net
    .nearbyStops(net.stops[stop]!, radius)
    .sort((a, b) => a.distance - b.distance)
    .map((h) => h.stop);
}

function mostCommon(stops: number[]): number {
  const n = new Map<number, number>();
  for (const s of stops) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

interface Props {
  leg: RideLeg;
  date: string;
  /** The same line's buses from where the ride ends back to where it starts. */
  back?: boolean;
}

/**
 * Every bus of the day on the ride's line between its two stops: the first,
 * the last and all in between, with the one the journey takes highlighted.
 */
export function RideTimetable({ leg, date, back = false }: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const trips = useMemo(() => {
    const routes = new Set(lineOf(net, leg.route));
    const board = leg.from.stop!;
    const alight = leg.to.stop!;
    if (!back) return directConnections(net, [board], [alight], date, { routes });
    // Round a short ride's ends the walks overlap: no way back to tell apart.
    if (haversine(net.stops[board]!, net.stops[alight]!) < 1500) return [];
    // Back from the stop nearest where the ride ended to the one nearest where it began.
    return directConnections(
      net,
      stopsAround(net, alight, 400),
      stopsAround(net, board, 600),
      date,
      { routes, pick: 'listed' },
    );
  }, [net, leg, date, back]);
  if (trips.length === 0) return null;
  return (
    <TripsBlock
      route={leg.route}
      from={mostCommon(trips.map((c) => c.from))}
      to={mostCommon(trips.map((c) => c.to))}
      trips={trips}
      date={date}
      tag={back ? t.t('detail.wayBack') : undefined}
      chosen={back ? undefined : leg.start}
    />
  );
}
