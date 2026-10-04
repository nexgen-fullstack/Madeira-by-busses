import {
  directConnections,
  haversine,
  type Connection,
  type LatLon,
  type Network,
} from '@madeirabus/engine';

/**
 * Places with beautiful views that people reach by bus, for the "Scenic"
 * tab. Names are the Portuguese ones on signs and stops; the short and long
 * descriptions are translated (`scenic.<id>.tag`, `scenic.<id>.text`).
 * Whether a place can be reached is read from the loaded timetable, so the
 * places outside Funchal light up as soon as their operators' timetables
 * arrive (and already do in the demo network).
 */

export interface PhotoCredit {
  author: string;
  license: string;
  licenseUrl: string;
  /** The photo's page on Wikimedia Commons. */
  source: string;
}

export interface Destination {
  /** Also the name of its photos in public/photos/. */
  id: DestinationId;
  name: string;
  /** Where a trip there ends: the stop or viewpoint. */
  lat: number;
  lon: number;
  credit: PhotoCredit;
}

export type DestinationId =
  | 'curral'
  | 'eira'
  | 'monte'
  | 'botanico'
  | 'palheiro'
  | 'barcelos'
  | 'formosa'
  | 'cidade'
  | 'cabo-girao'
  | 'camara-lobos'
  | 'porto-moniz'
  | 'santana'
  | 'sao-lourenco'
  | 'balcoes';

