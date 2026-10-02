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
 * Human-friendly stop name: prefers the descriptive `stop_desc`, drops the
 * trailing stop code ("… (675)") and expands the common abbreviations
 * ("CAM LMB Aguiares" → "Caminho Lombo Aguiares").
 */
export function prettyStopName(stop: Pick<GtfsStop, 'stop_name' | 'stop_desc'>): string {
  return expandAbbreviations(
    stop.stop_desc?.trim() || stop.stop_name.replace(/\s*\([^)]*\)\s*$/, ''),
  );
}

/** Route name with abbreviations expanded ("Funchal - CFreiras" → "Funchal - Curral das Freiras"). */
export function prettyRouteName(route: Pick<GtfsRoute, 'route_long_name'>): string {
  return expandAbbreviations(route.route_long_name);
}

/** Operators that feeds name by their initials. */
const AGENCIES: Record<string, string> = {
  HF: 'Horários do Funchal',
  HF_PA: 'Horários do Funchal · Pico do Areeiro',
};

export function prettyAgencyName(agency: Pick<GtfsAgency, 'agency_name'>): string {
  return AGENCIES[agency.agency_name.trim()] ?? agency.agency_name;
}
