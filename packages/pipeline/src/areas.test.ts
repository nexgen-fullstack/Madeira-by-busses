import { describe, expect, it } from 'vitest';
import {
  buildBundle,
  Network,
  parseGtfs,
  SIGA_FARES_2026,
  toCsv,
  type BPlace,
  type LatLon,
} from '@madeirabus/engine';
import {
  addPlaceGoals,
  anchorsFromOsm,
  areasFromOsm,
  decodeAreas,
  busesPerStop,
  encodeAreas,
  inArea,
  joinRings,
  placeGoal,
  type Anchor,
  type Area,
  type OsmShape,
} from './areas.ts';

/** A square of `size` degrees with its south-west corner at (lat, lon). */
const square = (lat: number, lon: number, size: number): LatLon[] => [
  { lat, lon },
  { lat, lon: lon + size },
  { lat: lat + size, lon: lon + size },
  { lat: lat + size, lon },
  { lat, lon },
];

describe('bounds from OpenStreetMap', () => {
  it('joins a relation’s ways into its rings, in whatever order and direction', () => {
    const [a, b, c, d] = square(32.6, -17.1, 0.02);
    const rings = joinRings([
      [c!, d!],
      [a!, b!],
      [c!, b!],
      [d!, a!],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });

  it('reads parishes, town areas and their holes, and churches, town halls and squares', () => {
    const outer = square(32.6, -17.1, 0.02);
    const inner = square(32.605, -17.095, 0.005);
    const elements: OsmShape[] = [
      {
        type: 'relation',
        id: 1,
        tags: { boundary: 'administrative', admin_level: '8', name: 'Tabua' },
        members: [
          { type: 'way', ref: 1, role: 'outer', geometry: outer.slice(0, 3) },
          { type: 'way', ref: 2, role: 'outer', geometry: outer.slice(2) },
          { type: 'way', ref: 3, role: 'inner', geometry: inner },
        ],
      },
      { type: 'way', id: 2, tags: { place: 'town', name: 'Santa Cruz' }, geometry: outer },
      { type: 'way', id: 3, tags: { highway: 'primary', name: 'ER101' }, geometry: outer },
    ];
    const areas = areasFromOsm(elements);
    expect(areas.map((x) => [x.name, x.level, x.place])).toEqual([
      ['Tabua', 8, undefined],
      ['Santa Cruz', undefined, 'town'],
    ]);
    expect(inArea({ lat: 32.601, lon: -17.099 }, areas[0]!)).toBe(true);
    // In the hole, and outside.
    expect(inArea({ lat: 32.607, lon: -17.093 }, areas[0]!)).toBe(false);
    expect(inArea({ lat: 32.63, lon: -17.099 }, areas[0]!)).toBe(false);
    const anchors = anchorsFromOsm([
      {
        type: 'node',
        id: 4,
        lat: 32.61,
        lon: -17.09,
        tags: { amenity: 'place_of_worship', name: 'Igreja' },
      },
      {
        type: 'way',
        id: 5,
        center: { lat: 32.61, lon: -17.08 },
        tags: { place: 'square', name: 'Largo' },
      },
      { type: 'node', id: 6, lat: 32.61, lon: -17.07, tags: { amenity: 'cafe', name: 'Café' } },
    ]);
    expect(anchors.map((x) => x.kind)).toEqual(['church', 'square']);
    // Kept as a file and read back the same.
    const back = decodeAreas(JSON.parse(JSON.stringify(encodeAreas(areas, anchors))));
    expect(back.areas[0]!.holes).toHaveLength(1);
    expect(back.anchors).toEqual(anchors);
  });
});

/**
 * Tabua and Ribeira Brava side by side, as on the island: Ribeira Brava's bus station
 * just across Tabua's bounds, nearer Tabua's point than Tabua's own stops are; Tabua's
 * stop on the main road with more buses than the one by its church.
 */
function twoTowns() {
  const stops: [string, string, number, number][] = [
    ['RB', 'Estacao Ribeira Brava', 32.6732, -17.0643],
    ['T1', 'Reta Tabua', 32.6801, -17.0781],
    ['T2', 'Igreja Tabua', 32.684, -17.083],
    ['T3', 'Fim da Linha, Tabua', 32.6802, -17.0782],
  ];
  const trips: string[][] = [];
  const times: (string | number)[][] = [];
  const add = (route: string, n: number, way: string[]) => {
    for (let i = 0; i < n; i++) {
      const id = `${route}-${i}`;
      trips.push([route, 'WK', id]);
      way.forEach((s, k) => {
        const t = `${String(7 + i).padStart(2, '0')}:${String(10 * k).padStart(2, '0')}:00`;
        times.push([id, t, t, s, k + 1]);
      });
    }
  };
  add('322', 8, ['RB', 'T1', 'T3']);
  add('336', 4, ['RB', 'T2']);
  const feed = parseGtfs({
    'agency.txt': toCsv(
      ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
      [['R', 'Rodoeste', 'https://example.com', 'Atlantic/Madeira']],
    ),
    'stops.txt': toCsv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], stops),
    'routes.txt': toCsv(
      ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      [
        ['322', 'R', '322', 'Ribeira Brava - Tabua', 3],
        ['336', 'R', '336', 'Ribeira Brava - Igreja Tabua', 3],
      ],
    ),
    'trips.txt': toCsv(['route_id', 'service_id', 'trip_id'], trips),
    'stop_times.txt': toCsv(
      ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
      times,
    ),
    'calendar.txt': toCsv(
      [
        'service_id',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'start_date',
        'end_date',
      ],
      [['WK', 1, 1, 1, 1, 1, 0, 0, '20260101', '20271231']],
    ),
  });
  const { bundle } = buildBundle([{ feed, source: { name: 'test' } }], {
    demo: false,
    fares: SIGA_FARES_2026,
    generatedAt: '2026-10-01T00:00:00Z',
  });
  const tabua: Area = {
    name: 'Tabua',
    level: 8,
    rings: [square(32.675, -17.095, 0.02)],
    holes: [],
  };
  const ribeiraBrava: Area = {
    name: 'Ribeira Brava',
    level: 8,
    rings: [square(32.665, -17.075, 0.02)],
    holes: [],
  };
  return { bundle, net: new Network(bundle), areas: [tabua, ribeiraBrava] };
}

