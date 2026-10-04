import { useContext, useEffect, useRef, useState } from 'react';
import { Flag, MapPin, X } from 'lucide-react';
import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useI18n } from '../i18n.ts';
import { encodePlace } from '../lib/itinerary.ts';
import type { MapContent } from '../lib/mapContent.ts';
import {
  buildingLayers,
  demSource,
  extrusionLayer,
  fallbackStyle,
  loadStyle,
  placeLayerIds,
  poiLabel,
  type MapLayers,
} from '../lib/mapStyles.ts';
import { navigate } from '../lib/router.ts';
import { useApp } from '../state/app.tsx';
import { LayerSwitcher } from './LayerSwitcher.tsx';
import { MapContentContext } from './mapContext.tsx';

// MapLibre computes its worker URL at runtime, which bundlers cannot see; point it at the bundled worker.
setWorkerUrl(maplibreWorkerUrl);

const MADEIRA_CENTER: [number, number] = [-16.96, 32.75];

interface PickedPlace {
  name: string;
  /** OpenMapTiles POI class / subclass, labelled at render time in the current language. */
  klass?: string;
  subclass?: string;
  lat: number;
  lon: number;
}

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
          color: p.color ?? '#0B3A8E',
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
  const { settings, setSettings } = useApp();
  const t = useI18n();
  const layers = settings.map;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const contentRef = useRef(content);
  const layersRef = useRef(layers);
  const fittedKey = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const styleLoaded = useRef(false);
  const shownStyle = useRef(`${layers.base}:fallback`);
  const [picked, setPicked] = useState<PickedPlace | undefined>();
  contentRef.current = content;
  layersRef.current = layers;

  // Create the map once; start with the tile-free style so the island shows at once.
  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: fallbackStyle(layersRef.current.base),
      center: MADEIRA_CENTER,
      zoom: 9.2,
      maxPitch: 70,
      maxBounds: [
        [-18.2, 32.0],
        [-15.6, 33.5],
      ],
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    );
    map.addControl(new ScaleControl({ maxWidth: 90 }), 'bottom-right');
    map.on('style.load', () => {
      styleLoaded.current = true;
      addOverlay(map);
      applyDetails(map, layersRef.current);
      fittedKey.current = undefined;
      setReady(true);
      apply(map, contentRef.current, fittedKey);
    });
    map.on('click', (e: MapMouseEvent) => {
      const box: [[number, number], [number, number]] = [
        [e.point.x - 8, e.point.y - 8],
        [e.point.x + 8, e.point.y + 8],
      ];
      const features = map.queryRenderedFeatures(box);
      const stop = features.find((f) => f.layer.id === 'mb-point' && f.properties?.stops);
      if (stop) {
        navigate('stop', { ids: String(stop.properties.stops) });
        return;
      }
      const poi = features.find((f) => f.sourceLayer === 'poi' && f.properties?.name);
      if (poi && poi.geometry.type === 'Point') {
        const [lon, lat] = poi.geometry.coordinates as [number, number];
        setPicked({
          name: String(poi.properties.name),
          klass: poi.properties.class as string | undefined,
          subclass: poi.properties.subclass as string | undefined,
          lat,
          lon,
        });
        return;
      }
      setPicked(undefined);
    });
    // Long press / right click drops a pin anywhere.
    map.on('contextmenu', (e: MapMouseEvent) => {
      setPicked({ name: '', lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    map.on('mouseenter', 'mb-point', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'mb-point', () => (map.getCanvas().style.cursor = ''));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Base layer: fetch the vector style (if reachable) and swap it in.
  useEffect(() => {
    let cancelled = false;
    loadStyle(layers.base).then(({ style, vector }) => {
      const map = mapRef.current;
      if (cancelled || !map) return;
      // The tile-free fallback for this base may already be on screen.
      const key = `${layers.base}:${vector ? 'vector' : 'fallback'}`;
      if (key === shownStyle.current) return;
      shownStyle.current = key;
      styleLoaded.current = false;
      map.setStyle(style as StyleSpecification, { diff: false });
    });
    return () => {
      cancelled = true;
    };
  }, [layers.base]);

  // Overlays toggle in place.
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && styleLoaded.current) applyDetails(map, layers);
  }, [layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && map.getSource('mb-lines')) apply(map, content, fittedKey);
  }, [content, ready]);

  const pickedLabel = picked?.name || t.t('place.pin');
  return (
    <div className={`${className ?? ''} map-wrap`}>
      <div ref={container} className="map-canvas" role="region" aria-label={t.t('map.label')} />
      <LayerSwitcher value={layers} onChange={(map) => setSettings({ map })} />
      {picked && (
        <div className="place-card" role="dialog" aria-label={pickedLabel}>
          <div className="place-card__text">
            <div className="strong">{pickedLabel}</div>
            <div className="muted small">
              {poiLabel(settings.lang, picked.klass, picked.subclass) ??
                `${picked.lat.toFixed(5)}, ${picked.lon.toFixed(5)}`}
            </div>
          </div>
          <div className="place-card__actions">
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => {
                planWith({ to: encodePlace({ ...picked, name: pickedLabel }) });
                setPicked(undefined);
              }}
            >
              <Flag size={14} /> {t.t('place.routeTo')}
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                planWith({ from: encodePlace({ ...picked, name: pickedLabel }) });
                setPicked(undefined);
              }}
            >
              <MapPin size={14} /> {t.t('place.routeFrom')}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => setPicked(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Opens the planner keeping whatever origin/destination is already set. */
function planWith(patch: Record<string, string>) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const current = path.startsWith('plan') ? Object.fromEntries(new URLSearchParams(query)) : {};
  navigate('plan', { ...current, ...patch, i: undefined });
}

/** Shows or hides places, 3D buildings and 3D terrain on the current style. */
function applyDetails(map: MapLibreMap, layers: MapLayers) {
  const style = map.getStyle();
  if (!style) return;
  for (const id of placeLayerIds(style)) {
    map.setLayoutProperty(id, 'visibility', layers.places ? 'visible' : 'none');
  }
  const buildings = buildingLayers(style);
  if (layers.buildings3d && buildings.source && buildings.extrusions.length === 0) {
    map.addLayer(extrusionLayer(buildings.source, layers.base === 'satellite'), 'mb-line-casing');
    buildings.extrusions.push('mb-buildings-3d');
  }
  for (const id of buildings.extrusions) {
    map.setLayoutProperty(id, 'visibility', layers.buildings3d ? 'visible' : 'none');
  }
  if (layers.terrain3d) {
    if (!map.getSource('mb-dem-3d')) map.addSource('mb-dem-3d', demSource());
    map.setTerrain({ source: 'mb-dem-3d', exaggeration: 1.3 });
  } else if (map.getTerrain()) {
    map.setTerrain(null);
  }
  const want3d = layers.buildings3d || layers.terrain3d;
  if (want3d && map.getPitch() < 20) map.easeTo({ pitch: 55, duration: 900 });
  if (!want3d && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
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
