import {
  directConnections,
  haversine,
  type Connection,
  type LatLon,
  type Network,
} from '@madeirabus/engine';

/**
 * Places with beautiful views that people reach by bus, for the "Scenic"
 * tab, region by region. Names are the Portuguese ones on signs and stops; the
 * short and long descriptions are translated (`scenic.<id>.tag`,
 * `scenic.<id>.text`). Whether a place can be reached is read from the loaded
 * timetable, so the places outside Funchal light up as soon as their operators'
 * timetables arrive (and already do in the demo network).
 *
 * A photo is added by putting `<id>.webp` (960 px wide, 3:2) and `<id>-sm.webp`
 * (480 px) in public/photos/ and its `credit` here; a place without one shows its
 * name on the colours of its region.
 */

export interface PhotoCredit {
  author: string;
  license: string;
  licenseUrl: string;
  /** The photo's page on Wikimedia Commons. */
  source: string;
}

/** Where on the island: the regions the tab lists the places by. */
export type Region = 'funchal' | 'mountains' | 'west' | 'north' | 'east';

export const REGIONS: readonly Region[] = ['funchal', 'mountains', 'west', 'north', 'east'];

/** The words for a region. */
export const regionKey = (r: Region) => `scenic.region.${r}` as const;

export interface Destination {
  /** Also the name of its photos in public/photos/. */
  id: DestinationId;
  name: string;
  region: Region;
  /** Where a trip there ends: the stop or viewpoint. */
  lat: number;
  lon: number;
  /**
   * How far from it its bus stops may be (m; 600 when not given): the lighthouse of Ponta
   * do Pargo is a walk of half an hour from the village's buses.
   */
  reach?: number;
  /** Its photo's author and licence; none yet: no photo. */
  credit?: PhotoCredit;
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
  | 'balcoes'
  | 'pinaculo'
  | 'encumeada'
  | 'ribeira-brava'
  | 'ponta-do-sol'
  | 'calheta'
  | 'jardim-do-mar'
  | 'paul-do-mar'
  | 'ponta-do-pargo'
  | 'achadas-da-cruz'
  | 'ribeira-da-janela'
  | 'seixal'
  | 'veu-da-noiva'
  | 'sao-vicente'
  | 'ponta-delgada'
  | 'arco-sao-jorge'
  | 'sao-jorge'
  | 'guindaste'
  | 'porto-da-cruz'
  | 'portela'
  | 'machico'
  | 'prainha'
  | 'cristo-rei'
  | 'canico-de-baixo'
  | 'camacha';

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
    region: 'mountains',
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
    region: 'mountains',
    lat: 32.71066,
    lon: -16.96188,
    credit: { author: 'Luís Campanário', ...BY_SA_4, source: commons('Eira_do_Serrado.jpg') },
  },
  {
    id: 'monte',
    name: 'Monte',
    region: 'funchal',
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
    region: 'funchal',
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
    region: 'funchal',
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
    region: 'funchal',
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
    region: 'funchal',
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
    region: 'funchal',
    lat: 32.64732,
    lon: -16.90284,
    credit: { author: 'Ввласенко', ...BY_SA_3, source: commons('Funchal_Cable_Car_Madeira.jpg') },
  },
  {
    id: 'cabo-girao',
    name: 'Cabo Girão',
    region: 'west',
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
    region: 'west',
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
    region: 'north',
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
    region: 'north',
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
    region: 'east',
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
    region: 'mountains',
    lat: 32.7349,
    lon: -16.8869,
    credit: {
      author: 'Ricardo Martins',
      ...BY_SA_4,
      source: commons('Floresta_Laurissilva,_Miradouro_dos_Balc%C3%B5es,_Ribeiro_Frio.jpg'),
    },
  },
  // No photos of these yet.
  {
    id: 'pinaculo',
    name: 'Miradouro do Pináculo',
    region: 'funchal',
    lat: 32.6453,
    lon: -16.8706,
  },
  {
    id: 'encumeada',
    name: 'Boca da Encumeada',
    region: 'mountains',
    lat: 32.75456,
    lon: -17.01952,
  },
  {
    id: 'ribeira-brava',
    name: 'Ribeira Brava',
    region: 'west',
    lat: 32.67148,
    lon: -17.06744,
  },
  {
    id: 'ponta-do-sol',
    name: 'Ponta do Sol',
    region: 'west',
    lat: 32.6795,
    lon: -17.10528,
  },
  {
    id: 'calheta',
    name: 'Calheta',
    region: 'west',
    lat: 32.71868,
    lon: -17.17428,
  },
  {
    id: 'jardim-do-mar',
    name: 'Jardim do Mar',
    region: 'west',
    lat: 32.7369,
    lon: -17.209,
  },
  {
    id: 'paul-do-mar',
    name: 'Paul do Mar',
    region: 'west',
    lat: 32.7569,
    lon: -17.2272,
  },
  {
    id: 'ponta-do-pargo',
    name: 'Farol da Ponta do Pargo',
    region: 'west',
    lat: 32.81393,
    lon: -17.26307,
    reach: 2000,
  },
  {
    id: 'achadas-da-cruz',
    name: 'Teleférico das Achadas da Cruz',
    region: 'west',
    lat: 32.85284,
    lon: -17.2098,
    reach: 1600,
  },
  {
    id: 'ribeira-da-janela',
    name: 'Ilhéus da Ribeira da Janela',
    region: 'north',
    lat: 32.85529,
    lon: -17.1531,
  },
  {
    id: 'seixal',
    name: 'Seixal',
    region: 'north',
    lat: 32.8237,
    lon: -17.1043,
  },
  {
    id: 'veu-da-noiva',
    name: 'Miradouro do Véu da Noiva',
    region: 'north',
    lat: 32.81608,
    lon: -17.09514,
    reach: 1600,
  },
  {
    id: 'sao-vicente',
    name: 'São Vicente',
    region: 'north',
    lat: 32.80228,
    lon: -17.04724,
  },
  {
    id: 'ponta-delgada',
    name: 'Ponta Delgada',
    region: 'north',
    lat: 32.827,
    lon: -16.9862,
  },
  {
    id: 'arco-sao-jorge',
    name: 'Arco de São Jorge',
    region: 'north',
    lat: 32.82888,
    lon: -16.95457,
  },
  {
    id: 'sao-jorge',
    name: 'Farol de São Jorge',
    region: 'north',
    lat: 32.83455,
    lon: -16.9062,
  },
  {
    id: 'guindaste',
    name: 'Miradouro do Guindaste',
    region: 'north',
    lat: 32.79425,
    lon: -16.84936,
  },
  {
    id: 'porto-da-cruz',
    name: 'Porto da Cruz',
    region: 'north',
    lat: 32.7734,
    lon: -16.8276,
  },
  {
    id: 'portela',
    name: 'Miradouro da Portela',
    region: 'east',
    lat: 32.74675,
    lon: -16.82657,
  },
  {
    id: 'machico',
    name: 'Machico',
    region: 'east',
    lat: 32.718,
    lon: -16.7662,
  },
  {
    id: 'prainha',
    name: 'Prainha do Caniçal',
    region: 'east',
    lat: 32.74282,
    lon: -16.71572,
  },
  {
    id: 'cristo-rei',
    name: 'Cristo Rei do Garajau',
    region: 'east',
    lat: 32.63872,
    lon: -16.85086,
  },
  {
    id: 'canico-de-baixo',
    name: 'Caniço de Baixo',
    region: 'east',
    lat: 32.64605,
    lon: -16.82439,
  },
  {
    id: 'camacha',
    name: 'Camacha',
    region: 'east',
    lat: 32.6795,
    lon: -16.8453,
  },
];