const WEDNESDAY = '2026-10-07';

describe('where a trip to a town or village goes', () => {
  const { bundle, net, areas } = twoTowns();
  const buses = busesPerStop(net, WEDNESDAY);
  const place = (name: string, lat: number, lon: number): BPlace => ({
    name,
    lat,
    lon,
    kind: 'village',
  });

  it('is its own bus station, never the next town’s', () => {
    const rb = placeGoal(net, place('Ribeira Brava', 32.6701, -17.065), areas, [], buses);
    expect(rb.goal).toMatchObject({ via: 'station', name: 'Estacao Ribeira Brava' });
    // Tabua's point is 1.4 km from Ribeira Brava's station, which is outside its bounds.
    const tabua = placeGoal(net, place('Tabua', 32.6801, -17.078), areas, [], buses);
    expect(tabua.goal).toMatchObject({ via: 'stop', name: 'Reta Tabua' });
  });

  it('is the stop near its middle with the most buses', () => {
    // The church's is the 336's last stop: buses that end there count too.
    expect(buses[net.stops.findIndex((s) => s.id === 'T2')]).toBe(4);
    const tabua = placeGoal(net, place('Tabua', 32.684, -17.083), areas, [], buses);
    // By the church (4 buses) rather than on the main road (8 buses, 630 m away).
    expect(tabua.goal).toMatchObject({ via: 'stop', name: 'Igreja Tabua' });
  });

  it('is its church, town hall or square when no bus stops in it, else its bounds', () => {
    const empty: Area = { name: 'Serra', level: 8, rings: [square(32.7, -17.05, 0.01)], holes: [] };
    const anchors: Anchor[] = [
      { name: 'Junta de Freguesia da Serra', kind: 'townhall', lat: 32.705, lon: -17.045 },
      { name: 'Igreja da Serra', kind: 'church', lat: 32.706, lon: -17.044 },
      { name: 'Capela de Fora', kind: 'church', lat: 32.75, lon: -17.044 },
    ];
    const serra = place('Serra', 32.705, -17.045);
    expect(placeGoal(net, serra, [empty], anchors, buses).goal).toMatchObject({
      via: 'church',
      name: 'Igreja da Serra',
    });
    expect(placeGoal(net, serra, [empty], [], buses)).toEqual({ area: empty });
  });

  it('goes into the bundle', () => {
    bundle.places = [
      place('Tabua', 32.6801, -17.078),
      { ...place('Lido', 32.63, -16.93), kind: 'beach' },
    ];
    const counts = addPlaceGoals(bundle, encodeAreas(areas, []), WEDNESDAY);
    expect(bundle.places[0]!.goal).toEqual([32.6801, -17.0781, 'stop']);
    expect(bundle.places[1]!.goal).toBeUndefined();
    expect(counts.goals.stop).toBe(1);
  });
});
