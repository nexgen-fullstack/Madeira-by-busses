import type { Itinerary, LatLon, Network, StopGroup } from '@madeirabus/engine';

export interface MapLine {
  coords: LatLon[];
  /** Hex colour with '#'. */
  color: string;
  dashed?: boolean;
  width?: number;
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

export function itineraryContent(net: Network, it: Itinerary): MapContent {
  const lines: MapLine[] = [];
  const points: MapPoint[] = [];
  it.legs.forEach((leg, i) => {
    if (leg.kind === 'walk') {
      lines.push({ coords: [leg.from, leg.to], color: '#5B6573', dashed: true });
      return;
    }
    const color = routeColor(net, leg.route);
    lines.push({
      coords: net.rideShape(leg.pattern, leg.boardPos, leg.alightPos),
      color,
      width: 5,
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
  if (last?.kind === 'walk')
    points.push({
      ...last.to,
      kind: 'destination',
      color: '#14181F',
      label: last.to.name || undefined,
    });
  return {
    lines,
    points,
    fitKey: `it:${it.key}:${it.depart}`,
    fit: lines.flatMap((l) => l.coords),
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

export function networkContent(net: Network): MapContent {
  const seen = new Set<number>();
  const lines: MapLine[] = [];
  net.patterns.forEach((p, i) => {
    if (seen.has(p.shape)) return;
    seen.add(p.shape);
    lines.push({ coords: net.shape(i), color: routeColor(net, p.route), width: 2.5 });
  });
  const points: MapPoint[] = net.stopGroups().map((g) => ({
    lat: g.lat,
    lon: g.lon,
    kind: 'stop',
    color: '#0B3A8E',
    label: g.name,
    stops: g.stops,
  }));
  return {
    lines,
    points,
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
