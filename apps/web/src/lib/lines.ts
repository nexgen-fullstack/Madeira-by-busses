import { normalise, type Network } from '@madeirabus/engine';

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

/**
 * One way a line runs, e.g. "Centro → Barreira": every variant heading that
 * way, including the short ones that turn back early or start later, so a
 * timetable at a stop shows every bus that stops there.
 */
export interface Direction {
  /** First → last stop of the main variant. */
  label: string;
  /** Busiest first; the first is the main variant. */
  patterns: number[];
}

/** Squared distance in metres, flat-earth: fine for stops of one line. */
function dist2(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dy = (a.lat - b.lat) * 110_540;
  const dx = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return dx * dx + dy * dy;
}

/**
 * How much stop sequence `b` runs along `a`: positive when it goes the same
 * way, negative when the other way. Each stop of `b` is matched to the
 * nearest stop of `a` (the other direction usually stops across the road)
 * and the steps between their positions are counted. Termini that loop
 * round a village count for little against the road in between.
 */
function trend(net: Network, a: readonly number[], b: readonly number[]): number {
  const positions: number[] = [];
  for (const s of b) {
    const stop = net.stops[s]!;
    let best = -1;
    let bestD = 150 * 150;
    a.forEach((t, i) => {
      const d = dist2(stop, net.stops[t]!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) positions.push(best);
  }
  let sum = 0;
  for (let i = 1; i < positions.length; i++) sum += Math.sign(positions[i]! - positions[i - 1]!);
  return sum;
}

/** The ways a line (all its variants) runs, busiest first. */
export function lineDirections(net: Network, routes: readonly number[]): Direction[] {
  // Weighing trips by their length keeps short runs from passing for the main route.
  const weight = (p: number) => net.patterns[p]!.trips.length * net.patterns[p]!.stops.length;
  const patterns = net.patterns
    .map((p, i) => (routes.includes(p.route) ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => weight(b) - weight(a) || a - b);
  const ways: number[][] = [];
  for (const p of patterns) {
    const stops = net.patterns[p]!.stops;
    let way: number[] | undefined;
    let best = 0;
    for (const w of ways) {
      const along = trend(net, net.patterns[w[0]!]!.stops, stops);
      if (along > best) {
        best = along;
        way = w;
      }
    }
    if (way) way.push(p);
    else ways.push([p]);
  }
  const name = (s: number) => net.stops[s]!.name;
  return ways
    .map((w) => {
      const main = net.patterns[w[0]!]!.stops;
      return { label: `${name(main[0]!)} → ${name(main[main.length - 1]!)}`, patterns: w };
    })
    .sort(
      (a, b) =>
        b.patterns.reduce((n, p) => n + weight(p), 0) -
        a.patterns.reduce((n, p) => n + weight(p), 0),
    );
}

/** Stops of a direction in riding order: its main variant's, then any only others serve. */
export function directionStops(net: Network, direction: Direction): number[] {
  const out = [...net.patterns[direction.patterns[0]!]!.stops];
  const seen = new Set(out);
  for (const p of direction.patterns.slice(1)) {
    const stops = net.patterns[p]!.stops;
    stops.forEach((s, i) => {
      if (seen.has(s)) return;
      seen.add(s);
      // After the nearest stop before it that is already listed.
      let at = -1;
      for (let j = i - 1; j >= 0 && at < 0; j--) at = out.indexOf(stops[j]!);
      out.splice(at + 1, 0, s);
    });
  }
  return out;
}

/** Line numbers compare without their zero padding: "10" is line 010. */
const numberKey = (n: string) => n.toLowerCase().replace(/^0+(?=.)/, '');

/**
 * Whether a line matches what someone typed: its number or the number it had
 * before 2026 ("10A" finds today's 110), or words of its name.
 */
export function lineMatches(net: Network, line: LineGroup, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const key = numberKey(q);
  const words = normalise(q);
  return line.routes.some((i) => {
    const r = net.routes[i]!;
    return (
      numberKey(r.short).startsWith(key) ||
      (r.formerly !== undefined && numberKey(r.formerly).startsWith(key)) ||
      (words !== '' && normalise(r.long).includes(words))
    );
  });
}
