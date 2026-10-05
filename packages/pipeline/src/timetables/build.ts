import {
  addDays,
  haversine,
  isoToGtfsDate,
  weekday,
  type GtfsFeed,
  type GtfsStop,
  type LatLon,
} from '@madeirabus/engine';
import {
  calendarFor,
  datesOf,
  isHoliday,
  schoolCalendarKnown,
  type DayRule,
  type DayType,
} from './calendar.ts';
import { headsignOf, kindFor, lineNameOf, localityOf, operatorOf } from './observed.ts';
import { serviceDates } from './services.ts';
import type {
  DayKind,
  Direction,
  Note,
  Operator,
  SigaData,
  SigaRoute,
  SigaVariant,
  TimetableFile,
  TimingPoint,
} from './types.ts';

/**
 * Builds a GTFS feed for CAM and SIGA Rodoeste from the SIGA website's
 * timetables (data/sources/siga) and their printed timetables (data/timetables).
 *
 * The SIGA website shows a whole day of a line at a time: every trip of every
 * variant, with its time at every stop. A day seen there gives the line's trips
 * on the days of its kind (the next Tuesdays, Saturdays, holidays…).
 *
 * Until a kind of day has been seen, the printed timetables stand in. They give
 * the times at a few places, often only the departure. SIGA gives, for each
 * variant of a line, every stop in order with the minutes between them. Each
 * printed trip is laid onto its variant: the one its marks name ("via Cabo
 * Girão"), or else the one of its line that passes all the printed places in
 * about the printed time. The printed times are kept where they are given and
 * the stops in between get times spread as on SIGA's own trip. When SIGA has
 * not shown the variant yet, the trip runs between the printed places, with the
 * stops of each stretch on which every known variant agrees.
 */

export const AGENCIES: Record<Operator, { id: string; name: string; url: string; color: string }> =
  {
    CAM: { id: 'CAM', name: 'CAM', url: 'https://www.cam-madeira.pt', color: '0082CB' },
    Rodoeste: {
      id: 'RODOESTE',
      name: 'SIGA Rodoeste',
      url: 'https://www.rodoeste.pt',
      color: '0E3C55',
    },
  };

const DAY_TYPES: DayType[] = ['weekdays', 'saturdays', 'sundays'];
/** A printed place is on a variant when one of the variant's stops is this close (m). */
const SAME_PLACE = 250;
/** A variant ends at a printed destination when its last stop is this close (m). */
const SAME_END = 500;
/** The most a variant's running time may differ from the printed one, per section (min). */
const TIME_SLACK = 15;
/** The same for a variant SIGA was seen running trips with the same marks on. */
const SEEN_TIME_SLACK = 30;

export interface LineReport {
  file: string;
  line: string;
  operator: Operator;
  /** Trips with every stop of their SIGA variant. */
  full: number;
  /** Trips between the printed places (variant not seen on SIGA yet). */
  outline: number;
  /** Of those, trips with the stops of some stretches, on which every known variant agrees. */
  filled: number;
  skipped: string[];
  warnings: string[];
  /** SIGA's journey planner has every line of the sheet: the printed timetable stands by. */
  covered?: boolean;
}

/** What SIGA's journey planner gave: every trip of every line on every day. */
export interface PlannerReport {
  /** Each service: the dates it runs in the calendar built, and its trips. */
  services: { id: string; first: string; last: string; dates: number; trips: number }[];
  /** Trips per line (one trip counted once, however many dates it runs). */
  lines: { operator: Operator; line: string; trips: number }[];
}

/** What the SIGA website's day timetables gave. */
export interface ObservedReport {
  /** Each kind of day seen: when, how many variants and trips, and how many dates it runs. */
  days: { kind: DayKind; date: string; variants: number; trips: number; dates: number }[];
  /** Trips per line (one trip counted once, however many dates it runs). */
  lines: { operator: Operator; line: string; trips: number }[];
}

export interface TimetableBuild {
  feed: GtfsFeed;
  lines: LineReport[];
  observed: ObservedReport;
  /** Present when SIGA's journey planner gave the timetable. */
  planner?: PlannerReport;
  /** Lines SIGA lists that neither a seen day nor a printed timetable gave trips to yet. */
  missing: Record<Operator, string[]>;
  /** The SIGA variant each trip lies on (trips between printed places only are absent). */
  tripVariants: Map<string, string>;
}

interface Cell {
  /** Minutes after midnight, or undefined for "-". */
  time?: number;
  marks: string[];
}

/** "07:35 a E" → 455 minutes and the marks; "-" → no time. */
export function parseCell(text: string): Cell {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '-';
  const m = /^(\d{1,2})[:.h](\d{2})$/.exec(first);
  if (!m) {
    if (first !== '-' && first !== '—') throw new Error(`Not a time: "${text.trim()}"`);
    return { marks: parts.slice(1) };
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 29 || min > 59) throw new Error(`Not a time: "${text.trim()}"`);
  return { time: h * 60 + min, marks: parts.slice(1) };
}

/** A row's cells; times after midnight continue the day (00:10 after 23:40 is 24:10). */
export function parseRow(row: string, columns: number): Cell[] {
  const cells = row.split('|').map(parseCell);
  if (cells.length > columns) throw new Error(`${cells.length} cells for ${columns} places`);
  let last = -1;
  for (const c of cells) {
    if (c.time === undefined) continue;
    while (c.time < last) c.time += 24 * 60;
    last = c.time;
  }
  return cells;
}

const minutesOf = (hhmmss: string) => {
  const [h = 0, m = 0, s = 0] = hhmmss.split(':').map(Number);
  return h * 60 + m + s / 60;
};

