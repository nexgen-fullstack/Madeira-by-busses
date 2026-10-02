import { haversine, type LatLon } from './geo.ts';

/** The 11 municipalities of the Autonomous Region of Madeira with the
 * approximate position of each seat. Fares depend on whether a trip stays
 * inside one municipality, so every stop is tagged with one of these codes. */
export const MUNICIPALITIES = [
  { code: 'CLT', ine: '3101', name: 'Calheta', lat: 32.7213, lon: -17.1772 },
  { code: 'CML', ine: '3102', name: 'Câmara de Lobos', lat: 32.6486, lon: -16.9775 },
  { code: 'FNC', ine: '3103', name: 'Funchal', lat: 32.6497, lon: -16.9086 },
  { code: 'MCH', ine: '3104', name: 'Machico', lat: 32.7179, lon: -16.767 },
  { code: 'PSO', ine: '3105', name: 'Ponta do Sol', lat: 32.6811, lon: -17.1006 },
  { code: 'PMZ', ine: '3106', name: 'Porto Moniz', lat: 32.867, lon: -17.1695 },
  { code: 'RBR', ine: '3107', name: 'Ribeira Brava', lat: 32.6733, lon: -17.0639 },
  { code: 'SCR', ine: '3108', name: 'Santa Cruz', lat: 32.6878, lon: -16.793 },
  { code: 'STN', ine: '3109', name: 'Santana', lat: 32.8058, lon: -16.8822 },
  { code: 'SVC', ine: '3110', name: 'São Vicente', lat: 32.7963, lon: -17.043 },
  { code: 'PST', ine: '3201', name: 'Porto Santo', lat: 33.061, lon: -16.342 },
] as const;

export type MunicipalityCode = (typeof MUNICIPALITIES)[number]['code'];

const CODES = new Set<string>(MUNICIPALITIES.map((m) => m.code));

export function isMunicipalityCode(value: string | undefined): value is MunicipalityCode {
  return value !== undefined && CODES.has(value.toUpperCase());
}

/** Our code for a Portuguese INE municipality code (as used in Portuguese GTFS feeds). */
export function municipalityFromIne(ine: string | undefined): MunicipalityCode | undefined {
  return MUNICIPALITIES.find((m) => m.ine === ine?.trim())?.code;
}

/**
 * Approximates the municipality of a point by its nearest seat. This is a
 * fallback for feeds that do not tag stops; it can be wrong near borders, so
 * the pipeline reports how many stops were tagged this way.
 */
export function nearestMunicipality(p: LatLon): MunicipalityCode {
  let best: MunicipalityCode = 'FNC';
  let bestDistance = Infinity;
  for (const m of MUNICIPALITIES) {
    const d = haversine(p, m);
    if (d < bestDistance) {
      bestDistance = d;
      best = m.code;
    }
  }
  return best;
}

export function municipalityName(code: string): string {
  return MUNICIPALITIES.find((m) => m.code === code)?.name ?? code;
}