export const destination = (id: string | undefined) => DESTINATIONS.find((d) => d.id === id);

/** A place's photo, small or large; none for a place without one yet. */
export const photo = (d: Destination, size: 'sm' | 'lg') =>
  d.credit
    ? `${import.meta.env.BASE_URL}photos/${d.id}${size === 'sm' ? '-sm' : ''}.webp`
    : undefined;

/** The places of each region, in the order of REGIONS (regions with none left out). */
export function byRegion<T extends { region: Region }>(places: readonly T[]): [Region, T[]][] {
  return REGIONS.map((r) => [r, places.filter((d) => d.region === r)] as [Region, T[]]).filter(
    ([, list]) => list.length > 0,
  );
}

/** Avenida do Mar, where most lines of Funchal start. */
export const CENTRE: LatLon = { lat: 32.6478, lon: -16.9075 };

/** Stops of central Funchal, between the market, the cathedral and the marina. */
export function centreStops(net: Network): number[] {
  return net
    .nearbyStops(CENTRE, 550)
    .sort((a, b) => a.distance - b.distance)
    .map((h) => h.stop);
}

/** How far from a place its bus stops may be (m). */
const REACH = 600;

/**
 * The stops of a destination: the nearest one and those barely further (the
 * other side of the road, the next bay), at most a short walk away (or as far
 * as the place says). Central stops belong to the centre.
 */
