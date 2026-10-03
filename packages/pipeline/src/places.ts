import { haversine, normalise, type BPlace } from '@madeirabus/engine';

/** An element of an Overpass API JSON answer (`out center tags`). */
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Languages of the app; their OSM `name:xx` tags become searchable names. */
const LANGS = ['uk', 'en', 'pt', 'es', 'fr', 'it', 'de', 'cs', 'pl', 'ru'];
/** Other OSM names people may type. */
const ALT_NAMES = ['alt_name', 'short_name', 'official_name', 'old_name', 'int_name'];

/**
 * The app's category for a mapped feature, or undefined to leave it out.
 * Minor churches and monuments are only kept when Wikidata knows them.
 */
export function placeKind(t: Record<string, string>): string | undefined {
  const notable = Boolean(t.wikidata || t.wikipedia);
  if (t.aeroway === 'aerodrome') return 'aerodrome';
  if (t.aerialway === 'station') return 'cable_car';
  if (t.amenity === 'ferry_terminal') return 'ferry_terminal';
  if (t.amenity === 'bus_station') return 'bus';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'marketplace') return 'marketplace';
  if (t.amenity === 'university' || t.amenity === 'college') return 'college';
  if (t.amenity === 'townhall') return 'town_hall';
  if (t.amenity === 'theatre') return 'theatre';
  if (t.amenity === 'casino') return 'attraction';
  if (t.amenity === 'place_of_worship') return notable ? 'place_of_worship' : undefined;
  if (t.tourism === 'hotel') return 'hotel';
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.tourism === 'attraction' || t.tourism === 'zoo' || t.tourism === 'theme_park')
    return 'attraction';
  if (t.shop === 'mall') return 'mall';
  if (t.natural === 'beach') return 'beach';
  if (t.natural === 'peak') return 'peak';
  if (t.natural === 'cape' || t.natural === 'bay') return 'nature';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.leisure === 'stadium') return 'stadium';
  if (t.leisure === 'marina') return 'harbor';
  if (t.leisure === 'water_park') return 'attraction';
  if (t.highway === 'trailhead') return 'trailhead';
  if (t.historic) return notable ? 'historic' : undefined;
  if (t.place === 'city' || t.place === 'town') return 'town';
  if (t.place === 'village' || t.place === 'suburb') return 'village';
  if (t.place) return 'locality';
  return undefined;
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * Searchable places from an Overpass answer: one entry per named feature,
 * with its names in the app's languages, without near-duplicates (a museum
 * mapped as a node and as a building).
 */
export function placesFromOsm(json: { elements?: OsmElement[] }): BPlace[] {
  const out: (BPlace & { notable: boolean })[] = [];
  const byName = new Map<string, (BPlace & { notable: boolean })[]>();
  for (const e of json.elements ?? []) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const kind = placeKind(t);
    if (!t.name || lat === undefined || lon === undefined || !kind) continue;
    const names: Record<string, string> = {};
    for (const l of LANGS) {
      const n = t[`name:${l}`];
      if (n && n !== t.name) names[l] = n;
    }
    for (const k of ALT_NAMES) if (t[k] && t[k] !== t.name) names[k] = t[k];
    const place = {
      name: t.name,
      lat: round(lat),
      lon: round(lon),
      kind,
      ...(Object.keys(names).length > 0 && { names }),
      notable: Boolean(t.wikidata || t.wikipedia),
    };
    const key = `${kind}|${normalise(t.name)}`;
    const same = byName.get(key) ?? [];
    const dup = same.find((p) => haversine(p, place) < 300);
    if (dup) {
      // Keep the richer record of the two.
      if (!dup.notable && place.notable) Object.assign(dup, place);
      else if (place.names) dup.names = { ...place.names, ...dup.names };
      continue;
    }
    same.push(place);
    byName.set(key, same);
    out.push(place);
  }
  return out
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    .map(({ notable: _notable, ...p }) => p);
}
