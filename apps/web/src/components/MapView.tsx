import { useContext, useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapContent } from '../lib/mapContent.ts';
import { MapContentContext } from './mapContext.tsx';
import { navigate } from '../lib/router.ts';

// MapLibre computes its worker URL at runtime, which bundlers cannot see; point it at the bundled worker.
setWorkerUrl(maplibreWorkerUrl);

/** Free OpenStreetMap vector basemap, no API key. Cached by the service worker for offline use. */
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';
const FALLBACK: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dde8ee' } }],
};
const MADEIRA_CENTER: [number, number] = [-16.96, 32.75];

function toGeoJson(content: MapContent) {
  return {
    lines: {
      type: 'FeatureCollection' as const,
      features: content.lines.map((l) => ({
        type: 'Feature' as const,
        properties: { color: l.color, dashed: Boolean(l.dashed), width: l.width ?? 4 },
        geometry: { type: 'LineString' as const, coordinates: l.coords.map((c) => [c.lon, c.lat]) },
      })),
    },
    points: {
      type: 'FeatureCollection' as const,
      features: content.points.map((p) => ({
        type: 'Feature' as const,
        properties: {
          kind: p.kind,
          color: p.color ?? '#0E7C66',
          label: p.label ?? '',
          stops: (p.stops ?? []).join(','),
        },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    },
  };
}

function addOverlay(map: MapLibreMap) {
  if (map.getSource('mb-lines')) return;
  const empty = { type: 'FeatureCollection' as const, features: [] };
  map.addSource('mb-lines', { type: 'geojson', data: empty });
  map.addSource('mb-points', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'mb-line-casing',
    type: 'line',
    source: 'mb-lines',
    filter: ['!', ['get', 'dashed']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['+', ['get', 'width'], 3],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'mb-line',
    type: 'line',
    source: 'mb-lines',
    filter: ['!', ['get', 'dashed']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
  });
  map.addLayer({
    id: 'mb-walk',
    type: 'line',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [0.4, 1.8] },
  });
  map.addLayer({
    id: 'mb-point',
    type: 'circle',
    source: 'mb-points',
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'user', 7, 'bus', 9, 'stop', 4.5, 6.5],
      'circle-color': [
        'match',
        ['get', 'kind'],
        'user',
        '#1E88E5',
        'bus',
        ['get', 'color'],
        'origin',
        '#14181F',
        'destination',
        '#14181F',
        '#ffffff',
      ],
      'circle-stroke-color': [
        'match',
        ['get', 'kind'],
        'user',
        '#ffffff',
        'bus',
        '#ffffff',
        'origin',
        '#ffffff',
        'destination',
        '#ffffff',
        ['get', 'color'],
      ],
      'circle-stroke-width': ['match', ['get', 'kind'], 'stop', 2, 3],
    },
  });
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'mb-label',
      type: 'symbol',
      source: 'mb-points',
      filter: ['all', ['!=', ['get', 'label'], ''], ['!=', ['get', 'kind'], 'stop']],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-max-width': 10,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#14181F', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }
}

export default function MapView({ className }: { className?: string }) {
  const { content } = useContext(MapContentContext);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const contentRef = useRef(content);
  const fittedKey = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  contentRef.current = content;

  useEffect(() => {
    if (!container.current) return;
    let fellBack = false;
    const map = new MapLibreMap({
      container: container.current,
      style: BASEMAP,
      center: MADEIRA_CENTER,
      zoom: 9.2,
      maxBounds: [
        [-18.2, 32.0],
        [-15.6, 33.5],
      ],
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    const fallback = () => {
      if (fellBack || map.isStyleLoaded()) return;
      fellBack = true;
      map.setStyle(FALLBACK);
    };
    // Offline or tiles blocked: keep our overlay on a plain background.
    const timer = window.setTimeout(fallback, 8000);
    map.on('error', () => {
      if (!map.isStyleLoaded()) fallback();
    });
    map.on('style.load', () => {
      window.clearTimeout(timer);
      addOverlay(map);
      fittedKey.current = undefined;
      setReady(true);
      apply(map, contentRef.current, fittedKey);
    });
    map.on('click', 'mb-point', (e: MapLayerMouseEvent) => {
      const stops = String(e.features?.[0]?.properties?.stops ?? '');
      if (stops) navigate('stop', { ids: stops });
    });
    map.on('mouseenter', 'mb-point', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'mb-point', () => (map.getCanvas().style.cursor = ''));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && map.getSource('mb-lines')) apply(map, content, fittedKey);
  }, [content, ready]);

  return <div ref={container} className={className} role="region" aria-label="Map" />;
}

function apply(map: MapLibreMap, content: MapContent, fittedKey: { current: string | undefined }) {
  const data = toGeoJson(content);
  (map.getSource('mb-lines') as GeoJSONSource | undefined)?.setData(data.lines);
  (map.getSource('mb-points') as GeoJSONSource | undefined)?.setData(data.points);
  if (
    content.fitKey &&
    content.fitKey !== fittedKey.current &&
    content.fit &&
    content.fit.length > 0
  ) {
    fittedKey.current = content.fitKey;
    const bounds = new LngLatBounds();
    for (const c of content.fit) bounds.extend([c.lon, c.lat]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 15.5, duration: 600 });
  }
}
