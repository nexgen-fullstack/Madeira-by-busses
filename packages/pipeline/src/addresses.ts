import { haversine, normalise, type BPlace, type LatLon } from '@madeirabus/engine';
import type { OsmElement } from './places.ts';

/**
 * Streets and house numbers of Madeira from OpenStreetMap, to find an address
 * typed in the search ("Rua do Hospital Velho 12"). The island's addresses were
 * imported from Statistics Portugal (INE): about 90 000 house numbers, each with
 * its street; the streets themselves come from the named ways.
 *
 * The file is compact JSON, loaded by the app only once someone types:
 *
 *     { v: 1, areas: [name…], streets: [[name, lat, lon, area, numbers, dlat, dlon]…] }
 *
 * with coordinates in 1e-5 degrees (about a metre), a street's point being the
 * middle of the street, `numbers` its house numbers joined with "," and `dlat` /
 * `dlon` each house's offset from the street's point, in the same units.
 */
export interface AddressBook {
  v: 1;
  /** Village or town names, the street's place shown under it. */
  areas: string[];
  streets: [string, number, number, number, string, number[], number[]][];
}

/** Ways of the same name further apart than this (m) are different streets. */
const SAME_STREET = 800;
/** A house this far (m) from every street of its name starts a street of its own. */
const HOUSE_REACH = 2000;
/** Porto Santo lies north of this: its addresses are not on Madeira's buses. */
const MADEIRA_NORTH = 32.95;

const e5 = (v: number) => Math.round(v * 1e5);

interface Street {
  name: string;
  /** Mapped as a way, not only named in addresses. */
  way: boolean;
  /** Middles of its ways (or its houses, for a street known only by them). */
  points: LatLon[];
  houses: { number: string; at: LatLon }[];
}

/** Where an Overpass element is (`out center` gives ways and relations a centre). */
const where = (e: OsmElement): LatLon | undefined =>
  e.lat !== undefined && e.lon !== undefined
    ? { lat: e.lat, lon: e.lon }
    : e.center
      ? { lat: e.center.lat, lon: e.center.lon }
      : undefined;

/**
 * The address book from an Overpass answer holding the named streets
 * (`way[highway][name]`) and the house numbers (`nwr[addr:housenumber]`),
 * each place named after the nearest village or town of `places`.
 */
export function addressesFromOsm(
  elements: readonly OsmElement[],
  places: readonly BPlace[],
): AddressBook {
  const streets = new Map<string, Street[]>();
  const streetOf = (name: string, at: LatLon, reach: number, make: boolean) => {
    const key = normalise(name);
    const list = streets.get(key) ?? [];
    streets.set(key, list);
    let best: Street | undefined;
    let bestD = reach;
    for (const s of list) {
      for (const p of s.points) {
        const d = haversine(p, at);
        if (d <= bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    if (!best && make) {
      best = { name, way: false, points: [], houses: [] };
      list.push(best);
    }
    return best;
  };

  const houses: { street: string; number: string; at: LatLon }[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    const at = where(e);
    if (!at || at.lat > MADEIRA_NORTH) continue;
    if (t['addr:housenumber']) {
      const street = t['addr:street'] ?? t['addr:place'];
      if (street) houses.push({ street, number: t['addr:housenumber'].trim(), at });
    } else if (t.highway && t.name) {
      const s = streetOf(t.name, at, SAME_STREET, true)!;
      s.way = true;
      s.points.push(at);
    }
  }
  // The longest mapped street whose name starts the address's: "Caminho Passo Ent 41"
  // and "Rua do Hospital Velho 23A, Edificio Insular, Piso 4" are on the streets so named.
  const mappedStart = (name: string, at: LatLon) => {
    const key = normalise(name);
    let best: Street | undefined;
    for (const [k, list] of streets) {
      if (!key.startsWith(`${k} `) || (best && k.length <= normalise(best.name).length)) continue;
      const near = list.find((s) => s.way && s.points.some((p) => haversine(p, at) <= HOUSE_REACH));
      if (near) best = near;
    }
    return best;
  };
  for (const h of houses) {
    const found = streetOf(h.street, h.at, HOUSE_REACH, false);
    const messy = /\d|,/.test(h.street);
    const s = found ?? (messy ? mappedStart(h.street, h.at) : streetOf(h.street, h.at, 0, true));
    if (!s) continue;
    if (s.points.length === 0 && s.houses.length === 0) s.points.push(h.at);
    s.houses.push({ number: h.number, at: h.at });
  }

  const towns = places.filter((p) => p.kind === 'town' || p.kind === 'village');
  const areas: string[] = [];
  const areaIndex = new Map<string, number>();
  const out: AddressBook['streets'] = [];
  for (const list of streets.values()) {
    for (const s of list) {
      if (s.points.length === 0 && s.houses.length === 0) continue;
      // The street's point: of its ways' middles, the one nearest their mean.
      const all = s.points.length > 0 ? s.points : s.houses.map((h) => h.at);
      const mean = {
        lat: all.reduce((a, p) => a + p.lat, 0) / all.length,
        lon: all.reduce((a, p) => a + p.lon, 0) / all.length,
      };
      const point = all.reduce((a, p) => (haversine(p, mean) < haversine(a, mean) ? p : a));
      let area = '';
      let near = Infinity;
      for (const t of towns) {
        const d = haversine(t, point);
        if (d < near) {
          near = d;
          area = t.name;
        }
      }
      let a = areaIndex.get(area);
      if (a === undefined) {
        a = areas.length;
        areas.push(area);
        areaIndex.set(area, a);
      }
      // One entry per number: the first one mapped wins.
      const seen = new Set<string>();
      const hs = s.houses
        .filter(
          (h) => h.number && !h.number.includes(',') && !seen.has(h.number) && seen.add(h.number),
        )
        .sort((x, y) => x.number.localeCompare(y.number, 'pt', { numeric: true }));
      const lat = e5(point.lat);
      const lon = e5(point.lon);
      out.push([
        s.name,
        lat,
        lon,
        a,
        hs.map((h) => h.number).join(','),
        hs.map((h) => e5(h.at.lat) - lat),
        hs.map((h) => e5(h.at.lon) - lon),
      ]);
    }
  }
  out.sort((x, y) => x[0].localeCompare(y[0], 'pt') || x[1] - y[1]);
  return { v: 1, areas, streets: out };
}