class Sources {
  readonly variants = new Map<string, SigaVariant>();
  readonly routes = new Map<number, SigaRoute>();
  readonly byLine = new Map<string, SigaVariant[]>();
  constructor(readonly siga: SigaData) {
    for (const v of siga.variants) {
      this.variants.set(v.id, v);
      const list = this.byLine.get(v.line);
      if (list) list.push(v);
      else this.byLine.set(v.line, [v]);
    }
    for (const r of siga.routes) this.routes.set(r.id, r);
  }
  point(code: string): LatLon | undefined {
    const s = this.siga.stops[code];
    return s ? { lat: s[1], lon: s[2] } : undefined;
  }
  private readonly passCache = new Map<string, boolean>();
  /** Does the variant pass the stop (one of its stops within SAME_PLACE)? */
  passes(variant: SigaVariant, code: string): boolean {
    const key = `${variant.id}@${code}`;
    let yes = this.passCache.get(key);
    if (yes === undefined) {
      const p = this.point(code);
      yes =
        p !== undefined &&
        variant.stops.some(([c]) => {
          const q = this.point(c);
          return c === code || (q !== undefined && haversine(p, q) <= SAME_PLACE);
        });
      this.passCache.set(key, yes);
    }
    return yes;
  }
  route(id: string): SigaRoute | undefined {
    return this.routes.get(Number(id.split('+')[0]!.split(':')[0]));
  }
  /** SIGA's running time of a variant (minutes), from the route list. */
  duration(id: string): number | undefined {
    let total = 0;
    for (const part of id.split('+')) {
      const route = this.routes.get(Number(part.split(':')[0]));
      const d = route ? minutesOf(route.duration) : 0;
      if (!(d > 0)) return undefined;
      total += d;
    }
    return total;
  }
  /** A variant, or two run one after the other ("A+B": change buses where A ends). */
  variant(id: string): SigaVariant | undefined {
    const parts = id.split('+').map((p) => this.variants.get(p));
    if (parts.some((p) => !p)) return undefined;
    if (parts.length === 1) return parts[0];
    const [a, b] = parts as [SigaVariant, SigaVariant];
    const offset = a.stops[a.stops.length - 1]![1];
    const tail = b.stops[0]![0] === a.stops[a.stops.length - 1]![0] ? b.stops.slice(1) : b.stops;
    return {
      ...a,
      id,
      stops: [...a.stops, ...tail.map(([c, m]): [string, number] => [c, offset + m])],
    };
  }
}

/** Where the printed places with a time are on the variant (indices into its stops). */
function locate(
  src: Sources,
  variant: SigaVariant,
  points: readonly TimingPoint[],
  cells: readonly Cell[],
): (number | undefined)[] | undefined {
  const out: (number | undefined)[] = [];
  let from = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]!.time === undefined) {
      out.push(undefined);
      continue;
    }
    const tp = points[i]!;
    let at = variant.stops.findIndex(([code], k) => k >= from && code === tp.stop);
    if (at < 0) {
      const p = src.point(tp.stop);
      let best = SAME_PLACE;
      for (let k = from; p && k < variant.stops.length; k++) {
        const q = src.point(variant.stops[k]![0]);
        const d = q ? haversine(p, q) : Infinity;
        if (d < best) {
          best = d;
          at = k;
        }
      }
    }
    if (at < 0) return undefined;
    out.push(at);
    from = at + 1;
  }
  return out;
}

/** A stop of a trip: its code, the time (minutes after midnight) and its index on the variant. */
interface TripStop {
  code: string;
  time: number;
  index: number;
}

/** Times for the variant's stops from the printed times at some of them. */
function layOnVariant(
  variant: SigaVariant,
  known: readonly { index: number; time: number }[],
): TripStop[] {
  const ref = variant.stops.map(([, m]) => m);
  const first = known[0]!;
  // A single printed time is the departure: the trip runs to the end of the variant.
  const end = known.length === 1 ? variant.stops.length - 1 : known[known.length - 1]!.index;
  const out: TripStop[] = [];
  let k = 0;
  for (let i = first.index; i <= end; i++) {
    while (k < known.length - 1 && known[k + 1]!.index <= i) k++;
    const a = known[k]!;
    const b = known[k + 1];
    let t: number;
    if (!b || i === a.index) {
      t = a.time + (ref[i]! - ref[a.index]!);
    } else {
      const span = ref[b.index]! - ref[a.index]!;
      const share =
        span > 0 ? (ref[i]! - ref[a.index]!) / span : (i - a.index) / (b.index - a.index);
      t = a.time + share * (b.time - a.time);
    }
    out.push({ code: variant.stops[i]![0], time: Math.round(t), index: i });
  }
  return out;
}

/** How far the variant's running times are from the printed ones (worst section, min). */
function misfit(variant: SigaVariant, known: readonly { index: number; time: number }[]): number {
  let worst = 0;
  for (let k = 1; k < known.length; k++) {
    const a = known[k - 1]!;
    const b = known[k]!;
    const ref = variant.stops[b.index]![1] - variant.stops[a.index]![1];
    worst = Math.max(worst, Math.abs(ref - (b.time - a.time)));
  }
  return worst;
}

/** The marks of a row's cells and what they mean for the trip. */
function readMarks(cells: readonly Cell[], notes: Record<string, Note>) {
  const via = new Set<string>();
  const all = new Set<string>();
  const rule: Omit<DayRule, 'type'> = {};
  const change: number[] = [];
  const unknown: string[] = [];
  let skip: string | undefined;
  let noVariant = false;
  let from: string | undefined;
  let to: string | undefined;
  let line: string | undefined;
  cells.forEach((cell, i) => {
    for (const mark of cell.marks) {
      // "#850": the line of this trip, on sheets with several.
      if (mark.startsWith('#')) {
        line = mark.slice(1);
        continue;
      }
      const note = notes[mark];
      if (!note) {
        unknown.push(mark);
        continue;
      }
      all.add(mark);
      if (note.skip) skip = `${mark}: ${note.text}`;
      if (note.variant === false) noVariant = true;
      if (note.from) from = note.from;
      if (note.to) to = note.to;
      if (note.via) via.add(mark);
      if (note.change) change.push(i);
      if (note.school) rule.school = note.school;
      if (note.only) rule.only = note.only;
      if (note.holidays) rule.holidays = note.holidays;
      if (note.except) rule.except = [...(rule.except ?? []), ...note.except];
    }
  });
  return {
    via: [...via].sort().join(' '),
    all,
    rule,
    change,
    skip,
    unknown,
    noVariant,
    from,
    to,
    line,
  };
}

