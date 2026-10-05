import type { GtfsAgency, GtfsRoute, GtfsStop } from '@madeirabus/engine';

/** Abbreviations used in Madeira's stop names, expanded for readability. */
const ABBREVIATIONS: Record<string, string> = {
  AV: 'Avenida',
  AZ: 'Azinhaga',
  BC: 'Beco',
  CAM: 'Caminho',
  CMDT: 'Comandante',
  CZ: 'Cruzamento',
  DR: 'Dr.',
  ENG: 'Eng.',
  ENT: 'Entrada',
  FJ: 'Fajã',
  CORJ: 'Corujeira',
  ESC: 'Escola',
  ESCL: 'Escola',
  ESTR: 'Estrada',
  JRD: 'Jardim',
  LEV: 'Levada',
  LG: 'Largo',
  LMB: 'Lombo',
  MIRDR: 'Miradouro',
  PALH: 'Palheiro',
  PAV: 'Pavilhão',
  PQ: 'Parque',
  QTA: 'Quinta',
  RIB: 'Ribeira',
  ROT: 'Rotunda',
  STA: 'Santa',
  STO: 'Santo',
  TRAV: 'Travessa',
  TV: 'Travessa',
  URB: 'Urbanização',
  VER: 'Vereda',
  ZN: 'Zona',
};

/** Abbreviated place names that need their context to expand. */
const PHRASES: [RegExp, string][] = [
  [/\b(C ?|Curral )Freiras\b/g, 'Curral das Freiras'],
  [/\bJ Botânico\b/g, 'Jardim Botânico'],
  [/\bPC Povo\b/g, 'Praça do Povo'],
  [/\bS Menor\b/g, 'Santiago Menor'],
  [/\bS (Amaro|António)\b/g, 'Santo $1'],
  [/\bS (Luzia|Maria|Cruz|Clara)\b/g, 'Santa $1'],
  [/\bS (Martinho|Roque|Gonçalo|João|Pedro|Lourenço|Tiago|Vicente|Jorge)\b/g, 'São $1'],
  // On SIGA's stops outside Funchal "R" can be a ribeira or a saint, not a street.
  [/\b(?:Rua|R\.) Brava\b/g, 'Ribeira Brava'],
  [/\bS(?:ão|ao) (?:Rua|R\.) Faial\b/g, 'São Roque do Faial'],
];

/** Expands the abbreviations of Madeira's timetables in a name. */
export function expandAbbreviations(name: string): string {
  const words = name.replace(/\s+/g, ' ').trim().split(' ');
  const expanded = words
    .map((w, i) => {
      // "R" is "Rua" before a name ("R Nova Alegria"), never a word by itself.
      if (w === 'R' && (i === 0 || /^\p{Lu}/u.test(words[i + 1] ?? ''))) return 'Rua';
      return ABBREVIATIONS[w] ?? w;
    })
    .join(' ');
  return PHRASES.reduce((text, [pattern, full]) => text.replace(pattern, full), expanded);
}

/**
 * Notes that Horários do Funchal appends to a stop name after a double space
 * and that mean nothing to passengers: the side of the road ("D", "S"), the
 * terminus of a line ("T-04 83", "T") and bay numbers ("C8").
 */
const STOP_NOTE = /^(?:[DS]|T(?:-.*)?|C\d+)$/;

/** Drops the internal notes of a stop name ("Monte  Tanque  D" → "Monte Tanque"). */
function withoutNotes(name: string): string {
  const [head = '', ...notes] = name.trim().split(/\s{2,}/);
  return [head, ...notes.filter((n) => !STOP_NOTE.test(n)).map((n) => n.replace(/^E E M$/, 'EEM'))]
    .join(' ')
    .trim();
}

/**
 * Human-friendly stop name: prefers the descriptive `stop_desc`, drops the
 * trailing stop code ("… (675)") and internal notes, and expands the common
 * abbreviations ("CAM LMB Aguiares" → "Caminho Lombo Aguiares").
 */
export function prettyStopName(stop: Pick<GtfsStop, 'stop_name' | 'stop_desc'>): string {
  return expandAbbreviations(
    withoutNotes(stop.stop_desc?.trim() || stop.stop_name.replace(/\s*\([^)]*\)\s*$/, '')),
  );
}

/** Route name with abbreviations expanded ("Funchal - CFreiras" → "Funchal - Curral das Freiras"). */
export function prettyRouteName(route: Pick<GtfsRoute, 'route_long_name'>): string {
  return expandAbbreviations(route.route_long_name);
}

/** Ignores the zero padding of line numbers: "01" and "001" are both line 1. */
const unpadded = (n: string) => n.replace(/^0+(?=.)/, '');

/**
 * The number on the front of the bus, and the one it replaced. SIGA gave
 * Madeira's lines three-digit numbers on 9 March 2026 (10A became 110, 81
 * became 181). Horários do Funchal's feed carries the new number as the
 * GTFS-PT `line_id` but still the old one as `route_short_name`, so a
 * timetable showing `route_short_name` announced a "10A" when the 110 came.
 */
export function sigaRouteNumber(route: Pick<GtfsRoute, 'route_short_name' | 'line_id'>): {
  short: string;
  formerly?: string;
} {
  const old = route.route_short_name.trim();
  const current = route.line_id?.trim();
  if (!current || !/^\d{3}$/.test(current)) return { short: old };
  return old && unpadded(old) !== unpadded(current)
    ? { short: current, formerly: old }
    : { short: current };
}

/** Operators that feeds name by their initials. */
const AGENCIES: Record<string, string> = {
  HF: 'Horários do Funchal',
  HF_PA: 'Horários do Funchal · Pico do Areeiro',
};

export function prettyAgencyName(agency: Pick<GtfsAgency, 'agency_name'>): string {
  return AGENCIES[agency.agency_name.trim()] ?? agency.agency_name;
}
