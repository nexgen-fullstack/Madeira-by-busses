import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Flag, MapPin, X } from 'lucide-react';
import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type IControl,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { haversine, type LatLon, type Network } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { luminance, readableOn } from '../lib/color.ts';
import { decodePlace, encodePlace } from '../lib/itinerary.ts';
import {
  transitGeoJson,
  WAY_TURQUOISE,
  type LineNote,
  type MapContent,
} from '../lib/mapContent.ts';
import {
  buildingLayers,
  demSource,
  extrusionLayer,
  fallbackStyle,
  loadStyle,
  placeLayerIds,
  poiLabel,
  type BaseLayer,
  type MapLayers,
} from '../lib/mapStyles.ts';
import { pointName } from '../lib/pointName.ts';
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

/** A stop tapped while choosing a place on the map: chosen as the stop while the pin stays on it. */
interface PickedStop extends LatLon {
  stops: number[];
  name: string;
}

/**
 * The pin of a maps app in the yellow of the logo's pin: where the journey goes, a dropped
 * pin, the spot being chosen. Pressed, it turns turquoise (colours in styles.css).
 */
const PIN_PATH =
  'M14 1C6.8 1 1 6.8 1 14c0 9.6 11.2 22.6 12.2 23.8a1 1 0 0 0 1.6 0C15.8 36.6 27 23.6 27 14 27 6.8 21.2 1 14 1z';