export function destinationStops(net: Network, d: LatLon & { reach?: number }): number[] {
  const centre = new Set(centreStops(net));
  const hits = net
    .nearbyStops(d, d.reach ?? REACH)
    .filter((h) => !centre.has(h.stop))
    .sort((a, b) => a.distance - b.distance);
  const limit = (hits[0]?.distance ?? 0) + 200;
  return hits.filter((h) => h.distance <= limit).map((h) => h.stop);
}

/** One end of a walk: a place people know, where the walk starts or ends. */
export interface Spot extends LatLon {
  name: string;
}

/** A walk along the sea worth taking instead of a bus: up to 35 minutes, mostly with a view. */
export interface ScenicWalk {
  region: Region;
  from: Spot;
  to: Spot;
}

const spot = (name: string, lat: number, lon: number): Spot => ({ name, lat, lon });

/**
 * The walks along the sea all round the island that the planner offers as walks with a view
 * (`isScenicWalk`): promenades and seafront ways, each checked with the walking network to
 * be no longer than 35 minutes, mostly by the sea, neither steep nor roundabout.
 */
export const SCENIC_WALKS: readonly ScenicWalk[] = [
  {
    region: 'funchal',
    from: spot('Marina do Funchal', 32.6457, -16.9095),
    to: spot('Forte de São Tiago', 32.64673, -16.89859),
  },
  {
    region: 'funchal',
    from: spot('Marina do Funchal', 32.6457, -16.9095),
    to: spot('Pontinha', 32.64126, -16.91771),
  },
  {
    region: 'funchal',
    from: spot('Lido', 32.63641, -16.93139),
    to: spot('Doca do Cavacas', 32.63582, -16.9478),
  },
  {
    region: 'west',
    from: spot('Praia do Arieiro', 32.64284, -16.95915),
    to: spot('Câmara de Lobos', 32.6489, -16.9773),
  },
  {
    region: 'west',
    from: spot('Ribeira Brava', 32.67321, -17.06431),
    to: spot('Tabua', 32.68003, -17.07794),
  },
  {
    region: 'west',
    from: spot('Calheta', 32.7216, -17.1781),
    to: spot('Praia da Calheta', 32.71868, -17.17428),
  },
  {
    region: 'west',
    from: spot('Jardim do Mar', 32.73979, -17.2126),
    to: spot('Praia do Portinho', 32.73493, -17.20834),
  },
  {
    region: 'north',
    from: spot('Porto Moniz', 32.86776, -17.16598),
    to: spot('Calhau', 32.86651, -17.17593),
  },
  {
    region: 'north',
    from: spot('Seixal', 32.82495, -17.10723),
    to: spot('Praia das Lajes', 32.82661, -17.11404),
  },
  {
    region: 'north',
    from: spot('São Vicente', 32.80861, -17.04847),
    to: spot('Fajã do Rente', 32.80988, -17.05988),
  },
  {
    region: 'north',
    from: spot('Porto da Cruz', 32.77495, -16.82896),
    to: spot('Praia da Maiata', 32.76819, -16.82161),
  },
  {
    region: 'east',
    from: spot('Machico', 32.71889, -16.76547),
    to: spot('Matur', 32.70789, -16.76385),
  },
  {
    region: 'east',
    from: spot('Santa Cruz', 32.68748, -16.79121),
    to: spot('Pista do aeroporto', 32.69158, -16.78389),
  },
  {
    region: 'east',
    from: spot('Caniço de Baixo', 32.6416, -16.8331),
    to: spot('Reis Magos', 32.64605, -16.82439),
  },
];

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
    ? net.nearbyStops(d, REACH).length > 0
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
