/** Time helpers. Service times are seconds after midnight of the service day
 * (GTFS allows values past 24:00 for trips that run after midnight). Dates are
 * plain `YYYY-MM-DD` strings in Madeira local time; we never rely on the
 * device time zone. */

export const MADEIRA_TZ = 'Atlantic/Madeira';
export const DAY = 86_400;

/** Parses "HH:MM:SS" (hours may exceed 23) into seconds. */
export function parseGtfsTime(value: string): number {
  const parts = value.trim().split(':');
  if (parts.length < 2) throw new Error(`Invalid GTFS time "${value}"`);
  const [h, m, s = '0'] = parts;
  const out = Number(h) * 3600 + Number(m) * 60 + Number(s);
  if (!Number.isFinite(out)) throw new Error(`Invalid GTFS time "${value}"`);
  return out;
}

/** Seconds → "HH:MM", wrapping past midnight. */
export function formatClock(seconds: number): string {
  const s = (((Math.round(seconds / 60) * 60) % DAY) + DAY) % DAY;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Converts GTFS `YYYYMMDD` to ISO `YYYY-MM-DD`. */
export function gtfsDateToIso(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error(`Invalid GTFS date "${value}"`);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** Converts ISO `YYYY-MM-DD` to GTFS `YYYYMMDD`. */
export function isoToGtfsDate(value: string): string {
  return value.replaceAll('-', '');
}

/** Adds whole days to an ISO date (calendar arithmetic in UTC, no DST issues). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Current date and seconds-after-midnight in Madeira, whatever the device zone. */
let madeiraClock: Intl.DateTimeFormat | undefined;

export function madeiraNow(now: Date = new Date()): { date: string; time: number } {
  // Creating a formatter is slow; screens ask for the time on every render.
  madeiraClock ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: MADEIRA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = madeiraClock.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: Number(get('hour')) * 3600 + Number(get('minute')) * 60 + Number(get('second')),
  };
}

/** Gregorian Easter Sunday (anonymous algorithm), ISO date. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** National holidays of Portugal plus the regional holidays of Madeira. */
export function madeiraHolidays(year: number): { date: string; name: string }[] {
  const easter = easterSunday(year);
  const fixed: [string, string][] = [
    ['01-01', 'Ano Novo'],
    ['04-25', 'Dia da Liberdade'],
    ['05-01', 'Dia do Trabalhador'],
    ['06-10', 'Dia de Portugal'],
    ['07-01', 'Dia da Região Autónoma da Madeira'],
    ['08-15', 'Assunção de Nossa Senhora'],
    ['10-05', 'Implantação da República'],
    ['11-01', 'Todos os Santos'],
    ['12-01', 'Restauração da Independência'],
    ['12-08', 'Imaculada Conceição'],
    ['12-25', 'Natal'],
    ['12-26', 'Primeira Oitava'],
  ];
  return [
    ...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    { date: addDays(easter, -2), name: 'Sexta-feira Santa' },
    { date: easter, name: 'Páscoa' },
    { date: addDays(easter, 60), name: 'Corpo de Deus' },
  ].sort((a, b) => a.date.localeCompare(b.date));
}