const ruleKey = (type: DayType, rule: Omit<DayRule, 'type'>) =>
  [
    type,
    rule.school ?? '',
    rule.only?.join('') ?? '',
    rule.holidays ?? '',
    [...(rule.except ?? [])].sort().join(','),
  ].join('/');

export interface BuildTimetablesOptions {
  /** First and last day of the generated calendar (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Towns and villages, to tell apart stops named after the road ("ER214, Caniçal"). */
  localities?: readonly Locality[];
}

export interface Locality extends LatLon {
  name: string;
  /** 1 for towns, villages and suburbs; 2 for hamlets and smaller places. */
  rank: number;
}

/** Minutes between a bus's arrival at a change of buses and the next one's departure. */
const CHANGE_MINUTES = 3;

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** The words that tell places apart ("Serra de Água" → serra, agua). */
const placeWords = (s: string) =>
  plain(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !['d', 'de', 'do', 'da', 'dos', 'das', 'e'].includes(w));

/** "R" and "Rib" shorten "Ribeira", "Sta" shortens "Santa". */
function shortens(short: string, word: string): boolean {
  if (short.length > 3 || short[0] !== word[0]) return false;
  let i = 0;
  for (const c of word) if (c === short[i]) i++;
  return i >= short.length;
}

/**
 * Whether a stop's name already says the place: "Serra Agua - Centro" says
 * Serra de Água and "R. Brava - Antes Tunel" Ribeira Brava; "C. Lobos" alone
 * does not say Caniçal.
 */
export function namesPlace(name: string, place: string): boolean {
  const have = placeWords(name);
  const want = placeWords(place);
  const whole = want.filter((w) => have.includes(w));
  return (
    whole.length > 0 && want.every((w) => whole.includes(w) || have.some((h) => shortens(h, w)))
  );
}

/** The stop's name with its town or village, unless the name already says it. */
function withLocality(name: string, p: LatLon, localities: readonly Locality[]): string {
  // The nearest town or village within 3 km; failing that, a hamlet within 1 km.
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
  if (!best || namesPlace(name, best.name)) return name;
  return `${name}, ${best.name}`;
}

/** The minutes variants seen on SIGA take from one stop to another: the shortest, or the median. */
function usualDuration(
  src: Sources,
  candidates: readonly SigaVariant[],
  fromCode: string,
  toCode: string,
  median = false,
): number | undefined {
  const a = src.point(fromCode);
  const b = src.point(toCode);
  if (!a || !b) return undefined;
  const found: number[] = [];
  for (const v of candidates) {
    const i = v.stops.findIndex(([c]) => {
      const p = src.point(c);
      return p !== undefined && haversine(p, a) <= SAME_PLACE;
    });
    if (i < 0) continue;
    const j = v.stops.findIndex(([c], k) => {
      const p = k > i ? src.point(c) : undefined;
      return p !== undefined && haversine(p, b) <= SAME_PLACE;
    });
    if (j < 0) continue;
    const d = v.stops[j]![1] - v.stops[i]![1];
    if (d > 0) found.push(d);
  }
  if (found.length === 0) return undefined;
  found.sort((a, b) => a - b);
  return median ? found[Math.floor(found.length / 2)] : found[0];
}

/** Trips that start or end elsewhere are told apart from the others with the same via-marks. */
const evidenceKey = (marks: { via: string; from?: string; to?: string; line?: string }) =>
  marks.from || marks.to || marks.line
    ? `${marks.via}|${marks.from ?? ''}|${marks.to ?? ''}|${marks.line ?? ''}`
    : marks.via;

const dayTypeOf = (date: string): DayType =>
  isHoliday(date) || weekday(date) === 6
    ? 'sundays'
    : weekday(date) === 5
      ? 'saturdays'
      : 'weekdays';

/**
 * The variants SIGA showed running a printed trip: same kind of day, same
 * departure from the same place. They tell which variant trips with those
 * marks drive, by the marks sorted and joined like `Direction.variants`.
 */
function seenVariants(
  src: Sources,
  candidates: readonly SigaVariant[],
  dir: Direction,
  notes: Record<string, Note>,
  report: LineReport,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const type of DAY_TYPES) {
    const rows = (dir[type] ?? []).flatMap((row) => {
      try {
        const cells = parseRow(row, dir.stops.length);
        const first = cells.findIndex((c) => c.time !== undefined);
        const start = first < 0 ? 0 : cells[first]!.time! % (24 * 60);
        const hhmm = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
        return first < 0 ? [] : [{ cells, first, hhmm }];
      } catch {
        return [];
      }
    });
    for (const { cells, first, hhmm } of rows) {
      // Two printed trips leaving at that minute: no telling which one SIGA showed.
      if (rows.filter((o) => o.hhmm === hhmm && o.first === first).length > 1) continue;
      const marks = readMarks(cells, notes);
      if (marks.unknown.length > 0 || marks.noVariant || marks.skip) continue;
      const place = src.point(marks.from ?? dir.stops[first]!.stop);
      for (const v of candidates) {
        if (marks.line && v.line !== marks.line) continue;
        if (v.start !== hhmm || !(v.dates ?? [v.seen]).some((date) => dayTypeOf(date) === type)) {
          continue;
        }
        const at = src.point(v.stops[0]![0]);
        if (!place || !at || haversine(place, at) > SAME_PLACE) continue;
        const key = evidenceKey(marks);
        const list = out.get(key) ?? [];
        if (!list.includes(v.id)) list.push(v.id);
        out.set(key, list);
      }
    }
  }
  for (const [key, ids] of out) {
    if (ids.length > 1 && !dir.variants?.[key]) {
      report.warnings.push(`${dir.to}: marks "${key}" seen on ${ids.join(', ')}`);
    }
  }
  return out;
}

/** The municipality of Funchal (INE code): expresses run non-stop between it and the first town. */
const FUNCHAL = '3103';
/** A landmark stop is inside a stretch of a variant when one of its stops is this close (m). */
const LANDMARK_NEAR = 60;

/**
 * The stops between printed places (two, or three when the variants differ
 * only in where a loop through the middle one's town comes) that every known
 * variant of the line passing them agrees on, with times spread between the
 * printed ones as on SIGA's trips. Undefined where the variants part ways,
 * where the trip's marks leave its way there unknown, or where no variant is
 * known: the trip then keeps to the printed places on that stretch.
 */
