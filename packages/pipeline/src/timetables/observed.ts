import { haversine, weekday, type LatLon } from '@madeirabus/engine';
import { isHoliday } from './calendar.ts';
import type { Locality } from './build.ts';
import type { DayKind, Operator, SigaData, SigaDayVariant } from './types.ts';

/**
 * The timetables the SIGA website shows, a whole day at a time
 * (data/sources/siga/days, see scripts/fetch-siga.mjs): every trip of every
 * variant at every stop. A day seen on the site stands for the days of its
 * kind to come — the next Tuesdays, Saturdays or holidays — until the
 * collector sees the next one.
 */

const WEEK: DayKind[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const latest = (records: readonly SigaDayVariant[] | undefined) =>
  (records ?? []).reduce((d, r) => (r.date > d ? r.date : d), '');

/**
 * The kind of day whose timetable a date runs: its own (a Tuesday, a
 * holiday) or, until the site has been seen on one, the nearest: another
 * weekday, Sunday for a holiday and the other way round. Undefined when none
 * has been seen.
 */
export function kindFor(date: string, days: SigaData['days'] = {}): DayKind | undefined {
  const has = (k: DayKind) => (days[k]?.length ?? 0) > 0;
  if (isHoliday(date)) return has('hol') ? 'hol' : has('sun') ? 'sun' : undefined;
  const own = WEEK[weekday(date)]!;
  if (has(own)) return own;
  if (own === 'sun') return has('hol') ? 'hol' : undefined;
  if (own === 'sat') return undefined;
  let best: DayKind | undefined;
  let bestDate = '';
  for (const k of WEEK.slice(0, 5)) {
    const d = latest(days[k]);
    if (d > bestDate) {
      best = k;
      bestDate = d;
    }
  }
  return best;
}

/** The operator of a SIGA route by its operator's name. */
export function operatorOf(name: string): Operator | undefined {
  return /rodoeste/i.test(name) ? 'Rodoeste' : /CAM|Autocarros/i.test(name) ? 'CAM' : undefined;
}

/** Stop codes SIGA writes into some names ("Auto Silo Campo da Barca (01705)"). */
const CODES = /\s*\(\d{5}\)/g;

/**
 * A SIGA variant name as passengers would say it: CAM's names end in a code
 * of the variant and its direction ("Baia D'AbraEI", "Faial0V"), some names
 * carry stop codes.
 */
export function cleanVariantName(name: string, operator: Operator): string {
  let s = name.replace(CODES, '').replace(/\|/g, ' ');
  if (operator === 'CAM') s = s.replace(/([\p{Ll})\s])[0-9A-Z]?[IVC]$/u, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** "Ribeira Brava - Funchal via Cabo Girão" → "Funchal". */
function destinationOf(name: string): string {
  const last = name.split(' - ').pop() ?? '';
  return last
    .replace(/\s+(via|até|ate|desde)\b.*$/i, '')
    .replace(/\s*\(.*$/, '')
    .replace(/\s+(VIA RÁPIDA|Via Rápida|Via Rapida|DIRETO|Direto)\b.*$/i, '')
    .trim();
}

/** The town or village of a point: the nearest within 3 km, or a hamlet within 1 km. */
export function localityOf(p: LatLon, localities: readonly Locality[]): string | undefined {
  let best: Locality | undefined;
  let bestScore = Infinity;
  for (const l of localities) {
    const d = haversine(p, l);
    const score = l.rank === 1 ? (d <= 3000 ? d : Infinity) : d <= 1000 ? 10_000 + d : Infinity;
    if (score < bestScore) {
      bestScore = score;
      best = l;
    }
  }
  return best?.name;
}

/**
 * Where a variant's buses go, for their headsign: the destination its name
 * gives (Rodoeste's "Funchal - Ribeira Brava", CAM's outward "Baia D'AbraEI"),
 * or the place its last stop is in.
 */
export function headsignOf(
  variantName: string | undefined,
  operator: Operator,
  last: LatLon | undefined,
  localities: readonly Locality[],
): string | undefined {
  if (variantName) {
    const clean = cleanVariantName(variantName, operator);
    if (operator === 'Rodoeste' && clean.includes(' - ')) {
      const to = destinationOf(clean);
      if (to) return to;
    }
    // CAM: "…I" is the way out from Funchal, named after where it goes.
    if (operator === 'CAM' && /[0-9A-Z]?I$/.test(variantName.trim()) && clean) return clean;
  }
  return last ? localityOf(last, localities) : undefined;
}

/**
 * A line's name from its SIGA variants: Rodoeste's names without the way
 * ("Funchal - Ribeira Brava"), CAM's place with where the line starts.
 */
export function lineNameOf(
  names: readonly string[],
  operator: Operator,
  start: LatLon | undefined,
  localities: readonly Locality[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const n of names) {
    const clean = cleanVariantName(n, operator);
    const parts = clean.split(' - ').map((p) => destinationOf(p) || p.trim());
    const key = operator === 'Rodoeste' && parts.length >= 2 ? parts.join(' - ') : clean;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0];
  if (!best) return undefined;
  if (operator === 'CAM' && !best.includes(' - ')) {
    const from = start ? localityOf(start, localities) : undefined;
    if (from && from !== best) return `${from} - ${best}`;
  }
  return best;
}
