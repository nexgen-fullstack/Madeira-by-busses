import { haversine, type LatLon } from './geo.ts';

/** The 11 municipalities of the Autonomous Region of Madeira with the
 * approximate position of each seat. Fares depend on whether a trip stays
 * inside one municipality, so every stop is tagged with one of these codes. */
export const MUNICIPALITIES = [
  { code: 'FNC', name: 'Funchal', lat: 32.6497, lon: -16.9086 },
  { code: 'CML', name: 'Câmara de Lobos', lat: 32.6486, lon: -16.9775 },
  { code: 'RBR', name: 'Ribeira Brava', lat: 32.6733, lon: -17.0639 },
  { code: 'PSO', name: 'Ponta do Sol', lat: 32.6811, lon: -17.1006 },
  { code: 'CLT', name: 'Calheta', lat: 32.7213, lon: -17.1772 },
  { code: 'PMZ', name: 'Porto Moniz', lat: 32.867, lon: -17.1695 },
  { code: 'SVC', name: 'São Vicente', lat: 32.7963, lon: -17.043 },
  { code: 'STN', name: 'Santana', lat: 32.8058, lon: -16.8822 },
  { code: 'MCH', name: 'Machico', lat: 32.7179, lon: -16.767 },
  { code: 'SCR', name: 'Santa Cruz', lat: 32.6878, lon: -16.793 },
  { code: 'PST', name: 'Porto Santo', lat: 33.061, lon: -16.342 },
] as const;

export type MunicipalityCode = (typeof MUNICIPALITIES)[number]['code'];

const CODES = new Set<string>(MUNICIPALITIES.map((m) => m.code));

export function isMunicipalityCode(value: string | undefined): value is MunicipalityCode {
  return value !== undefined && CODES.has(value.toUpperCase());
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
