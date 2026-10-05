import { municipalityName, type Network } from '@madeirabus/engine';
import type { I18n } from '../i18n.ts';
import { clock, fullDate } from './format.ts';
import { lineDirections, lineOf, type Direction } from './lines.ts';
import { dayGroupLabel, groupWeek } from './printable.ts';
import { FILE_PREFIX } from './site.ts';

/**
 * A whole line on one sheet, as the operators print it at the bus station: for each kind
 * of day the buses one way beside the buses back, their times at the main stops of the
 * way, and a letter on the buses that go another way.
 */
export interface LineSheet {
  title: string;
  fileName: string;
  number: string;
  /** "formerly 7" */
  formerly?: string;
  name: string;
  operator: string;
  /** "#rrggbb" */
  color: string;
  days: SheetDays[];
  legend: { mark: string; text: string }[];
  /** Kinds of days without buses, an unconfirmed timetable. */
  notes: string[];
  footer: string[];
}

/** The buses of one kind of day ("Mon–Fri"), each way of the line. */
export interface SheetDays {
  label: string;
  ways: SheetWay[];
}

export interface SheetWay {
  direction: string;
  /** The main stops of the way, in riding order. */
  columns: string[];
  /** Each bus with its time at each column (none where it does not stop there). */
  rows: { times: (number | undefined)[]; mark?: string }[];
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The most columns of times a way gets. */
const MAX_COLUMNS = 5;

/**
 * Positions in a pattern of the stops a sheet gives times for: the ends, and in each
 * town of the line's name ("Funchal - Câmara de Lobos - Ribeira Brava") the stop most
 * lines serve, its bus station or main square.
 */
export function keyStops(net: Network, pattern: number, name: string): number[] {
  const stops = net.patterns[pattern]!.stops;
  const last = stops.length - 1;
  const lines = new Map<number, Set<number>>();
  for (const p of net.patterns)
    for (const s of p.stops) (lines.get(s) ?? lines.set(s, new Set()).get(s)!).add(p.route);
  const named = (s: number, town: string) => norm(net.stops[s]!.name).includes(town);
  // "Estrada João Gonçalves Zarco, Câmara de Lobos" is in it, "…, Estreito de Câmara de Lobos" next to it.
  const right = (s: number, town: string) => {
    const n = norm(net.stops[s]!.name);
    return n.startsWith(town) || n.split(',').some((part) => part.trim() === town);
  };
  const inTown = (s: number, town: string) =>
    named(s, town) || norm(municipalityName(net.stops[s]!.muni)) === town;
  const picks = new Set([0, last]);
  const towns = name
    .split(/\s+[-–—]\s+|\s*\/\s*/)
    .map(norm)
    .filter((n) => n.length > 2);
  for (const town of towns) {
    if (inTown(stops[0]!, town) || inTown(stops[last]!, town)) continue;
    const inner = stops.map((_, i) => i).filter((i) => i > 0 && i < last);
    let candidates = inner.filter((i) => right(stops[i]!, town));
    if (candidates.length === 0) candidates = inner.filter((i) => named(stops[i]!, town));
    if (candidates.length === 0) candidates = inner.filter((i) => inTown(stops[i]!, town));
    let best: number | undefined;
    for (const i of candidates) {
      const n = lines.get(stops[i]!)?.size ?? 0;
      if (best === undefined || n > (lines.get(stops[best]!)?.size ?? 0)) best = i;
    }
    if (best !== undefined) picks.add(best);
  }
  // A long way named after its ends only: its middle too.
  if (picks.size < 3 && stops.length >= 12) picks.add(Math.round(last / 2));
  const sorted = [...picks].sort((a, b) => a - b);
  return sorted.length <= MAX_COLUMNS ? sorted : [...sorted.slice(0, MAX_COLUMNS - 1), last];
}

/**
 * How a variant of a way differs from its main one, e.g. "via «Rua do Passal»" or
 * "from «Estreito»"; empty when it goes the same way.
 */
export function variantText(net: Network, t: I18n, main: number, pattern: number): string {
  if (main === pattern) return '';
  const name = (s: number) => net.stops[s]!.name;
  const a = net.patterns[main]!.stops;
  const b = net.patterns[pattern]!.stops;
  const parts: string[] = [];
  if (name(b[0]!) !== name(a[0]!)) parts.push(t.t('sheet.from', { stop: name(b[0]!) }));
  if (name(b[b.length - 1]!) !== name(a[a.length - 1]!)) {
    parts.push(t.t('sheet.to', { stop: name(b[b.length - 1]!) }));
  }
  const ownNames = new Set(b.map(name));
  const mainNames = new Set(a.map(name));
  const via = b.slice(1, -1).find((s) => !mainNames.has(name(s)));
  if (via !== undefined) parts.push(t.t('sheet.via', { stop: name(via) }));
  else if (parts.length === 0) {
    const skipped = a.slice(1, -1).find((s) => !ownNames.has(name(s)));
    if (skipped !== undefined) parts.push(t.t('sheet.skips', { stop: name(skipped) }));
  }
  return parts.join(', ');
}

/** Time of a trip at each position of its pattern (departure; arrival at the end). */
function tripTimes(net: Network, pattern: number, trip: number): number[] {
  const p = net.patterns[pattern]!;
  const [, start, profile] = p.trips[trip]!;
  const prof = p.profiles[profile]!;
  return p.stops.map((_, i) => start + (prof[i === p.stops.length - 1 ? 2 * i : 2 * i + 1] ?? 0));
}

/**
 * What a variant of a line shown on its map is: how it differs from the main way, and
 * when it runs in the week from `from` (times from its first stop).
 */
export function variantNote(
  net: Network,
  t: I18n,
  direction: Direction,
  pattern: number,
  from: string,
): { title: string; lines: string[] } {
  const p = net.patterns[pattern]!;
  const text = variantText(net, t, direction.patterns[0]!, pattern);
  const { groups } = groupWeek(net, from, (date) => {
    const times = p.trips
      .flatMap(([service], trip) =>
        net.isServiceActive(service, date) ? [tripTimes(net, pattern, trip)[0]!] : [],
      )
      .sort((a, b) => a - b);
    return { key: times.join(','), value: times };
  });
  const running = groups.filter((g) => g.value.length > 0);
  return {
    title: text ? `${t.t('sheet.variant')}: ${text}` : t.t('sheet.variant'),
    lines:
      running.length === 0
        ? [t.t('sheet.notThisWeek')]
        : [
            t.t('sheet.departs', { stop: net.stops[p.stops[0]!]!.name }),
            ...running.map((g) => `${dayGroupLabel(t, g)}: ${g.value.map(clock).join(', ')}`),
          ],
  };
}

/** The sheet of the line a route variant belongs to, for the week from `from`. */
export function lineSheet(net: Network, t: I18n, route: number, from: string, printedOn: string) {
  const variants = lineOf(net, route);
  const r = net.routes[variants[0] ?? route]!;
  const directions = lineDirections(net, variants);
  const ways = directions.map((d) => {
    const main = d.patterns[0]!;
    const keys = keyStops(net, main, r.long);
    const mainStops = net.patterns[main]!.stops;
    // Where each variant stops at the main stops: the same stop, or one of the same name.
    const at = new Map(
      d.patterns.map((p) => {
        const stops = net.patterns[p]!.stops;
        let from = 0;
        return [
          p,
          keys.map((k) => {
            const s = mainStops[k]!;
            let i = stops.indexOf(s, from);
            if (i < 0)
              i = stops.findIndex((x, j) => j >= from && net.stops[x]!.name === net.stops[s]!.name);
            if (i >= 0) from = i + 1;
            return i < 0 ? undefined : i;
          }),
        ];
      }),
    );
    return { d, keys, mainStops, at };
  });

  // Letters for the variants that go another way, the most frequent first; the same
  // difference keeps its letter.
  const texts = new Map<number, string>();
  const weight = new Map<string, number>();
  for (const { d } of ways) {
    for (const p of d.patterns) {
      const text = variantText(net, t, d.patterns[0]!, p);
      if (!text) continue;
      texts.set(p, text);
      weight.set(text, (weight.get(text) ?? 0) + net.patterns[p]!.trips.length);
    }
  }
  const letters = new Map(
    [...weight.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([text], i) => [text, String.fromCharCode(97 + i)]),
  );

  const { groups, basis } = groupWeek(net, from, (date) => {
    const value = ways.map(({ d, at }) => {
      const rows: { start: number; times: (number | undefined)[]; mark?: string }[] = [];
      for (const p of d.patterns) {
        const text = texts.get(p);
        net.patterns[p]!.trips.forEach(([service, start], trip) => {
          if (!net.isServiceActive(service, date)) return;
          const times = tripTimes(net, p, trip);
          rows.push({
            start,
            times: at.get(p)!.map((i) => (i === undefined ? undefined : times[i])),
            mark: text ? letters.get(text) : undefined,
          });
        });
      }
      return rows.sort((a, b) => a.start - b.start);
    });
    return {
      key: value.map((rows) => rows.map((r) => `${r.start}${r.mark ?? ''}`).join(',')).join('|'),
      value,
    };
  });

  const b = net.bundle;
  const operator = b.agencies[r.agency]!.name;
  const notes = groups
    .filter((g) => g.value.every((rows) => rows.length === 0))
    .map((g) => t.t('print.closed', { days: dayGroupLabel(t, g) }));
  if (b.demo) notes.push(t.t('demo.banner'));
  if (b.projected && basis.to > b.projected.officialUntil) {
    notes.push(t.t('data.projected', { date: fullDate(t, b.projected.officialUntil) }));
  }
  const version = b.sources.find((s) => s.feedVersion)?.feedVersion;
  const sheet: LineSheet = {
    title: t.t('print.title', { n: r.short, name: r.long }),
    fileName: `${FILE_PREFIX}-${r.short}.png`,
    number: r.short,
    formerly: r.formerly ? t.t('lines.formerly', { n: r.formerly }) : undefined,
    name: r.long,
    operator,
    color: `#${r.color}`,
    days: groups
      .filter((g) => g.value.some((rows) => rows.length > 0))
      .map((g) => ({
        label: dayGroupLabel(t, g),
        ways: ways.map(({ d, keys, mainStops }, i) => ({
          direction: d.label,
          columns: keys.map((k) => net.stops[mainStops[k]!]!.name),
          rows: g.value[i]!.map(({ times, mark }) => ({ times, mark })),
        })),
      })),
    legend: [...letters.entries()]
      .map(([text, mark]) => ({ mark, text }))
      .sort((a, c) => a.mark.localeCompare(c.mark)),
    notes,
    footer: [
      t.t('print.basis', { from: fullDate(t, basis.from), to: fullDate(t, basis.to) }),
      t.t('print.source', {
        source: version ? `${operator} (GTFS ${version})` : operator,
        date: fullDate(t, printedOn),
      }),
    ],
  };
  return sheet;
}