const PIN_SVG = `<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true">
<path class="map-pin__body" d="${PIN_PATH}"/>
<path class="map-pin__shade" d="M14 1C21.2 1 27 6.8 27 14c0 9.6-11.2 22.6-12.2 23.8l-.8.4z"/>
<path class="map-pin__edge" d="${PIN_PATH}"/>
<ellipse class="map-pin__shine" cx="9.2" cy="8.2" rx="3.4" ry="1.9" transform="rotate(-38 9.2 8.2)"/>
<circle class="map-pin__dot" cx="14" cy="14" r="5"/></svg>`;
/** lucide "bus", for the button that shows every stop and line. */
const BUS_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>`;

/**
 * A pin for a marker. Turquoise while pressed; a tap chooses it (it stays turquoise) or lets it
 * go again, and a tap anywhere else on the map lets it go too.
 */
function pinElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-pin';
  el.innerHTML = PIN_SVG;
  const release = () => el.classList.remove('map-pin--pressed');
  el.addEventListener('pointerdown', () => el.classList.add('map-pin--pressed'));
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('click', (e) => {
    // The map under the pin would take the tap for one elsewhere (or for the stop beneath).
    e.stopPropagation();
    el.classList.toggle('map-pin--chosen');
  });
  return el;
}

/** A tap on the map away from the pins: none of them is chosen any more. */
function releasePins(map: MapLibreMap) {
  for (const pin of map.getCanvasContainer().querySelectorAll('.map-pin--chosen')) {
    pin.classList.remove('map-pin--chosen');
  }
}

/** A map button (in the column of zoom and location buttons) that shows every stop and line. */
class TransitControl implements IControl {
  private container?: HTMLElement;
  private button?: HTMLButtonElement;
  constructor(private readonly onToggle: () => void) {}
  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mb-transit-button';
    button.innerHTML = BUS_SVG;
    button.addEventListener('click', this.onToggle);
    container.appendChild(button);
    this.container = container;
    this.button = button;
    return container;
  }
  onRemove(): void {
    this.container?.remove();
  }
  set(on: boolean, label: string): void {
    this.button?.setAttribute('aria-pressed', String(on));
    this.button?.setAttribute('aria-label', label);
    if (this.button) this.button.title = label;
  }
}

function toGeoJson(content: MapContent) {
  return {
    lines: {
      type: 'FeatureCollection' as const,
      features: content.lines.map((l) => ({
        type: 'Feature' as const,
        properties: {
          color: l.color,
          // A dark edge round a light line (the neon of a chosen way), a white one round the rest.
          casing: luminance(l.color) > 0.25 ? '#14181F' : '#ffffff',
          // The number of the bus written on the line.
          ink: readableOn(l.color),
          dashed: Boolean(l.dashed),
          width: l.width ?? 4,
          label: l.label ?? '',
          arrows: Boolean(l.arrows),
          side: Boolean(l.side),
          note: l.note ? JSON.stringify(l.note) : '',
        },
        geometry: { type: 'LineString' as const, coordinates: l.coords.map((c) => [c.lon, c.lat]) },
      })),
    },
    points: {
      type: 'FeatureCollection' as const,
      features: content.points.map((p) => ({
        type: 'Feature' as const,
        properties: {
          kind: p.kind,
          color: p.color ?? '#002F85',
          fill: p.fill ?? '#ffffff',
          label: p.label ?? '',
          stops: (p.stops ?? []).join(','),
        },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    },
  };
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * How far each way of a line keeps to its side of the road (px): apart once the map is
 * close enough for two lines to fit on a road.
 */
const SIDE: [number, number][] = [
  [10, 0.5],
  [12, 2],
  [16, 4.5],
];

/** A chevron pointing along a line, for the arrows the way the bus goes. */
function arrowImage(): ImageData | undefined {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 9);
  ctx.lineTo(26, 20);
  ctx.lineTo(14, 31);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.strokeStyle = '#14181F';
  ctx.lineWidth = 8;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** A canvas of `size` px drawn by `draw`, as an image for the map. */
function canvasImage(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): ImageData | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  draw(ctx);
  return ctx.getImageData(0, 0, width, height);
}

const FLAG_W = 64;
const FLAG_H = 72;

/**
 * A flag as in Formula 1, its pole at the bottom corner standing on the stop: the green
 * one where a bus is boarded (cloth to the right), the chequered one where it is left
 * (cloth to the left), so that at a change of bus the two stand side by side.
 */
function flagImage(finish: boolean): ImageData | undefined {
  return canvasImage(FLAG_W, FLAG_H, (ctx) => {
    const pole = finish ? FLAG_W - 6 : 6;
    const cloth = { x: finish ? 8 : 9, y: 5, w: FLAG_W - 17, h: 32 };
    // The pole, white-edged to read on the aerial photos.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(pole, 4);
    ctx.lineTo(pole, FLAG_H - 4);
    ctx.stroke();
    ctx.strokeStyle = '#14181F';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cloth.x - 2, cloth.y - 2, cloth.w + 4, cloth.h + 4);
    if (finish) {
      const cols = 5;
      const rows = 4;
      const cw = cloth.w / cols;
      const ch = cloth.h / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#14181F';
          ctx.fillRect(cloth.x + c * cw, cloth.y + r * ch, cw, ch);
        }
    } else {
      ctx.fillStyle = '#00C853';
      ctx.fillRect(cloth.x, cloth.y, cloth.w, cloth.h);
    }
    ctx.strokeStyle = '#14181F';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(cloth.x, cloth.y, cloth.w, cloth.h);
  });
}

/** A step of a walk: a white dot in a bright blue ring, on any map. */
function walkDotImage(): ImageData | undefined {
  return canvasImage(24, 24, (ctx) => {
    ctx.beginPath();
    ctx.arc(12, 12, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1E6FFF';
    ctx.stroke();
  });
}

function addOverlay(map: MapLibreMap, base: BaseLayer) {
  if (map.getSource('mb-lines')) return;
  const images: [string, () => ImageData | undefined][] = [
    ['mb-arrow', arrowImage],
    ['mb-flag-start', () => flagImage(false)],
    ['mb-flag-finish', () => flagImage(true)],
    ['mb-walk-dot', walkDotImage],
  ];
  for (const [id, make] of images) {
    if (map.hasImage(id)) continue;
    const image = make();
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
  const sideOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...SIDE.flatMap(([zoom, px]) => [zoom, ['case', ['get', 'side'], px, 0]]),
  ] as unknown as number;
  // Every stop and line, under whatever the screen draws.
  map.addSource('mb-net-lines', { type: 'geojson', data: EMPTY });
  map.addSource('mb-net-stops', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'mb-net-line',
    type: 'line',
    source: 'mb-net-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 2.2, 16, 4],
      'line-opacity': 0.7,
    },
  });
  map.addLayer({
    id: 'mb-net-stop',
    type: 'circle',
    source: 'mb-net-stops',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 12, 2.6, 14, 4, 17, 7],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#002F85',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
    },
  });
  map.addSource('mb-lines', { type: 'geojson', data: EMPTY });
  map.addSource('mb-points', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'mb-line-casing',
    type: 'line',
    source: 'mb-lines',
    filter: ['!', ['get', 'dashed']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'casing'],
      'line-width': ['+', ['get', 'width'], 3],
      'line-opacity': 0.9,
      'line-offset': sideOffset,
    },
  });
  map.addLayer({
    id: 'mb-line',
    type: 'line',
    source: 'mb-lines',
    filter: ['!', ['get', 'dashed']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'width'],
      'line-offset': sideOffset,
    },
  });
  // A walk: a faint band along the streets with bright dots on it, to see where it goes.
  map.addLayer({
    id: 'mb-walk',
    type: 'line',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': base === 'satellite' ? '#ffffff' : '#1E6FFF',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 6],
      'line-opacity': 0.45,
    },
  });
  map.addLayer({
    id: 'mb-walk-dots',
    type: 'symbol',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 9, 17, 16],
      'icon-image': 'mb-walk-dot',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 17, 1.15],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
  });
  // Arrows the way the bus goes: on the line, or on its side of the road.
  for (const side of [false, true]) {
    map.addLayer({
      id: side ? 'mb-line-arrow-side' : 'mb-line-arrow',
      type: 'symbol',
      source: 'mb-lines',
      minzoom: 10,
      filter: ['all', ['get', 'arrows'], side ? ['get', 'side'] : ['!', ['get', 'side']]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'icon-image': 'mb-arrow',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        ...(side && {
          'icon-offset': [
            'interpolate',
            ['linear'],
            ['zoom'],
            ...SIDE.flatMap(([zoom, px]) => [zoom, ['literal', [0, px]]]),
          ] as unknown as [number, number],
        }),
      },
    });
  }
  // Where the trip starts and where the person is: neon turquoise, glowing.
  map.addLayer({
    id: 'mb-point-glow',
    type: 'circle',
    source: 'mb-points',
    filter: ['match', ['get', 'kind'], ['origin', 'user'], true, false],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 16, 20],
      'circle-color': WAY_TURQUOISE,
      'circle-opacity': 0.45,
      'circle-blur': 0.9,
    },
  });
  map.addLayer({
    id: 'mb-point',
    type: 'circle',
    source: 'mb-points',
    // The destination is the yellow pin (a marker), not a circle.
    filter: ['!=', ['get', 'kind'], 'destination'],
    // Where one bus is left and the next boarded at the same stop: a red dot in a blue ring.
    layout: { 'circle-sort-key': ['match', ['get', 'kind'], 'board', 2, 'alight', 1, 0] },
    paint: {
      // The stops along a line are dots that grow as the map comes closer: zoomed out,
      // a line with eighty stops would be a string of beads hiding the line itself.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          0,
          6.5,
        ],
        11.5,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          1.8,
          6.5,
        ],
        13,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          3,
          6.5,
        ],
        15,
        [
          'match',
          ['get', 'kind'],
          ['user', 'origin'],
          8,
          'bus',
          9,
          'board',
          4,
          'alight',
          4,
          'stop',
          4.5,
          6.5,
        ],
      ],
      'circle-color': [
        'match',
        ['get', 'kind'],
        ['user', 'origin'],
        WAY_TURQUOISE,
        'bus',
        ['get', 'color'],
        ['get', 'fill'],
      ],
      'circle-stroke-color': [
        'match',
        ['get', 'kind'],
        ['user', 'origin', 'bus'],
        '#ffffff',
        ['get', 'color'],
      ],
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['match', ['get', 'kind'], 'stop', 0, 3],
        11.5,
        ['match', ['get', 'kind'], 'stop', 1, 3],
        14,
        ['match', ['get', 'kind'], 'stop', 2, 3],
      ],
    },
  });
  // The flags where each bus is boarded and left, standing on their stops.
  map.addLayer({
    id: 'mb-flag',
    type: 'symbol',
    source: 'mb-points',
    filter: ['match', ['get', 'kind'], ['board', 'alight'], true, false],
    layout: {
      'icon-image': ['match', ['get', 'kind'], 'board', 'mb-flag-start', 'mb-flag-finish'],
      'icon-anchor': ['match', ['get', 'kind'], 'board', 'bottom-left', 'bottom-right'],
      // The pole's foot on the stop, the cloth up and to the side.
      'icon-offset': ['match', ['get', 'kind'], 'board', ['literal', [-3, 2]], ['literal', [3, 2]]],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 14, 1.1, 17, 1.35],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['match', ['get', 'kind'], 'board', 2, 1],
    },
  });
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'mb-net-label',
      type: 'symbol',
      source: 'mb-net-stops',
      minzoom: 15.5,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#002F85', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    // The number of the bus along its line, as a maps app writes it.
    map.addLayer({
      id: 'mb-line-label',
      type: 'symbol',
      source: 'mb-lines',
      filter: ['!=', ['get', 'label'], ''],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 220,
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-font': ['Noto Sans Bold'],
        'text-keep-upright': true,
      },
      paint: {
        'text-color': ['get', 'ink'],
        'text-halo-color': ['get', 'color'],
        'text-halo-width': 3,
      },
    });
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

const TRANSIT_LAYERS = ['mb-net-line', 'mb-net-stop', 'mb-net-label'];

type TransitData = ReturnType<typeof transitGeoJson>;

/** Puts every stop and line on the map, or hides them. */
function applyTransit(map: MapLibreMap, data: TransitData | undefined, on: boolean) {
  if (!map.getSource('mb-net-lines')) return;
  if (data) {
    (map.getSource('mb-net-lines') as GeoJSONSource).setData(data.lines);
    (map.getSource('mb-net-stops') as GeoJSONSource).setData(data.stops);
  }
  for (const id of TRANSIT_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

/** The origin and destination of the planner as they are in the address. */
function plannedPlaces(net: Network | undefined, myLocation: string) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (!net || !path.startsWith('plan')) return {};
  const q = new URLSearchParams(query);
  return {
    from: decodePlace(net, q.get('from'), myLocation),
    to: decodePlace(net, q.get('to'), myLocation),
  };
}

export default function MapView({ className }: { className?: string }) {
  const { content, pick, setPick } = useContext(MapContentContext);
  const { settings, setSettings, data } = useApp();
  const t = useI18n();
  const net = data.status === 'ready' ? data.net : undefined;
  // The map's handlers are set up once; they read these.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const netRef = useRef(net);
  netRef.current = net;
  const tRef = useRef(t);
  tRef.current = t;
  const layers = settings.map;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const fitted = useRef<Fit>({});
  const [ready, setReady] = useState(false);
  const styleLoaded = useRef(false);
  const shownStyle = useRef(`${layers.base}:fallback`);
  const [picked, setPicked] = useState<PickedPlace | undefined>();
  const [note, setNote] = useState<LineNote | undefined>();
  const transitControl = useRef<TransitControl | null>(null);
  const transitRef = useRef<{ data?: TransitData; on: boolean }>({ on: false });
  // A chosen route is shown alone: every stop and line step aside until asked for again.
  const [transitWith, setTransitWith] = useState<string | undefined>();
  const transitOn = layers.transit && (!content.focus || transitWith === content.focus);
  const setTransit = (on: boolean) => {
    if (on && content.focus) setTransitWith(content.focus);
    setSettings({ map: { ...layers, transit: on } });
  };
  const toggleTransitRef = useRef(() => {});
  toggleTransitRef.current = () => setTransit(!transitOn);
  // Choosing a place: the point under the pin, its name, and whether the map is moving.
  const [center, setCenter] = useState<LatLon | undefined>();
  const [moving, setMoving] = useState(false);
  const pickedStop = useRef<PickedStop | undefined>(undefined);

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
    const transit = new TransitControl(() => toggleTransitRef.current());
    transitControl.current = transit;
    map.addControl(transit, 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 90 }), 'bottom-right');
    map.on('style.load', () => {
      styleLoaded.current = true;
      addOverlay(map, layersRef.current.base);
      applyDetails(map, layersRef.current);
      applyTransit(map, transitRef.current.data, transitRef.current.on);
      fitted.current = {};
      setReady(true);
      apply(map, contentRef.current, fitted);
    });
    map.on('click', (e: MapMouseEvent) => {
      releasePins(map);
      const box: [[number, number], [number, number]] = [
        [e.point.x - 8, e.point.y - 8],
        [e.point.x + 8, e.point.y + 8],
      ];
      const features = map.queryRenderedFeatures(box);
      const stop = features.find(
        (f) => (f.layer.id === 'mb-point' || f.layer.id === 'mb-net-stop') && f.properties?.stops,
      );
      if (pickRef.current) {
        // Choosing a place: the pin goes where the map was tapped (onto a stop, if one was).
        if (stop && stop.geometry.type === 'Point') {
          const [lon, lat] = stop.geometry.coordinates as [number, number];
          const stops = String(stop.properties.stops).split(',').map(Number);
          pickedStop.current = { lat, lon, stops, name: String(stop.properties.label ?? '') };
          map.easeTo({ center: [lon, lat], duration: 400 });
        } else {
          pickedStop.current = undefined;
          map.easeTo({ center: e.lngLat, duration: 400 });
        }
        return;
      }
      if (stop) {
        navigate('stop', { ids: String(stop.properties.stops) });
        return;
      }
      // A run of a line that goes its own way: when it runs.
      const run = features.find((f) => f.layer.id.startsWith('mb-line') && f.properties?.note);
      if (run) {
        setPicked(undefined);
        setNote(JSON.parse(String(run.properties.note)) as LineNote);
        return;
      }
      setNote(undefined);
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
      if (pickRef.current) return;
      const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      setNote(undefined);
      setPicked({ name: pointName(netRef.current, p, tRef.current), ...p });
    });
    map.on('movestart', (e) => {
      // A drag, a pinch or a wheel: the reader looks elsewhere now.
      if ((e as { originalEvent?: Event }).originalEvent) fitted.current.moved = true;
      if (pickRef.current) setMoving(true);
    });
    map.on('moveend', () => {
      setMoving(false);
      if (!pickRef.current) return;
      const c = map.getCenter();
      setCenter({ lat: c.lat, lon: c.lng });
    });
    for (const id of ['mb-point', 'mb-net-stop']) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
    const ro = new ResizeObserver(() => {
      map.resize();
      // A route fitted while the map was another size (still loading, a sheet opening) stays in view.
      const { bounds, moved } = fitted.current;
      if (bounds && !moved && !pickRef.current) fitTo(map, bounds, 0);
    });
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
    if (map && ready && map.getSource('mb-lines')) apply(map, content, fitted);
  }, [content, ready]);

  // Every stop and line: built the first time they are shown, put back after a style change.
  const transit = useMemo(
    () => (layers.transit && net ? transitGeoJson(net) : undefined),
    [layers.transit, net],
  );
  const shownTransit = useRef<TransitData | undefined>(undefined);
  useEffect(() => {
    transitControl.current?.set(transitOn, t.t('layers.transit'));
    transitRef.current = { data: transit ?? transitRef.current.data, on: transitOn };
    const map = mapRef.current;
    if (!map || !ready) return;
    // Hidden and shown again for a chosen route, the same stops need not be loaded again.
    applyTransit(map, transit !== shownTransit.current ? transit : undefined, transitOn);
    if (transit) shownTransit.current = transit;
  }, [transit, transitOn, ready, t]);

  // The yellow pin where the journey goes.
  const destination = content.points.find((p) => p.kind === 'destination');
  useMarker(mapRef, ready, destination);
  // And on a place tapped or a pin dropped.
  useMarker(mapRef, ready, pick ? undefined : picked);
  // A run tapped belongs to the line on the map; another one, another day, forget it.
  useEffect(() => setNote(undefined), [content]);

  // Choosing a place: start where the field's place is, or near the other end of the trip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pick) return;
    pickedStop.current = undefined;
    setPicked(undefined);
    const places = plannedPlaces(netRef.current, tRef.current.t('place.myLocation'));
    const own = places[pick];
    const other = places[pick === 'from' ? 'to' : 'from'];
    if (own) map.jumpTo({ center: [own.lon, own.lat], zoom: Math.max(map.getZoom(), 16) });
    else if (other)
      map.jumpTo({ center: [other.lon, other.lat], zoom: Math.max(map.getZoom(), 14) });
    const c = map.getCenter();
    setCenter({ lat: c.lat, lon: c.lng });
    // The map grows to fill the screen while choosing.
    window.setTimeout(() => map.resize(), 50);
  }, [pick]);

  // Escape leaves "choose on the map".
  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPick(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick, setPick]);

  const onStop = pickedStop.current && center && haversine(pickedStop.current, center) < 8;
  const centerName = !center ? '' : onStop ? pickedStop.current!.name : pointName(net, center, t);
  const choose = () => {
    if (!pick || !center) return;
    const value =
      onStop && pickedStop.current
        ? encodePlace(pickedStop.current, net)
        : encodePlace({ ...center, name: centerName });
    setPick(undefined);
    planWith({ [pick]: value });
  };

  const pickedLabel = picked?.name || t.t('place.pin');
  return (
    <div className={`${className ?? ''} map-wrap${pick ? ' map-wrap--picking' : ''}`}>
      <div ref={container} className="map-canvas" role="region" aria-label={t.t('map.label')} />
      {pick && (
        <>
          <div className="map-pick" role="status">
            <MapPin size={18} aria-hidden />
            <span>{t.t(pick === 'from' ? 'place.pickFrom' : 'place.pickTo')}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => setPick(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <div className={`map-center-pin${moving ? ' map-center-pin--lifted' : ''}`} aria-hidden>
            <div className="map-pin" dangerouslySetInnerHTML={{ __html: PIN_SVG }} />
            <span className="map-center-pin__shadow" />
          </div>
          <div className="pick-card" role="dialog" aria-label={t.t('place.pickOnMap')}>
            <div className="pick-card__text">
              <div className="strong">{moving ? '…' : centerName}</div>
              {center && (
                <div className="muted small">
                  {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
                </div>
              )}
            </div>
            <button
              type="button"
              className="button button--primary"
              disabled={!center || moving}
              onClick={choose}
            >
              <Check size={16} /> {t.t('place.pickDone')}
            </button>
          </div>
        </>
      )}
      <LayerSwitcher
        value={{ ...layers, transit: transitOn }}
        onChange={(map) =>
          map.transit !== transitOn
            ? setTransit(map.transit)
            : setSettings({ map: { ...map, transit: layers.transit } })
        }
      />
      {note && !pick && (
        <div className="place-card" role="dialog" aria-label={note.title}>
          <div className="place-card__text">
            <div className="strong line-note__title">{note.title}</div>
            {note.lines.map((l) => (
              <div key={l} className="small">
                {l}
              </div>
            ))}
          </div>
          <div className="place-card__actions">
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('close')}
              onClick={() => setNote(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {picked && !pick && (
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

/** Keeps a yellow pin on the map at `at`, or none. */
function useMarker(
  mapRef: { current: MapLibreMap | null },
  ready: boolean,
  at: LatLon | undefined,
): void {
  const marker = useRef<Marker | null>(null);
  const lat = at?.lat;
  const lon = at?.lon;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || lat === undefined || lon === undefined) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    marker.current ??= new Marker({ element: pinElement(), anchor: 'bottom' });
    marker.current.setLngLat([lon, lat]).addTo(map);
  }, [mapRef, ready, lat, lon]);
  useEffect(
    () => () => {
      marker.current?.remove();
      marker.current = null;
    },
    [],
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
    map.addLayer(extrusionLayer(buildings.source, layers.base === 'satellite'), 'mb-net-line');
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

/** The last place the camera was fitted to, kept in view while the map changes size. */
interface Fit {
  key?: string;
  bounds?: LngLatBounds;
  /** The map was moved by hand since: a change of size keeps it where it is. */
  moved?: boolean;
}

function fitTo(map: MapLibreMap, bounds: LngLatBounds, duration: number) {
  // Clear of the buttons down the right side and of the pin's height at the top.
  map.fitBounds(bounds, {
    padding: { top: 56, bottom: 40, left: 40, right: 64 },
    maxZoom: 15.5,
    duration,
  });
}

function apply(map: MapLibreMap, content: MapContent, fit: { current: Fit }) {
  const data = toGeoJson(content);
  (map.getSource('mb-lines') as GeoJSONSource | undefined)?.setData(data.lines);
  (map.getSource('mb-points') as GeoJSONSource | undefined)?.setData(data.points);
  if (
    content.fitKey &&
    content.fitKey !== fit.current.key &&
    content.fit &&
    content.fit.length > 0
  ) {
    const bounds = new LngLatBounds();
    for (const c of content.fit) bounds.extend([c.lon, c.lat]);
    fit.current = { key: content.fitKey, bounds };
    fitTo(map, bounds, 600);
  }
}
