/**
 * SIGA fare model. Since January 2026 every operator accepts the GIRO card;
 * a single ride costs a municipal or intermunicipal fare, cheaper on GIRO
 * than in cash on board. Prices live in data (`FareTable`) so a price change
 * is a data update, not a code change.
 *
 * Assumptions to confirm with Tiim (flagged by `verified: false`):
 * - a ride is "municipal" when it starts and ends in the same municipality;
 * - every boarding is paid separately (no free transfer window);
 * - an intermunicipal day pass also covers municipal rides.
 */

export type FareClass = 'municipal' | 'intermunicipal' | 'aerobus';
export type PassScope = 'municipal' | 'intermunicipal' | 'regional';

export interface SingleFare {
  giro: number;
  cash: number;
  childGiro: number;
}

export interface PassFare {
  id: string;
  days: number;
  scope: PassScope;
  price: number;
  includesAerobus: boolean;
}

export interface FareTable {
  currency: 'EUR';
  /** Date the prices were last checked against a source. */
  asOf: string;
  /** False until the table is confirmed against Tiim's official tariff sheet. */
  verified: boolean;
  source: string;
  single: Record<'municipal' | 'intermunicipal', SingleFare>;
  /** Aerobus single fare; null when unknown. */
  aerobus: { single: number | null };
  passes: PassFare[];
}

export const SIGA_FARES_2026: FareTable = {
  currency: 'EUR',
  asOf: '2026-01-22',
  verified: false,
  source:
    'Press coverage of the SIGA 2026 tariff (DN Madeira, 2026-01-22); not yet checked against Tiim',
  single: {
    municipal: { giro: 1.45, cash: 2.0, childGiro: 0.95 },
    intermunicipal: { giro: 1.95, cash: 2.6, childGiro: 1.3 },
  },
  aerobus: { single: null },
  passes: [
    { id: 'day1-municipal', days: 1, scope: 'municipal', price: 4.95, includesAerobus: false },
    { id: 'day3-municipal', days: 3, scope: 'municipal', price: 12.5, includesAerobus: false },
    {
      id: 'day1-intermunicipal',
      days: 1,
      scope: 'intermunicipal',
      price: 6.55,
      includesAerobus: false,
    },
    {
      id: 'day3-intermunicipal',
      days: 3,
      scope: 'intermunicipal',
      price: 16.7,
      includesAerobus: false,
    },
    { id: 'tourist1', days: 1, scope: 'regional', price: 13.75, includesAerobus: true },
    { id: 'tourist3', days: 3, scope: 'regional', price: 23.0, includesAerobus: true },
  ],
};

/** What the fare engine needs to know about one ride. */
export interface FareRide {
  aerobus: boolean;
  fromMunicipality: string;
  toMunicipality: string;
}

export interface RideFare {
  fareClass: FareClass;
  giro: number | null;
  cash: number | null;
}

export interface FareQuote {
  rides: RideFare[];
  /** Total with GIRO; null if any ride's price is unknown. */
  giro: number | null;
  /** Total paying cash on board; null if any ride's price is unknown. */
  cash: number | null;
  /** Sum of the rides whose price is known (useful when `giro` is null). */
  knownGiro: number;
  complete: boolean;
}

export function fareClassOf(ride: FareRide): FareClass {
  if (ride.aerobus) return 'aerobus';
  return ride.fromMunicipality === ride.toMunicipality ? 'municipal' : 'intermunicipal';
}

export function quoteFare(rides: readonly FareRide[], table: FareTable): FareQuote {
  const priced = rides.map<RideFare>((ride) => {
    const fareClass = fareClassOf(ride);
    if (fareClass === 'aerobus') {
      return { fareClass, giro: table.aerobus.single, cash: table.aerobus.single };
    }
    const f = table.single[fareClass];
    return { fareClass, giro: f.giro, cash: f.cash };
  });
  const complete = priced.every((r) => r.giro !== null);
  const sum = (key: 'giro' | 'cash') => round2(priced.reduce((acc, r) => acc + (r[key] ?? 0), 0));
  return {
    rides: priced,
    giro: complete ? sum('giro') : null,
    cash: complete ? sum('cash') : null,
    knownGiro: sum('giro'),
    complete,
  };
}

export interface TicketOption {
  /** `singles`, or the id of a pass. */
  id: string;
  pass?: PassFare;
  /** How many passes are bought (1-day passes for a multi-day plan). */
  count: number;
  /** Price of the passes plus GIRO singles for rides they don't cover. */
  total: number | null;
  uncoveredRides: number;
}

export interface TicketAdvice {
  options: TicketOption[];
  best: TicketOption;
  /** Savings of the best option against GIRO singles (0 when singles win). */
  saving: number;
}

function covers(pass: PassFare, fareClass: FareClass): boolean {
  if (fareClass === 'aerobus') return pass.includesAerobus;
  if (pass.scope === 'municipal') return fareClass === 'municipal';
  return true;
}

/**
 * Compares GIRO singles with every pass for the rides planned over `days`
 * days and returns the cheapest way to pay. Unknown prices are treated as
 * unknown, never as free: an option with an uncovered unknown ride has a null
 * total and is never recommended over one with a known total.
 */
export function adviseTicket(rides: readonly FareRide[], table: FareTable, days = 1): TicketAdvice {
  const classes = rides.map(fareClassOf);
  const singlePrice = (c: FareClass) =>
    c === 'aerobus' ? table.aerobus.single : table.single[c].giro;

  const option = (id: string, pass: PassFare | undefined, count: number): TicketOption => {
    let total: number | null = pass ? pass.price * count : 0;
    let uncoveredRides = 0;
    for (const c of classes) {
      if (pass && covers(pass, c)) continue;
      uncoveredRides++;
      const p = singlePrice(c);
      total = total === null || p === null ? null : total + p;
    }
    return { id, pass, count, total: total === null ? null : round2(total), uncoveredRides };
  };

  const options: TicketOption[] = [option('singles', undefined, 0)];
  for (const pass of table.passes) {
    if (pass.days >= days) options.push(option(pass.id, pass, 1));
    else if (pass.days === 1) options.push(option(pass.id, pass, days));
  }

  const rank = (o: TicketOption) => (o.total === null ? Infinity : o.total);
  const best = options.reduce((a, b) => (rank(b) < rank(a) ? b : a));
  const singles = options[0]!.total;
  const saving = singles !== null && best.total !== null ? round2(singles - best.total) : 0;
  return { options, best, saving: Math.max(0, saving) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