const BY_SA_4 = {
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
};
const BY_SA_3 = {
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
};
const BY_2 = { license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0' };
const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const DESTINATIONS: readonly Destination[] = [
  {
    id: 'curral',
    name: 'Curral das Freiras',
    lat: 32.72033,
    lon: -16.96543,
    credit: {
      author: 'Diego Delso',
      ...BY_SA_4,
      source: commons('Vista_de_Curral_das_Freiras,_Madeira,_Portugal,_2019-05-30,_DD_100.jpg'),
    },
  },
  {
    id: 'eira',
    name: 'Eira do Serrado',
    lat: 32.71066,
    lon: -16.96188,
    credit: { author: 'Luís Campanário', ...BY_SA_4, source: commons('Eira_do_Serrado.jpg') },
  },
  {
    id: 'monte',
    name: 'Monte',
    lat: 32.67666,
    lon: -16.90374,
    credit: {
      author: 'H. Zell',
      ...BY_SA_3,
      source: commons('Monte_Palace_Tropical_Garden_-_Oriental_Gardens_08.jpg'),
    },
  },
  {
    id: 'botanico',
    name: 'Jardim Botânico',
    lat: 32.66225,
    lon: -16.89404,
    credit: {
      author: 'Dietmar Rabich',
      ...BY_SA_4,
      source: commons(
        'Santa_Maria_Maior_(Madeira,_Portugal),_Jardim_Bot%C3%A2nico_da_Madeira,_Choreographierter_Garten_--_2025_--_1870.jpg',
      ),
    },
  },
  {
    id: 'palheiro',
    name: 'Jardins do Palheiro',
    lat: 32.66306,
    lon: -16.8685,
    credit: {
      author: 'muffinn',
      ...BY_2,
      source: commons('Madeira_-_Funchal_-_Quinta_do_Palheiro_Ferreiro_(33207445590).jpg'),
    },
  },
  {
    id: 'barcelos',
    name: 'Pico dos Barcelos',
    lat: 32.65905,
    lon: -16.94128,
    credit: {
      author: 'Diego Delso',
      ...BY_SA_4,
      source: commons(
        'Vista_de_Funchal_desde_Pico_dos_Barcelos,_Madeira,_Portugal,_2019-05-29,_DD_45.jpg',
      ),
    },
  },
  {
    id: 'formosa',
    name: 'Praia Formosa',
    lat: 32.64274,
    lon: -16.95066,
    credit: {
      author: 'Bex Walton',
      ...BY_2,
      source: commons('Doca_do_Cavacas_pools_at_Praia_Formosa,_Madeira_(52893163810).jpg'),
    },
  },
  {
    id: 'cidade',
    name: 'Zona Velha',
    lat: 32.64732,
    lon: -16.90284,
    credit: { author: 'Ввласенко', ...BY_SA_3, source: commons('Funchal_Cable_Car_Madeira.jpg') },
  },
  {
    id: 'cabo-girao',
    name: 'Cabo Girão',
    lat: 32.656,
    lon: -17.0047,
    credit: {
      author: 'H. Zell',
      ...BY_SA_3,
      source: commons('View_from_Miradouro_do_Cabo_Gir%C3%A3o_02.jpg'),
    },
  },
  {
    id: 'camara-lobos',
    name: 'Câmara de Lobos',
    lat: 32.6489,
    lon: -16.9773,
    credit: {
      author: 'Dietmar Rabich',
      ...BY_SA_4,
      source: commons('C%C3%A2mara_de_Lobos_(Madeira,_Portugal),_Ortsansicht_--_2025_--_1882.jpg'),
    },
  },
  {
    id: 'porto-moniz',
    name: 'Porto Moniz',
    lat: 32.8667,
    lon: -17.1697,
    credit: {
      author: 'Holger Uwe Schmitt',
      ...BY_SA_4,
      source: commons('Naturschwimmbecken_zwischen_Lavafelsen_in_Porto_Moniz,_Madeira._10.jpg'),
    },
  },
  {
    id: 'santana',
    name: 'Santana',
    lat: 32.8058,
    lon: -16.882,
    credit: {
      author: 'H. Zell',
      ...BY_SA_3,
      source: commons('Traditional_farmhouse_-_Santana_06.jpg'),
    },
  },
  {
    id: 'sao-lourenco',
    name: 'Ponta de São Lourenço',
    lat: 32.7432,
    lon: -16.7068,
    credit: {
      author: 'Diego Delso',
      ...BY_SA_4,
      source: commons('Ponta_de_S%C3%A3o_Louren%C3%A7o,_Madeira,_Portugal,_2019-05-28,_DD_31.jpg'),
    },
  },
  {
    id: 'balcoes',
    name: 'Balcões',
    lat: 32.7349,
    lon: -16.8869,
    credit: {
      author: 'Ricardo Martins',
      ...BY_SA_4,
      source: commons('Floresta_Laurissilva,_Miradouro_dos_Balc%C3%B5es,_Ribeiro_Frio.jpg'),
    },
  },
];

export const destination = (id: string | undefined) => DESTINATIONS.find((d) => d.id === id);

export const photo = (d: Destination, size: 'sm' | 'lg') =>
  `${import.meta.env.BASE_URL}photos/${d.id}${size === 'sm' ? '-sm' : ''}.webp`;

/** Avenida do Mar, where most lines of Funchal start. */
export const CENTRE: LatLon = { lat: 32.6478, lon: -16.9075 };

/** Stops of central Funchal, between the market, the cathedral and the marina. */
export function centreStops(net: Network): number[] {
  return net
    .nearbyStops(CENTRE, 550)
    .sort((a, b) => a.distance - b.distance)
    .map((h) => h.stop);
}

/**
 * The stops of a destination: the nearest one and those barely further (the
 * other side of the road, the next bay), at most a short walk away. Central
 * stops belong to the centre.
 */
export function destinationStops(net: Network, d: LatLon): number[] {
  const centre = new Set(centreStops(net));
  const hits = net
    .nearbyStops(d, 600)
    .filter((h) => !centre.has(h.stop))
    .sort((a, b) => a.distance - b.distance);
  const limit = (hits[0]?.distance ?? 0) + 200;
  return hits.filter((h) => h.distance <= limit).map((h) => h.stop);
}

/**
 * Minutes on foot from the centre for places in it (the Old Town is a short
 * walk from Avenida do Mar), undefined for places a bus ride away.
 */
export function walkFromCentre(d: LatLon): number | undefined {
  const m = haversine(CENTRE, d);
  // Streets wind: about a third longer than the straight line, at 4.5 km/h.
  return m < 1200 ? Math.max(1, Math.round((m * 1.35) / 75)) : undefined;
}

/** Whether the loaded timetable has buses to the place. */
export const reachable = (net: Network, d: Destination) =>
  walkFromCentre(d) !== undefined
    ? net.nearbyStops(d, 600).length > 0
    : destinationStops(net, d).length > 0;

/** One line's buses between the centre and a destination. */
export interface LineTrips {
  route: number;
  /** Where most of its buses are boarded and left. */
  from: number;
  to: number;
  trips: Connection[];
}

/** The day's direct buses from `from` stops to `to` stops, line by line, busiest first. */
export function tripsByLine(
  net: Network,
  from: readonly number[],
  to: readonly number[],
  date: string,
  pick: 'first' | 'listed' = 'first',
): LineTrips[] {
  const lines = new Map<string, LineTrips>();
  for (const c of directConnections(net, from, to, date, { pick })) {
    const r = net.routes[c.route]!;
    const key = `${r.agency}|${r.short}`;
    const line = lines.get(key) ?? { route: c.route, from: c.from, to: c.to, trips: [] };
    line.trips.push(c);
    lines.set(key, line);
  }
  const mostCommon = (stops: number[]) => {
    const n = new Map<number, number>();
    for (const s of stops) n.set(s, (n.get(s) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  };
  return [...lines.values()]
    .map((l) => ({
      ...l,
      from: mostCommon(l.trips.map((c) => c.from)),
      to: mostCommon(l.trips.map((c) => c.to)),
    }))
    .sort((a, b) => b.trips.length - a.trips.length);
}

/** What a destination card says about getting there today. */
export interface Outlook {
  /** Minutes on foot from the centre, for places in it. */
  walk?: number;
  /** Lines with direct buses from the centre, busiest first. */
  routes: number[];
  /** Typical ride from the centre, in minutes. */
  minutes?: number;
  first?: number;
  last?: number;
  lastBack?: number;
}

export function outlook(net: Network, d: Destination, date: string): Outlook {
  const walk = walkFromCentre(d);
  if (walk !== undefined) return { walk, routes: [] };
  const centre = centreStops(net);
  const stops = destinationStops(net, d);
  const there = tripsByLine(net, centre, stops, date);
  const back = tripsByLine(net, stops, centre, date, 'listed');
  const trips = there.flatMap((l) => l.trips).sort((a, b) => a.depart - b.depart);
  const rides = trips.map((c) => c.arrive - c.depart).sort((a, b) => a - b);
  const backTrips = back.flatMap((l) => l.trips);
  return {
    routes: there.map((l) => l.route),
    minutes: rides.length ? Math.round(rides[Math.floor(rides.length / 2)]! / 60) : undefined,
    first: trips[0]?.depart,
    last: trips[trips.length - 1]?.depart,
    lastBack: backTrips.length ? Math.max(...backTrips.map((c) => c.depart)) : undefined,
  };
}