function stretch(
  src: Sources,
  variants: readonly SigaVariant[],
  anchors: readonly TripStop[],
  marks: { all: Set<string>; noVariant: boolean },
  landmarks: readonly (readonly [string, string])[],
): TripStop[] | undefined {
  const a = anchors[0]!;
  const c = anchors[anchors.length - 1]!;
  // An express leaves and reaches Funchal on the expressway, past every stop.
  const zone = (code: string) => src.siga.stops[code]?.[3];
  if (marks.noVariant && (zone(a.code) === FUNCHAL || zone(c.code) === FUNCHAL)) return undefined;
  const points = anchors.map((s) => src.point(s.code));
  if (points.some((p) => !p)) return undefined;
  const near = (code: string, p: LatLon, radius: number) => {
    const q = src.point(code);
    return q !== undefined && haversine(p, q) <= radius;
  };
  // Where a variant passes a place: at its very stop, or else at its nearest stop close by.
  const find = (v: SigaVariant, code: string, p: LatLon, after: number) => {
    const exact = v.stops.findIndex(([s], k) => k > after && s === code);
    if (exact >= 0) return { at: exact, exact: true };
    let at = -1;
    let best = SAME_PLACE;
    v.stops.forEach(([s], k) => {
      const q = k > after ? src.point(s) : undefined;
      const d = q ? haversine(p, q) : Infinity;
      if (d <= best) {
        best = d;
        at = k;
      }
    });
    return { at, exact: false };
  };
  let usable: { v: SigaVariant; at: number[]; exact: boolean }[] = [];
  for (const v of variants) {
    const at: number[] = [];
    let exact = true;
    for (let k = 0; k < anchors.length; k++) {
      const f = find(v, anchors[k]!.code, points[k]!, at[k - 1] ?? -1);
      if (f.at < 0) break;
      at.push(f.at);
      exact &&= f.exact;
    }
    if (at.length === anchors.length) usable.push({ v, at, exact });
  }
  // Variants stopping at the printed stops themselves tell the way best: a loop through a
  // town passes near its printed stop twice.
  if (usable.some((u) => u.exact)) usable = usable.filter((u) => u.exact);
  const first = (u: (typeof usable)[number]) => u.at[0]!;
  const last = (u: (typeof usable)[number]) => u.at[u.at.length - 1]!;
  for (const [mark, code] of landmarks) {
    const lp = src.point(code);
    if (!lp) continue;
    const inside = (u: (typeof usable)[number]) =>
      u.v.stops
        .slice(first(u) + 1, last(u))
        .some(([s]) => s === code || near(s, lp, LANDMARK_NEAR));
    if (marks.all.has(mark)) {
      if (usable.some(inside)) usable = usable.filter(inside);
      // Where the trip passes its landmark is unknown: no telling this stretch's way.
      else if (!variants.some((v) => src.passes(v, code))) return undefined;
    } else {
      usable = usable.filter((u) => !inside(u));
    }
  }
  if (usable.length === 0) return undefined;
  // The stops in between, the printed ones aside: variants may pass a printed stop before
  // or after a loop through its town and still drive the same way.
  const printed = new Set(anchors.map((s) => s.code));
  const way = (u: (typeof usable)[number]) =>
    u.v.stops
      .slice(first(u) + 1, last(u))
      .flatMap(([s], k) => (u.at.includes(first(u) + 1 + k) || printed.has(s) ? [] : [s]));
  // The fullest way; the others must be it with at most a stop or two left out (and not
  // served elsewhere on their way: that is another order, not a stop skipped).
  const ways = usable
    .map((u) => ({ u, codes: way(u) }))
    .sort((x, y) => y.codes.length - x.codes.length);
  const fullest = ways[0]!;
  if (fullest.codes.length === 0) return undefined;
  const leftOut = Math.max(2, Math.floor(fullest.codes.length / 10));
  const agrees = ({ u, codes }: (typeof ways)[number]) => {
    let k = 0;
    for (const c of fullest.codes) {
      if (k < codes.length && codes[k] === c) k++;
      else if (u.v.stops.some(([s]) => s === c)) return false;
    }
    return k === codes.length && fullest.codes.length - codes.length <= leftOut;
  };
  if (!ways.every(agrees)) return undefined;
  const { v, at } = fullest.u;
  // Far slower or faster than printed between two printed stops: some other road.
  for (let k = 1; k < anchors.length; k++) {
    const span = v.stops[at[k]!]![1] - v.stops[at[k - 1]!]![1];
    const time = anchors[k]!.time - anchors[k - 1]!.time;
    if (Math.abs(span - time) > Math.max(12, time)) return undefined;
  }
  // Every stop of the variant in between, timed between the printed ones around it.
  const out: TripStop[] = [];
  for (let k = 1; k < anchors.length; k++) {
    const i = at[k - 1]!;
    const j = at[k]!;
    const span = v.stops[j]![1] - v.stops[i]![1];
    const time = anchors[k]!.time - anchors[k - 1]!.time;
    for (let x = i + 1; x < j; x++) {
      const share = span > 0 ? (v.stops[x]![1] - v.stops[i]![1]) / span : (x - i) / (j - i);
      out.push({
        code: v.stops[x]![0],
        time: Math.round(anchors[k - 1]!.time + share * time),
        index: -1,
      });
    }
    if (k < anchors.length - 1) out.push(anchors[k]!);
  }
  return out;
}

