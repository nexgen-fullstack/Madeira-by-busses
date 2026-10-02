import type { Network } from '@madeirabus/engine';

/** One public line ("181") with all its route variants from the feed. */
export interface LineGroup {
  agency: number;
  short: string;
  /** Route indices; the main variant (most bus-stops served a day) first. */
  routes: number[];
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Groups route variants into the lines passengers know. Feeds such as
 * Horários do Funchal publish every variant of a line as its own route
 * (181 has 13), which would otherwise flood the list of lines.
 */
export function lineGroups(net: Network): LineGroup[] {
  // Weighing trips by their length keeps short school or depot runs from
  // passing for the main variant.
  const weight = new Map<number, number>();
  for (const p of net.patterns)
    weight.set(p.route, (weight.get(p.route) ?? 0) + p.trips.length * p.stops.length);
  const groups = new Map<string, LineGroup>();
  net.routes.forEach((r, i) => {
    const key = `${r.agency}|${r.short}`;
    const g = groups.get(key) ?? { agency: r.agency, short: r.short, routes: [] };
    g.routes.push(i);
    groups.set(key, g);
  });
  for (const g of groups.values())
    g.routes.sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a - b);
  return [...groups.values()].sort(
    (a, b) => a.agency - b.agency || natural.compare(a.short, b.short),
  );
}

/** The routes of the line that a route variant belongs to. */
export function lineOf(net: Network, routeIndex: number): number[] {
  const route = net.routes[routeIndex];
  if (!route) return [];
  return lineGroups(net).find((g) => g.routes.includes(routeIndex))?.routes ?? [routeIndex];
}
