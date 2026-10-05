import type { Itinerary, LatLon, Network, StopGroup } from '@madeirabus/engine';

export interface MapLine {
  coords: LatLon[];
  /** Hex colour with '#'. */
  color: string;
  dashed?: boolean;
  width?: number;
  /** Written along the line: the number of the bus. */
  label?: string;
}

export type PointKind =
  'stop' | 'board' | 'alight' | 'transfer' | 'origin' | 'destination' | 'user' | 'bus';

export interface MapPoint extends LatLon {
  kind: PointKind;
  color?: string;
  label?: string;
  /** Stop indices this point represents (clicking opens its departures). */
  stops?: number[];
}

export interface MapContent {
  lines: MapLine[];
  points: MapPoint[];
  /** Change this to re-fit the camera. */
  fitKey?: string;
  fit?: LatLon[];
}

export const EMPTY_CONTENT: MapContent = { lines: [], points: [] };

const routeColor = (net: Network, route: number) => `#${net.routes[route]!.color}`;

/** A route on the map; `focus` brings one of its legs close up. */
export function itineraryContent(net: Network, it: Itinerary, focus?: number): MapContent {
  const lines: MapLine[] = [];
  const points: MapPoint[] = [];
  it.legs.forEach((leg, i) => {
    if (leg.kind === 'walk') {
      // Along the streets when the walking network is loaded.
      lines.push({ coords: leg.path ?? [leg.from, leg.to], color: '#0B3A8E', dashed: true });
      return;
    }
    const color = routeColor(net, leg.route);
    lines.push({
      coords: net.rideShape(leg.pattern, leg.boardPos, leg.alightPos),
      color,
      width: 5,
      label: net.routes[leg.route]!.short,
    });
    const prevRide = it.legs.slice(0, i).some((l) => l.kind === 'ride');
    const nextRide = it.legs.slice(i + 1).some((l) => l.kind === 'ride');
    points.push({
      ...leg.from,
      kind: prevRide ? 'transfer' : 'board',
      color,
      label: leg.from.name,
      stops: [leg.from.stop!],
    });
    points.push({
      ...leg.to,
      kind: nextRide ? 'transfer' : 'alight',
      color,
      label: leg.to.name,
      stops: [leg.to.stop!],
    });
    for (const s of leg.stops.slice(1, -1)) {
      const st = net.stops[s.stop]!;
      points.push({ lat: st.lat, lon: st.lon, kind: 'stop', color, stops: [s.stop] });
    }
  });
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  if (first?.kind === 'walk') points.push({ ...first.from, kind: 'origin', color: '#14181F' });
  // The red pin where the journey ends, as in a maps app (at the last stop when it ends there).
  if (last) {
    points.push({
      lat: last.to.lat,
      lon: last.to.lon,
      kind: 'destination',
      color: '#14181F',
      label: last.kind === 'walk' ? last.to.name || undefined : undefined,
    });
  }
  const leg = focus !== undefined ? lines[focus] : undefined;
  return {
    lines,
    points,
    fitKey: `it:${it.key}:${it.depart}${leg ? `:${focus}` : ''}`,
    fit: leg ? leg.coords : lines.flatMap((l) => l.coords),
  };
}

/** Where the trip starts and where it goes, before there is a route between them. */
export function placesContent(from?: MapPoint, to?: MapPoint): MapContent {
  const points: MapPoint[] = [];
  if (from) points.push({ ...from, kind: 'origin', color: '#14181F' });
  if (to) points.push({ ...to, kind: 'destination', color: '#14181F' });
  return {
    lines: [],
    points,
    fitKey: points.map((p) => `${p.kind}:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|'),
    fit: points,
  };
}

/** A line on the map: all its route variants, with one pattern drawn bolder. */
export function routeContent(net: Network, routes: number[], highlight?: number): MapContent {
  const lines: MapLine[] = [];
  const points = new Map<number, MapPoint>();
  const route = routes[0]!;
  const color = routeColor(net, route);
  net.patterns.forEach((p, i) => {
    if (!routes.includes(p.route)) return;
    lines.push({ coords: net.shape(i), color, width: i === highlight ? 6 : 4 });
    for (const s of p.stops) {
      const st = net.stops[s]!;
      points.set(s, { lat: st.lat, lon: st.lon, kind: 'stop', color, label: st.name, stops: [s] });
    }
  });
  return {
    lines,
    points: [...points.values()],
    fitKey: `route:${route}`,
    fit: lines.flatMap((l) => l.coords),
  };
}

/** Every line of the network along its roads (the stops are a map layer of their own). */
export function networkContent(net: Network): MapContent {
  const seen = new Set<number>();
  const lines: MapLine[] = [];
  net.patterns.forEach((p, i) => {
    if (seen.has(p.shape)) return;
    seen.add(p.shape);
    lines.push({ coords: net.shape(i), color: routeColor(net, p.route), width: 2.5 });
  });
  return {
    lines,
    points: [],
    fitKey: 'network',
    fit: net.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
  };
}

export function stopsContent(groups: StopGroup[], user?: LatLon, fitKey = 'stops'): MapContent {
  const points: MapPoint[] = groups.map((g) => ({
    lat: g.lat,
    lon: g.lon,
    kind: 'stop',
    color: '#0B3A8E',
    label: g.name,
    stops: g.stops,
  }));
  if (user) points.push({ ...user, kind: 'user' });
  return { lines: [], points, fitKey, fit: [...groups, ...(user ? [user] : [])] };
}

/** How close stops with the same name are to count as one place (both sides of a road, m). */
const SAME_STOP = 120;

/**
 * Every stop and line of the network as GeoJSON, for the "bus stops and
 * lines" layer. Each stop carries the stops of the same name around it, so a
 * tap shows the buses both ways.
 */
export function transitGeoJson(net: Network) {
  const seen = new Set<number>();
  const lines = net.patterns.flatMap((p, i) => {
    if (seen.has(p.shape)) return [];
    seen.add(p.shape);
    return [
      {
        type: 'Feature' as const,
        properties: { color: routeColor(net, p.route) },
        geometry: {
          type: 'LineString' as const,
          coordinates: net.shape(i).map((c) => [c.lon, c.lat]),
        },
      },
    ];
  });
  const served = new Set(net.patterns.flatMap((p) => p.stops));
  const stops = net.stops.flatMap((s, i) => {
    if (!served.has(i)) return [];
    const same = net
      .nearbyStops(s, SAME_STOP)
      .filter((h) => net.stops[h.stop]!.name === s.name)
      .map((h) => h.stop)
      .sort((a, b) => a - b);
    return [
      {
        type: 'Feature' as const,
        properties: { label: s.name, stops: (same.length > 0 ? same : [i]).join(',') },
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      },
    ];
  });
  return {
    lines: { type: 'FeatureCollection' as const, features: lines },
    stops: { type: 'FeatureCollection' as const, features: stops },
  };
}
