import { nameScore, normalise, searchKey } from '@madeirabus/engine';

/**
 * Streets and house numbers to search for ("Rua do Hospital Velho 12"), from
 * data/addresses.json (built from OpenStreetMap by the pipeline's `addresses`
 * command; see its format there). Loaded only once someone types in a search
 * field, so the app starts as fast as before.
 */
interface AddressFile {
  v: 1;
  areas: string[];
  streets: [string, number, number, number, string, number[], number[]][];
}

export interface AddressHit {
  /** The street and the number, as it reads: "Rua do Hospital Velho 12". */
  name: string;
  street: string;
  /** The village or town around it. */
  area: string;
  number?: string;
  /** The number was not mapped: the point is the street's nearest known number. */
  near?: string;
  lat: number;
  lon: number;
  /** Lower is better, comparable with the stop and place search. */
  score: number;
}

interface Street {
  name: string;
  key: { key: string; words: string[] };
  area: string;
  lat: number;
  lon: number;
  numbers: string[];
  dlat: number[];
  dlon: number[];
}

/** "Rua X 12", "Rua X, 12", "Rua X nº 12A": the street and the number typed. */
const WITH_NUMBER = /^(.*?)[\s,]+(?:n\.?[ºo°]?\s*)?(\d+[a-z]?)\s*$/i;
/** "Rua X," or "Rua X, 1": a street chosen, its number being typed. */
const AFTER_COMMA = /^(.*?),\s*(\d*[a-z]?)\s*$/i;

export class AddressIndex {
  private readonly streets: Street[];

  constructor(file: AddressFile) {
    this.streets = file.streets.map(([name, lat, lon, area, numbers, dlat, dlon]) => ({
      name,
      key: searchKey(name),
      area: file.areas[area] ?? '',
      lat: lat / 1e5,
      lon: lon / 1e5,
      numbers: numbers ? numbers.split(',') : [],
      dlat,
      dlon,
    }));
  }

  /**
   * Streets matching what was typed, best first; with a number typed, that house
   * (or the street's nearest number when it is not mapped). After "Street," the
   * street itself and its house numbers starting with what follows.
   */
  search(query: string, limit = 6): AddressHit[] {
    const q = query.trim();
    const comma = AFTER_COMMA.exec(q);
    if (comma) {
      const exact = normalise(comma[1]!);
      const chosen = this.streets.filter((s) => s.key.key === exact);
      if (chosen.length > 0) {
        const typed = comma[2]!.toLowerCase();
        const out: AddressHit[] = [];
        for (const s of chosen) {
          if (!typed) out.push(this.whole(s, 0));
          s.numbers.forEach((n, i) => {
            if (n.toLowerCase().startsWith(typed)) out.push(this.house(s, i, n, 1 + out.length));
          });
        }
        return out.slice(0, Math.max(limit, 8));
      }
    }
    const numbered = WITH_NUMBER.exec(q);
    if (numbered && /\p{L}/u.test(numbered[1]!)) {
      const hits = this.matching(numbered[1]!, limit);
      if (hits.length > 0) {
        const number = numbered[2]!.toLowerCase();
        return hits.map(({ s, score }) => this.numbered(s, number, score));
      }
    }
    return this.matching(q, limit).map(({ s, score }) => this.whole(s, score));
  }

  private matching(query: string, limit: number): { s: Street; score: number }[] {
    if (normalise(query).length < 3) return [];
    const scored: { s: Street; score: number }[] = [];
    for (const s of this.streets) {
      const score = nameScore(query, s.key);
      if (score < Infinity) scored.push({ s, score });
    }
    // Of streets that match as well, the longer ones (more houses) first.
    return scored
      .sort((a, b) => a.score - b.score || b.s.numbers.length - a.s.numbers.length)
      .slice(0, limit);
  }

  private whole(s: Street, score: number): AddressHit {
    return { name: s.name, street: s.name, area: s.area, lat: s.lat, lon: s.lon, score };
  }

  private house(s: Street, i: number, n: string, score: number): AddressHit {
    return {
      name: `${s.name} ${n}`,
      street: s.name,
      area: s.area,
      number: n,
      lat: s.lat + s.dlat[i]! / 1e5,
      lon: s.lon + s.dlon[i]! / 1e5,
      score,
    };
  }

  /** The house with this number, or the street's nearest known number to it. */
  private numbered(s: Street, number: string, score: number): AddressHit {
    const i = s.numbers.findIndex((n) => n.toLowerCase() === number);
    if (i >= 0) return this.house(s, i, s.numbers[i]!, score);
    // The nearest number, on the same side of the street (odd or even) when there is one.
    const want = parseInt(number, 10);
    const off = (n: string) => {
      const v = parseInt(n, 10);
      if (Number.isNaN(v)) return Infinity;
      return Math.abs(v - want) + (Math.abs(v - want) % 2 === 1 ? 1000 : 0);
    };
    let best = -1;
    s.numbers.forEach((n, k) => {
      if (off(n) < Infinity && (best < 0 || off(n) < off(s.numbers[best]!))) best = k;
    });
    if (best < 0) return { ...this.whole(s, score), name: `${s.name} ${number}`, number };
    return { ...this.house(s, best, number, score), near: s.numbers[best] };
  }
}

let loading: Promise<AddressIndex | undefined> | undefined;

/** The address index, loaded on first use; undefined when this build has no addresses. */
export function loadAddresses(): Promise<AddressIndex | undefined> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/addresses.json`)
    .then((res) => (res.ok ? (res.json() as Promise<AddressFile>) : undefined))
    .then((file) => (file?.v === 1 ? new AddressIndex(file) : undefined))
    .catch(() => {
      loading = undefined;
      return undefined;
    });
  return loading;
}