/** Builds the feed. `files` are [file name, contents] of data/timetables/*.json. */
export function buildTimetableFeed(
  files: readonly [string, TimetableFile][],
  siga: SigaData,
  { from, to, localities = [] }: BuildTimetablesOptions,
): TimetableBuild {
  const src = new Sources(siga);
  // The kind of day whose SIGA timetable each date runs, and the lines each kind has.
  const days = siga.days ?? {};
  const dayKinds = new Map<string, DayKind>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const kind = kindFor(d, days);
    if (kind) dayKinds.set(d, kind);
  }
  const lineKey = (op: Operator, line: string) => `${op}|${line}`;
  const operatorOfVariant = (id: string) => {
    const route = src.route(id);
    return operatorOf(route?.operator ?? src.variants.get(id)?.operator ?? '');
  };
  const seenKinds = new Map<string, Set<DayKind>>();
  for (const [kind, records] of Object.entries(days) as [DayKind, typeof days.hol][]) {
    for (const r of records ?? []) {
      const op = operatorOfVariant(r.id);
      if (!op) continue;
      const key = lineKey(op, r.line);
      const set = seenKinds.get(key) ?? new Set<DayKind>();
      set.add(kind);
      seenKinds.set(key, set);
    }
  }
  /** Whether the SIGA timetable of the date's kind of day has the line (then it stands, not the printed one). */
  const seenOn = (op: Operator, line: string, date: string) => {
    const kind = dayKinds.get(date);
    return kind !== undefined && (seenKinds.get(lineKey(op, line))?.has(kind) ?? false);
  };
  const feed: GtfsFeed = {
    agencies: [],
    stops: [],
    routes: [],
    trips: [],
    stopTimes: [],
    calendars: [],
    calendarDates: [],
    shapes: [],
    frequencies: [],
    feedInfo: {
      feed_publisher_name: 'Madeira by busses, from the CAM and SIGA Rodoeste timetables',
    },
  };
  const lines: LineReport[] = [];
  const tripVariants = new Map<string, string>();
  const usedStops = new Set<string>();
  const services = new Map<string, string>();
  const routes = new Set<string>();
  const agencies = new Set<Operator>();

  /** A service running on these dates. */
  const addService = (id: string, dates: readonly string[]) => {
    const { calendar, added, removed } = calendarFor(id, dates, from, to);
    if (calendar) feed.calendars.push(calendar);
    for (const date of added) {
      feed.calendarDates.push({ service_id: id, date: isoToGtfsDate(date), exception_type: 1 });
    }
    for (const date of removed) {
      feed.calendarDates.push({ service_id: id, date: isoToGtfsDate(date), exception_type: 2 });
    }
  };

  /**
   * The service of a printed day rule on a line, or undefined when it has no
   * day between `from` and `to`: the days SIGA's own timetable of the line
   * stands for are not the printed timetable's.
   */
  const serviceFor = (
    type: DayType,
    rule: Omit<DayRule, 'type'>,
    closed: string[],
    op: Operator,
    line: string,
  ) => {
    const seen = [...(seenKinds.get(lineKey(op, line)) ?? [])].sort().join('');
    const key = `${ruleKey(type, rule)}/${closed.join(',')}/${seen}`;
    if (services.has(key)) return services.get(key) || undefined;
    const dates = datesOf({ type, ...rule }, from, to, closed).filter((d) => !seenOn(op, line, d));
    if (dates.length === 0) {
      services.set(key, '');
      return undefined;
    }
    const id = `S${services.size + 1}`;
    services.set(key, id);
    addService(id, dates);
    return id;
  };

  // The printed timetable of each line, for its name, its former number and the names of places.
  const printed = new Map<string, TimetableFile>();
  for (const [, tt] of files) {
    for (const l of tt.lines ?? [tt.line]) printed.set(lineKey(tt.operator, l), tt);
  }

  const routeFor = (op: Operator, line: string) => {
    const agency = AGENCIES[op];
    const id = `${agency.id}-${line}`;
    if (!routes.has(id)) {
      routes.add(id);
      agencies.add(op);
      const tt = printed.get(lineKey(op, line));
      feed.routes.push({
        route_id: id,
        agency_id: agency.id,
        route_short_name: tt && line === tt.line ? (tt.formerly ?? line) : line,
        line_id: line,
        route_long_name: tt ? (tt.names?.[line] ?? tt.name) : (sigaLineName(op, line) ?? line),
        route_type: 3,
        route_color: agency.color,
        route_text_color: 'FFFFFF',
      });
    }
    return id;
  };

  /** A line's name from SIGA's names of its variants, for lines without a printed timetable. */
  const sigaLineName = (op: Operator, line: string) => {
    const mine = siga.routes.filter((r) => r.line === line && operatorOf(r.operator) === op);
    const outward = mine.filter((r) => r.directions.includes(0));
    const names = (outward.length > 0 ? outward : mine).map((r) => r.name);
    const first =
      mine
        .map((r) => src.variants.get(`${r.id}:0`)?.stops[0]?.[0])
        .find((c): c is string => c !== undefined) ??
      planner?.patterns.find(
        (p) => p.line === line && p.direction === 0 && operatorOf(p.operator) === op,
      )?.stops[0];
    return lineNameOf(names, op, first ? src.point(first) : undefined, localities);
  };

  /** Where a bus goes: the printed place it ends at, its town, or what SIGA calls it. */
  const headsignFor = (op: Operator, line: string, codes: readonly string[], name?: string) => {
    const tt = printed.get(lineKey(op, line));
    const last = src.point(codes[codes.length - 1]!);
    const timing = tt?.directions
      .flatMap((dir) => dir.stops)
      .map((tp) => ({ tp, p: src.point(tp.stop) }))
      .filter((x) => x.p && last && haversine(x.p, last) <= SAME_END)
      .sort((a, b) => haversine(a.p!, last!) - haversine(b.p!, last!))[0]?.tp.name;
    return (
      timing ??
      (last ? localityOf(last, localities) : undefined) ??
      headsignOf(name, op, last, localities) ??
      siga.stops[codes[codes.length - 1]!]![0]
    );
  };

  // SIGA's journey planner: every line it has trips for in these days, and the days of its services.
  const planner = siga.timetable;
  const plannerDates = planner
    ? serviceDates(planner.services, from, to)
    : new Map<string, string[]>();
  const covered = new Set<string>();
  for (const p of planner?.patterns ?? []) {
    const op = operatorOf(p.operator);
    if (op && p.trips.some(([, , s]) => plannerDates.has(s))) covered.add(lineKey(op, p.line));
  }

  for (const [file, tt] of files) {
    const report: LineReport = {
      file,
      line: tt.line,
      operator: tt.operator,
      full: 0,
      outline: 0,
      filled: 0,
      skipped: [],
      warnings: [],
    };
    lines.push(report);
    if (!AGENCIES[tt.operator]) {
      report.warnings.push(`Unknown operator ${tt.operator}`);
      continue;
    }
    agencies.add(tt.operator);
    const sigaLines = tt.lines ?? [tt.line];
    if (sigaLines.every((l) => covered.has(lineKey(tt.operator, l)))) {
      report.covered = true;
      continue;
    }
    const closed = tt.closed ?? ['12-25'];
    const fileNotes = tt.notes ?? {};
    if (!schoolCalendarKnown(to) && Object.values(fileNotes).some((n) => n.school)) {
      report.warnings.push('School terms after the published calendar are estimated');
    }
    let coveredRows = 0;
    const candidates = sigaLines.flatMap((l) => src.byLine.get(l) ?? []);
    const landmarks = Object.entries(fileNotes).flatMap(([mark, n]) =>
      n.pass ? [[mark, n.pass] as const] : [],
    );
    for (const [mark, code] of landmarks) {
      if (!siga.stops[code]) report.warnings.push(`Mark ${mark}: stop ${code} unknown to SIGA`);
    }

    tt.directions.forEach((dir: Direction, d) => {
      const destination = src.point(dir.stops[dir.stops.length - 1]!.stop);
      const notes = { ...fileNotes, ...dir.notes };
      const seen = seenVariants(src, candidates, dir, notes, report);
      const claimed = new Set([...seen.values()].flat());
      for (const type of DAY_TYPES) {
        (dir[type] ?? []).forEach((row, r) => {
          const where = `${dir.to}, ${type}, row ${r + 1}`;
          let cells: Cell[];
          try {
            cells = parseRow(row, dir.stops.length);
          } catch (err) {
            report.skipped.push(`${where}: ${(err as Error).message}`);
            return;
          }
          const timed = cells.flatMap((c, i) => (c.time === undefined ? [] : [i]));
          if (timed.length === 0) return;
          // The same minute printed at places kilometres apart: a slip of the pen.
          for (let k = 1; k < timed.length; k++) {
            const a = cells[timed[k - 1]!]!;
            const b = cells[timed[k]!]!;
            const pa = src.point(dir.stops[timed[k - 1]!]!.stop);
            const pb = src.point(dir.stops[timed[k]!]!.stop);
            const km = pa && pb ? haversine(pa, pb) / 1000 : 0;
            if (b.time! <= a.time! && km > 1) {
              b.time = a.time! + Math.max(1, Math.round(km * 2));
              report.warnings.push(
                `${where}: the same time at ${dir.stops[timed[k - 1]!]!.name} and ${dir.stops[timed[k]!]!.name}; ${Math.round(km * 2)} min allowed`,
              );
            }
          }
          const marks = readMarks(cells, notes);
          if (marks.unknown.length > 0) {
            report.skipped.push(`${where}: unknown marks ${marks.unknown.join(', ')}`);
            return;
          }
          if (marks.skip) {
            report.skipped.push(`${where}: ${marks.skip}`);
            return;
          }
          // A trip that starts or ends off the printed places ("from Rochão").
          const points = dir.stops.map((p, i) =>
            marks.from && i === timed[0] ? { name: p.name, stop: marks.from } : p,
          );
          const end = marks.to ? src.point(marks.to) : destination;

          // The variant: the one named for the marks, or the line's one that passes the
          // printed places in about the printed times and agrees with the marks' landmarks.
          // Named in the file, or seen by SIGA running such a trip (then it must also fit the times).
          const explicit = dir.variants?.[marks.via];
          const named = explicit ?? seen.get(evidenceKey(marks));
          const choices: { variant: SigaVariant; at: (number | undefined)[] }[] = [];
          const consider = (variant: SigaVariant | undefined) => {
            if (!variant) return;
            const at = locate(src, variant, points, cells);
            if (!at) return;
            if (timed.length === 1 || marks.to) {
              const last = src.point(variant.stops[variant.stops.length - 1]![0]);
              if (!last || !end || haversine(last, end) > SAME_END) return;
            }
            choices.push({ variant, at });
          };
          if (marks.noVariant) {
            // Printed places only.
          } else if (named) {
            for (const id of named) {
              consider(src.variant(id));
              if (choices.length > 0) break;
            }
          } else if (timed.length > 1) {
            // A variant seen running trips with other marks drives those, not these. With
            // only the departure printed nothing shows which way the trip goes: no guess.
            for (const v of candidates) {
              if (claimed.has(v.id) || (marks.line && v.line !== marks.line)) continue;
              const agrees = landmarks.every(
                ([mark, code]) => marks.all.has(mark) === src.passes(v, code),
              );
              if (agrees) consider(v);
            }
          }
          const scored = choices
            .map((c) => {
              const known = timed.map((i) => ({ index: c.at[i]!, time: cells[i]!.time! }));
              return { ...c, known, off: misfit(c.variant, known) };
            })
            // A variant SIGA showed running such a trip may keep rougher times than one
            // picked by its fit alone.
            .filter((c) => explicit || c.off <= (named ? SEEN_TIME_SLACK : TIME_SLACK))
            .sort((a, b) => a.off - b.off || a.variant.id.localeCompare(b.variant.id));
          const best = scored[0];
          if (!named && best && timed.length === 1) {
            // With only the departure printed, only the landmarks tell the variants apart.
            const others = scored.filter((c) => c !== best).map((c) => c.variant.id);
            if (others.length > 0) {
              report.warnings.push(
                `${where}: ${[best.variant.id, ...others].join(', ')} fit alike; took ${best.variant.id}`,
              );
            }
          }

          let stops: TripStop[];
          let line = marks.line ?? tt.line;
          let filled = false;
          if (best) {
            if (!marks.line && sigaLines.includes(best.variant.line)) line = best.variant.line;
            stops = layOnVariant(best.variant, best.known);
          } else {
            // Not seen on SIGA yet: the printed places only.
            stops = timed.map((i) => ({
              code: points[i]!.stop,
              time: cells[i]!.time!,
              index: -1,
            }));
            const id = named?.[0];
            const route = id ? src.route(id) : undefined;
            if (route && !marks.line && sigaLines.includes(route.line)) line = route.line;
            if (timed.length === 1) {
              // The arrival from SIGA's running time: the named variant's, or the
              // line's usual time between the two places.
              const lastCode = marks.to ?? dir.stops[dir.stops.length - 1]!.stop;
              // Plain trips' variants first: a detour SIGA has not shown is closer to
              // the plain way than to the express one.
              const plain = dir.variants?.[''] ?? seen.get(evidenceKey({ ...marks, via: '' }));
              const duration =
                (id ? src.duration(id) : undefined) ??
                usualDuration(
                  src,
                  plain?.flatMap((p) => src.variant(p) ?? []) ?? [],
                  points[timed[0]!]!.stop,
                  lastCode,
                ) ??
                usualDuration(src, candidates, points[timed[0]!]!.stop, lastCode, true);
              if (duration === undefined || (!marks.to && timed[0] === dir.stops.length - 1)) {
                report.skipped.push(
                  `${where}: only the departure is printed and SIGA has no variant for it yet`,
                );
                return;
              }
              stops.push({
                code: lastCode,
                time: stops[0]!.time + Math.round(duration),
                index: -1,
              });
            }
            // The stops of the stretches every known variant agrees on.
            if (!explicit || explicit.some((id) => src.variant(id))) {
              const lineVariants = candidates.filter((v) => !marks.line || v.line === marks.line);
              const withStops: TripStop[] = [stops[0]!];
              let k = 1;
              while (k < stops.length) {
                // A stretch between two printed places, or else across the next one too.
                let step = 0;
                for (const span of [1, 2]) {
                  if (k - 1 + span >= stops.length) break;
                  const anchors = stops.slice(k - 1, k + span);
                  const between = stretch(src, lineVariants, anchors, marks, landmarks);
                  if (between) {
                    withStops.push(...between, anchors[anchors.length - 1]!);
                    filled = true;
                    step = span;
                    break;
                  }
                }
                if (step === 0) {
                  withStops.push(stops[k]!);
                  step = 1;
                }
                k += step;
              }
              stops = withStops;
            }
          }
          const unknownStop = stops.find((s) => !siga.stops[s.code]);
          if (unknownStop) {
            report.skipped.push(`${where}: stop ${unknownStop.code} unknown to SIGA`);
            return;
          }
          // The journey planner has this line's every trip.
          if (covered.has(lineKey(tt.operator, line))) {
            coveredRows++;
            return;
          }
          const service = serviceFor(type, marks.rule, closed, tt.operator, line);
          // No day left: holidays only and none before `to`, or SIGA's own days of the line stand.
          if (!service) return;
          if (best) report.full++;
          else {
            report.outline++;
            if (filled) report.filled++;
          }

          // A change of bus splits the trip in two where it happens.
          const cuts = marks.change
            .map((i) =>
              best
                ? stops.findIndex((s) => s.index === best.at[i])
                : stops.findIndex((s) => s.code === dir.stops[i]!.stop),
            )
            .filter((k) => k > 0 && k < stops.length - 1)
            .sort((a, b) => a - b);
          const pieces: TripStop[][] = [];
          let begin = 0;
          for (const cut of cuts) {
            // The printed time is the next bus's departure; the first one gets there a bit before.
            const piece = stops.slice(begin, cut + 1).map((s) => ({ ...s }));
            const last = piece[piece.length - 1]!;
            last.time = Math.max(piece[piece.length - 2]!.time, last.time - CHANGE_MINUTES);
            pieces.push(piece);
            begin = cut;
          }
          pieces.push(stops.slice(begin));

          const routeId = routeFor(tt.operator, line);
          pieces.forEach((piece, p) => {
            const day = type === 'weekdays' ? 'U' : type === 'saturdays' ? 'S' : 'D';
            const tripId = `${routeId}-${d}${day}${r + 1}${pieces.length > 1 ? `-${p + 1}` : ''}`;
            if (best) tripVariants.set(tripId, best.variant.id);
            feed.trips.push({
              trip_id: tripId,
              route_id: routeId,
              service_id: service,
              trip_headsign: dir.to,
              direction_id: d % 2,
            });
            piece.forEach((s, i) => {
              usedStops.add(s.code);
              feed.stopTimes.push({
                trip_id: tripId,
                stop_id: s.code,
                stop_sequence: i + 1,
                arrival_time: s.time * 60,
                departure_time: s.time * 60,
              });
            });
          });
        });
      }
    });
    if (coveredRows > 0 && report.full + report.outline === 0) report.covered = true;
  }

  const tripIds = new Set<string>();
  /** A trip with its time at every stop: departure (HH:MM) plus the minutes to each stop. */
  const addTrip = (t: {
    op: Operator;
    line: string;
    id: string;
    variant: string;
    service: string;
    direction: number;
    codes: readonly string[];
    offsets: readonly number[] | undefined;
    start: string;
    name?: string;
  }) => {
    const t0 = /^(\d{1,2}):(\d{2})$/.exec(t.start);
    const { codes, offsets } = t;
    if (!offsets || offsets.length !== codes.length || codes.length < 2 || !t0) return false;
    if (codes.some((c) => !siga.stops[c])) return false;
    const routeId = routeFor(t.op, t.line);
    let tripId = `${routeId}-${t.id}`;
    while (tripIds.has(tripId)) tripId += '+';
    tripIds.add(tripId);
    tripVariants.set(tripId, t.variant);
    feed.trips.push({
      trip_id: tripId,
      route_id: routeId,
      service_id: t.service,
      trip_headsign: headsignFor(t.op, t.line, codes, t.name),
      direction_id: t.direction % 2,
    });
    const departure = Number(t0[1]) * 60 + Number(t0[2]);
    codes.forEach((code, i) => {
      usedStops.add(code);
      const time = (departure + offsets[i]!) * 60;
      feed.stopTimes.push({
        trip_id: tripId,
        stop_id: code,
        stop_sequence: i + 1,
        arrival_time: time,
        departure_time: time,
      });
    });
    return true;
  };

  // SIGA's journey planner: every trip of every line, with the days its service runs.
  let plannerReport: PlannerReport | undefined;
  if (planner) {
    const serviceTrips = new Map<string, number>();
    const plannerLines = new Map<string, PlannerReport['lines'][number]>();
    for (const [id, dates] of plannerDates) addService(`P-${id}`, dates);
    for (const p of planner.patterns) {
      const op = operatorOf(p.operator);
      if (!op) continue;
      for (const [start, profile, service] of p.trips) {
        if (!plannerDates.has(service)) continue;
        const added = addTrip({
          op,
          line: p.line,
          id: `${service}-${p.id.replaceAll(':', 'd')}-${start.replace(':', '')}`,
          variant: `${p.route}:${p.direction}`,
          service: `P-${service}`,
          direction: p.direction,
          codes: p.stops,
          offsets: p.profiles[profile],
          start,
          name: p.name,
        });
        if (!added) continue;
        serviceTrips.set(service, (serviceTrips.get(service) ?? 0) + 1);
        const key = lineKey(op, p.line);
        const entry = plannerLines.get(key) ?? { operator: op, line: p.line, trips: 0 };
        entry.trips++;
        plannerLines.set(key, entry);
      }
    }
    plannerReport = {
      services: [...plannerDates].map(([id, dates]: [string, string[]]) => ({
        id,
        first: dates[0]!,
        last: dates[dates.length - 1]!,
        dates: dates.length,
        trips: serviceTrips.get(id) ?? 0,
      })),
      lines: [...plannerLines.values()].sort(
        (a, b) =>
          a.operator.localeCompare(b.operator) ||
          a.line.localeCompare(b.line, 'en', { numeric: true }),
      ),
    };
  }

  // The days the SIGA website was seen running: every trip at every stop.
  const observed: ObservedReport = { days: [], lines: [] };
  const lineTrips = new Map<string, ObservedReport['lines'][number]>();
  const datesByKind = new Map<DayKind, string[]>();
  for (const [date, kind] of dayKinds) {
    if (date.slice(5) === '12-25') continue; // No buses on Christmas Day.
    datesByKind.set(kind, [...(datesByKind.get(kind) ?? []), date]);
  }
  // Kinds of day with the very same timetable (the weekdays, mostly) share one service.
  const groups = new Map<string, { kinds: DayKind[]; dates: string[] }>();
  for (const [kind, dates] of datesByKind) {
    const same = JSON.stringify(
      (days[kind] ?? []).map((r) => [r.id, r.stops, r.profiles, r.trips]),
    );
    const group = groups.get(same) ?? { kinds: [], dates: [] };
    group.kinds.push(kind);
    group.dates.push(...dates);
    groups.set(same, group);
  }
  for (const { kinds, dates: groupDates } of groups.values()) {
    const kind = kinds[0]!;
    const records = days[kind] ?? [];
    const service = `O-${kinds.join('-')}`;
    addService(service, [...groupDates].sort());
    let trips = 0;
    for (const r of records) {
      const op = operatorOfVariant(r.id);
      // The journey planner has every trip of the line, on every day.
      if (!op || covered.has(lineKey(op, r.line))) continue;
      const sigaRoute = src.route(r.id);
      const direction = Number(r.id.split(':')[1] ?? 0) % 2;
      for (const [start, profile, own] of r.trips) {
        const added = addTrip({
          op,
          line: r.line,
          id: `${kind}-${r.id.replace(':', 'd')}-${start.replace(':', '')}`,
          variant: r.id,
          service,
          direction,
          codes: own ?? r.stops,
          offsets: r.profiles[profile],
          start,
          name: sigaRoute?.name,
        });
        if (!added) continue;
        trips++;
        const key = lineKey(op, r.line);
        const entry = lineTrips.get(key) ?? { operator: op, line: r.line, trips: 0 };
        entry.trips++;
        lineTrips.set(key, entry);
      }
    }
    for (const k of kinds) {
      const seen = days[k] ?? [];
      observed.days.push({
        kind: k,
        date: seen.reduce((d, r) => (r.date > d ? r.date : d), ''),
        variants: seen.length,
        trips,
        dates: datesByKind.get(k)?.length ?? 0,
      });
    }
  }
  observed.lines = [...lineTrips.values()].sort(
    (a, b) =>
      a.operator.localeCompare(b.operator) || a.line.localeCompare(b.line, 'en', { numeric: true }),
  );

  for (const op of agencies) {
    const a = AGENCIES[op];
    feed.agencies.push({
      agency_id: a.id,
      agency_name: a.name,
      agency_url: a.url,
      agency_timezone: 'Atlantic/Madeira',
    });
  }
  for (const code of [...usedStops].sort()) {
    const [name, lat, lon, zone] = siga.stops[code]!;
    feed.stops.push({
      stop_id: code,
      stop_code: code,
      stop_name: name,
      // Outside Funchal many stops are named after the road (ER214): add the village.
      ...(zone !== '3103' && localities.length > 0
        ? { stop_desc: withLocality(name, { lat, lon }, localities) }
        : {}),
      stop_lat: lat,
      stop_lon: lon,
      location_type: 0,
      ...(zone ? { municipality: zone } : {}),
    } satisfies GtfsStop);
  }
  // Lines on SIGA's list without any trip here (CAM's operator name is long on SIGA).
  const withTrips = new Set(feed.trips.map((t) => t.route_id));
  const built = new Set(
    feed.routes.filter((r) => withTrips.has(r.route_id)).map((r) => `${r.agency_id}|${r.line_id}`),
  );
  const missing: Record<Operator, string[]> = { CAM: [], Rodoeste: [] };
  // A line SIGA lists without any stop (CAM's 560 "Cristo Rei") has nothing to show yet.
  const withStops = new Set(siga.routes.filter((r) => r.stops > 0).map((r) => r.line));
  for (const r of siga.routes) {
    const op = operatorOf(r.operator);
    if (!op || !withStops.has(r.line)) continue;
    if (built.has(`${AGENCIES[op].id}|${r.line}`) || missing[op].includes(r.line)) continue;
    missing[op].push(r.line);
  }
  for (const op of Object.keys(missing) as Operator[]) {
    missing[op].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }
  return {
    feed,
    lines,
    observed,
    ...(plannerReport ? { planner: plannerReport } : {}),
    tripVariants,
    missing,
  };
}
