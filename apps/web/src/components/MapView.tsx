import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Bus, Check, Flag, MapPin, X } from 'lucide-react';
import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { haversine, type LatLon, type Network } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { luminance, readableOn } from '../lib/color.ts';
import { decodePlace, encodePlace } from '../lib/itinerary.ts';
import { hideLaunch } from '../lib/launch.ts';
import {
  RUN_WIDTH,
  transitGeoJson,
  VIEW_WALK,
  WAY_TURQUOISE,
  WAY_WIDTH,
  type LineNote,
  type MapContent,
  type ScenicSpot,
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
import { useBack } from '../lib/back.ts';
import { navigate } from '../lib/router.ts';
import { useApp } from '../state/app.tsx';
import { LayerSwitcher } from './LayerSwitcher.tsx';
import { LineCard, LineChooser, type LinePick } from './LineCard.tsx';
import { MapContentContext, type PickField } from './mapContext.tsx';

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

/**
 * The map's credits as their round "i" alone, as in a maps app: MapLibre opens them as
 * they first fill in (and again when the phone is turned); here they open only when the "i"
 * is tapped, and fold away at a second tap or a tap on the map. Returns `fold`.
 */
function foldAttribution(map: MapLibreMap): () => void {
  const el = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
  if (!el) return () => {};
  let wanted = false;
  const fold = () => {
    wanted = false;
    el.classList.remove('maplibregl-compact-show');
  };
  // Before MapLibre's own handler turns it: what the tap asks for.
  el.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element).closest('.maplibregl-ctrl-attrib-button')) {
        wanted = !el.classList.contains('maplibregl-compact-show');
      }
    },
    true,
  );
  new MutationObserver(() => {
    if (!wanted && el.classList.contains('maplibregl-compact-show')) {
      el.classList.remove('maplibregl-compact-show');
    }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
  fold();
  return fold;
}

/**
 * The map's buttons where the sheet over it on a phone has come up to them (or the map's
 * credits below them): they step aside rather than lie on the screen's content, and come
 * back when the sheet goes down.
 */
function hideCovered(map: MapLibreMap): void {
  const panel = document.querySelector<HTMLElement>('.panel--sheet');
  const box = map.getContainer().parentElement;
  if (!box) return;
  const credits = box.querySelector('.maplibregl-ctrl-bottom-right');
  const limit = Math.min(
    panel ? panel.getBoundingClientRect().top : Infinity,
    credits && credits.childElementCount > 0 ? credits.getBoundingClientRect().top : Infinity,
  );
  const buttons = box.querySelectorAll<HTMLElement>(
    '.maplibregl-ctrl-top-right > .maplibregl-ctrl, .map-tools',
  );
  for (const el of buttons) {
    el.classList.remove('map-ctrl--covered');
    el.classList.toggle('map-ctrl--covered', el.getBoundingClientRect().bottom > limit - 4);
  }
}

/** A tap on the map away from the pins: none of them is chosen any more. */
function releasePins(map: MapLibreMap) {
  for (const pin of map.getCanvasContainer().querySelectorAll('.map-pin--chosen')) {
    pin.classList.remove('map-pin--chosen');
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
          // The number of the bus written on the line, on a plate of its colour.
          ink: readableOn(l.color),
          plate: plateId(l.color),
          dashed: Boolean(l.dashed),
          width: l.width ?? 4,
          label: l.label ?? '',
          arrows: Boolean(l.arrows),
          side: Boolean(l.side),
          note: l.note ? JSON.stringify(l.note) : '',
          route: l.route ?? -1,
          pattern: l.pattern ?? -1,
          board: l.board ?? -1,
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
          pair: Boolean(p.pair),
          apart: Boolean(p.apart),
          heading: p.heading ?? -1,
          dot: stopDotId(p.fill ?? '#ffffff'),
        },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    },
  };
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * Lines are drawn in their lanes, moved over by real metres (see `offsetPolyline`), which
 * far out are less than a pixel. Where the two ways of a line share a road, each is drawn
 * to its own side of it by this much of its width at any zoom: their dark edges meet in
 * the middle, a solid line between two lanes, and neither covers the other.
 */
const LANE_APART = 0.75;

/** How far a way on a shared road is drawn to its side (px), by its width. */
const sideOffset = [
  'case',
  ['get', 'side'],
  ['*', ['get', 'width'], LANE_APART],
  0,
] as unknown as number;

/** The arrows of a way on a shared road with it, on their side (px across the line). */
const sideArrows = [
  'case',
  ['==', ['get', 'width'], WAY_WIDTH],
  ['literal', [0, WAY_WIDTH * LANE_APART]],
  ['literal', [0, RUN_WIDTH * LANE_APART]],
] as unknown as [number, number];

/** The image of a stop on a shared road, a dot in its way's colour in a dark ring. */
const stopDotId = (fill: string) => `mb-stop-${fill.replace('#', '').toLowerCase()}`;
/** Its dot and ring at full size (px), as the stops drawn as circles are close up. */
const DOT_FILL = 4.5;
const DOT_RING = 2;

/**
 * How big a stop is drawn at a zoom, of its full size: as the circles of the other stops
 * grow (their radius and ring in the `mb-point` layer), so the two kinds look alike.
 */
function stopScale(zoom: number): number {
  const at = (stops: [number, number][]) => {
    const i = stops.findIndex(([z]) => z >= zoom);
    if (i <= 0) return i === 0 ? stops[0]![1] : stops.at(-1)![1];
    const [z0, v0] = stops[i - 1]!;
    const [z1, v1] = stops[i]!;
    return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
  };
  const radius = at([
    [10, 0],
    [11.5, 1.8],
    [13, 3],
    [15, 4.5],
  ]);
  const ring = at([
    [10, 0],
    [11.5, 1],
    [14, 2],
  ]);
  return (radius + ring) / (DOT_FILL + DOT_RING);
}
const DOT_ZOOMS = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15];

/** Puts on the map the dots of the colours its stops on shared roads are in. */
function addStopDots(map: MapLibreMap, content: MapContent) {
  for (const p of content.points) {
    if (p.heading === undefined) continue;
    const id = stopDotId(p.fill ?? '#ffffff');
    if (map.hasImage(id)) continue;
    const r = (DOT_FILL + DOT_RING) * 2;
    const image = canvasImage(r * 2, r * 2, (ctx) => {
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color ?? '#14181F';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r, r, DOT_FILL * 2, 0, Math.PI * 2);
      ctx.fillStyle = p.fill ?? '#ffffff';
      ctx.fill();
    });
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
}

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

/** The plate a line's number is written on, one for each colour of line. */
const plateId = (color: string) => `mb-plate-${color.replace('#', '').toLowerCase()}`;

/** Plate size and corner in image pixels (drawn at twice the size of the screen). */
const PLATE = 24;
const PLATE_EDGE = 2;
const PLATE_CORNER = 6;

/**
 * A rounded plate in a line's colour with an edge that reads on any map (dark round a
 * light colour, white round a dark one), as the number of a bus is printed in the list:
 * stretched round the number (a nine-patch), its corners kept round.
 */
function plateImage(color: string): ImageData | undefined {
  return canvasImage(PLATE, PLATE, (ctx) => {
    const rounded = (inset: number, radius: number) => {
      const a = inset;
      const b = PLATE - inset;
      ctx.beginPath();
      ctx.moveTo(a + radius, a);
      ctx.arcTo(b, a, b, b, radius);
      ctx.arcTo(b, b, a, b, radius);
      ctx.arcTo(a, b, a, a, radius);
      ctx.arcTo(a, a, b, a, radius);
      ctx.closePath();
    };
    rounded(0, PLATE_CORNER);
    ctx.fillStyle = luminance(color) > 0.25 ? '#14181F' : '#ffffff';
    ctx.fill();
    rounded(PLATE_EDGE, PLATE_CORNER - PLATE_EDGE);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

/** Puts on the map the plates of the colours its lines are in. */
function addPlates(map: MapLibreMap, content: MapContent) {
  for (const line of content.lines) {
    if (!line.label) continue;
    const id = plateId(line.color);
    if (map.hasImage(id)) continue;
    const image = plateImage(line.color);
    if (!image) continue;
    const mid = PLATE / 2;
    map.addImage(id, image, {
      pixelRatio: 2,
      // Only the straight middle of each side stretches; the text goes inside the edge.
      stretchX: [[PLATE_CORNER, PLATE - PLATE_CORNER]],
      stretchY: [[PLATE_CORNER, PLATE - PLATE_CORNER]],
      content: [mid - 4, mid - 4, mid + 4, mid + 4],
    });
  }
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
  // A wide band along each line, invisible, for a finger to find it by.
  map.addLayer({
    id: 'mb-net-line-hit',
    type: 'line',
    source: 'mb-net-lines',
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH, 'line-opacity': 0 },
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
      // The edge in proportion to the line: half its width again.
      'line-width': ['*', ['get', 'width'], 1.5],
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
  map.addLayer({
    id: 'mb-line-hit',
    type: 'line',
    source: 'mb-lines',
    filter: ['>=', ['get', 'route'], 0],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH, 'line-opacity': 0 },
  });
  // A walk: a faint band along the pavements with small bright dots close together on it;
  // a walk with a view, along the sea, on a band of the logo's cyan wave.
  const view: ExpressionSpecification = ['==', ['get', 'color'], VIEW_WALK];
  map.addLayer({
    id: 'mb-walk',
    type: 'line',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', view, '#00D2DC', base === 'satellite' ? '#ffffff' : '#1E6FFF'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['case', view, 3, 1.5], 17, 4],
      'line-opacity': ['case', view, 0.7, 0.45],
    },
  });
  map.addLayer({
    id: 'mb-walk-dots',
    type: 'symbol',
    source: 'mb-lines',
    filter: ['get', 'dashed'],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 5, 17, 8],
      'icon-image': 'mb-walk-dot',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.35, 17, 0.58],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
  });
  // Arrows the way the bus goes, on the line (and as far apart as the two ways of a line).
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
        ...(side && { 'icon-offset': sideArrows }),
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
    // The destination is the yellow pin (a marker), not a circle; a stop on a road both ways
    // of its line share is a dot on its way's side (below).
    filter: ['all', ['!=', ['get', 'kind'], 'destination'], ['<', ['get', 'heading'], 0]],
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
  // A stop on a road both ways of its line share: on its way's side of it, as its line is,
  // turned the way its bus goes so that its right is that side.
  map.addLayer({
    id: 'mb-stop-side',
    type: 'symbol',
    source: 'mb-points',
    filter: ['>=', ['get', 'heading'], 0],
    layout: {
      'icon-image': ['get', 'dot'],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        ...DOT_ZOOMS.flatMap((z) => [z, stopScale(z)]),
      ] as unknown as number,
      // The offset is scaled with the dot: so much more where the dot is small.
      'icon-offset': [
        'interpolate',
        ['linear'],
        ['zoom'],
        ...DOT_ZOOMS.flatMap((z) => {
          const scale = stopScale(z);
          return [z, ['literal', [scale > 0 ? (WAY_WIDTH * LANE_APART) / scale : 0, 0]]];
        }),
      ] as unknown as [number, number],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
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
      // The pole's foot on the stop, the cloth up and to the side; where a bus is left and
      // the next boarded at one place, the two poles a few pixels apart.
      'icon-offset': [
        'match',
        ['get', 'kind'],
        'board',
        ['case', ['get', 'pair'], ['literal', [1, 2]], ['literal', [-3, 2]]],
        ['case', ['get', 'pair'], ['literal', [-1, 2]], ['literal', [3, 2]]],
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 14, 1.1, 17, 1.35],
      'icon-allow-overlap': true,
      // Shown whatever is there, and the numbers along the lines keep clear of them.
      'icon-ignore-placement': false,
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
    // The number of the bus along its line on a plate of its colour, as in the list:
    // "this line is the 045, that one the 207". Under the flags, which it keeps clear of;
    // level whichever way the line runs, standing up when the map is tilted, and smaller
    // with the whole island in view.
    map.addLayer(
      {
        id: 'mb-line-label',
        type: 'symbol',
        source: 'mb-lines',
        filter: ['!=', ['get', 'label'], ''],
        layout: {
          'symbol-placement': 'line',
          // Closer together from afar, so each bus of the way has its plate on the island.
          'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 9, 70, 12, 140, 14, 200],
          // Level plates may sit on a winding mountain road (the default asks for a straight one).
          'text-max-angle': 180,
          // Stop names and flags do not push the number off; they keep clear of it instead.
          'text-allow-overlap': true,
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 11, 15, 12],
          'text-font': ['Noto Sans Bold'],
          'text-rotation-alignment': 'viewport',
          'text-pitch-alignment': 'viewport',
          'text-padding': 4,
          'icon-image': ['get', 'plate'],
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1, 4, 0, 4],
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
        },
        paint: { 'text-color': ['get', 'ink'] },
      },
      'mb-flag',
    );
    map.addLayer({
      id: 'mb-label',
      type: 'symbol',
      source: 'mb-points',
      filter: ['all', ['!=', ['get', 'label'], ''], ['!=', ['get', 'kind'], 'stop']],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        // Two names at one place: one to each side, under its own flag.
        'text-offset': [
          'case',
          ['!', ['get', 'apart']],
          ['literal', [0, 1.1]],
          ['==', ['get', 'kind'], 'board'],
          ['literal', [0.3, 1.1]],
          ['literal', [-0.3, 1.1]],
        ],
        'text-anchor': [
          'case',
          ['!', ['get', 'apart']],
          'top',
          ['==', ['get', 'kind'], 'board'],
          'top-left',
          'top-right',
        ],
        'text-max-width': 10,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#14181F', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }
}

const TRANSIT_LAYERS = ['mb-net-line', 'mb-net-line-hit', 'mb-net-stop', 'mb-net-label'];
/** How wide a line is to a finger (px): easy to tap on a phone. */
const HIT_WIDTH = 22;

/**
 * The different lines among tapped line features, each number once (its ways and
 * variants are the same bus to the person tapping; the card tells which way), in the
 * order of their numbers.
 */
function tappedLines(
  features: { layer: { id: string }; properties: Record<string, unknown> | null }[],
  net: Network | undefined,
): { route: number; pattern?: number; board?: number }[] {
  const out = new Map<string, { route: number; pattern?: number; board?: number }>();
  for (const f of features) {
    if (f.layer.id !== 'mb-line-hit' && f.layer.id !== 'mb-net-line-hit') continue;
    const route = Number(f.properties?.route ?? -1);
    if (!(route >= 0)) continue;
    const pattern = Number(f.properties?.pattern ?? -1);
    const board = Number(f.properties?.board ?? -1);
    const key = net?.routes[route]?.short ?? String(route);
    if (out.has(key)) continue;
    out.set(key, {
      route,
      ...(pattern >= 0 ? { pattern } : {}),
      ...(board >= 0 ? { board } : {}),
    });
  }
  const number = (r: number) => net?.routes[r]?.short ?? '';
  return [...out.values()].sort((a, b) =>
    number(a.route).localeCompare(number(b.route), undefined, { numeric: true }),
  );
}

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
  const { content, pick, pickArea, pickStart, setPick } = useContext(MapContentContext);
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
  // A line tapped: its card, or a short list when several lie under the finger.
  const [linePick, setLinePick] = useState<LinePick | undefined>();
  const [lineChoice, setLineChoice] = useState<
    { routes: { route: number; pattern?: number; board?: number }[]; at: LatLon } | undefined
  >();
  // The phone's back button closes a line's card (or the choice of lines) first.
  useBack(
    useCallback(() => {
      if (!linePick && !lineChoice) return false;
      setLinePick(undefined);
      setLineChoice(undefined);
      return true;
    }, [linePick, lineChoice]),
  );
  const transitRef = useRef<{ data?: TransitData; on: boolean }>({ on: false });
  // A chosen route is shown alone: every stop and line step aside until asked for again.
  const [transitWith, setTransitWith] = useState<string | undefined>();
  const transitOn = layers.transit && (!content.focus || transitWith === content.focus);
  const setTransit = (on: boolean) => {
    if (on && content.focus) setTransitWith(content.focus);
    setSettings({ map: { ...layers, transit: on } });
  };
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
    // While developing, the map for the browser console (to put the camera where a screenshot was).
    if (import.meta.env.DEV) (window as unknown as { mbMap?: MapLibreMap }).mbMap = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    );
    map.addControl(new ScaleControl({ maxWidth: 90 }), 'bottom-right');
    const foldCredits = foldAttribution(map);
    map.on('dragstart', foldCredits);
    map.once('load', hideLaunch);
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
      foldCredits();
      const box: [[number, number], [number, number]] = [
        [e.point.x - 8, e.point.y - 8],
        [e.point.x + 8, e.point.y + 8],
      ];
      const features = map.queryRenderedFeatures(box);
      const stop = features.find(
        (f) =>
          (f.layer.id === 'mb-point' ||
            f.layer.id === 'mb-stop-side' ||
            f.layer.id === 'mb-net-stop') &&
          f.properties?.stops,
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
        setLinePick(undefined);
        setLineChoice(undefined);
        setNote(JSON.parse(String(run.properties.note)) as LineNote);
        return;
      }
      setNote(undefined);
      // A bus's line: its card (which one, when several are under the finger).
      const lines = tappedLines(features, netRef.current);
      if (lines.length > 0) {
        const at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        setPicked(undefined);
        if (lines.length === 1) {
          const [only] = lines;
          setLineChoice(undefined);
          setLinePick({ route: only!.route, pattern: only!.pattern, stop: only!.board, at });
        } else {
          setLinePick(undefined);
          setLineChoice({ routes: lines, at });
        }
        return;
      }
      setLinePick(undefined);
      setLineChoice(undefined);
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
    for (const id of [
      'mb-point',
      'mb-stop-side',
      'mb-net-stop',
      'mb-line-hit',
      'mb-net-line-hit',
    ]) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
    // The sheet over the map on a phone, pulled up and down: the buttons it reaches step aside.
    const covered = () => hideCovered(map);
    const sheet = new ResizeObserver(covered);
    const panel = document.querySelector('.panel');
    if (panel) sheet.observe(panel);
    const ro = new ResizeObserver(() => {
      covered();
      map.resize();
      // A route fitted while the map was another size (still loading, a sheet opening) stays in view.
      const { bounds, moved } = fitted.current;
      if (bounds && !moved && !pickRef.current) fitTo(map, bounds, 0);
    });
    ro.observe(container.current);
    // The sheet over the map on a phone came to rest at another height.
    const onInset = () => {
      const { bounds, moved } = fitted.current;
      if (bounds && !moved && !pickRef.current) fitTo(map, bounds, 300);
    };
    window.addEventListener('mb-map-inset', onInset);
    window.addEventListener('mb-map-inset', covered);
    return () => {
      window.removeEventListener('mb-map-inset', onInset);
      window.removeEventListener('mb-map-inset', covered);
      sheet.disconnect();
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
    transitRef.current = { data: transit ?? transitRef.current.data, on: transitOn };
    const map = mapRef.current;
    if (!map || !ready) return;
    // Hidden and shown again for a chosen route, the same stops need not be loaded again.
    applyTransit(map, transit !== shownTransit.current ? transit : undefined, transitOn);
    if (transit) shownTransit.current = transit;
  }, [transit, transitOn, ready]);

  // The yellow pin where the journey goes.
  const destination = content.points.find((p) => p.kind === 'destination');
  useMarker(mapRef, ready, destination);
  // And on a place tapped or a pin dropped.
  useMarker(mapRef, ready, pick ? undefined : picked);
  // The places with a view by their photos, where they are (not while a place is picked).
  useScenicMarkers(mapRef, ready, pick ? undefined : content.scenic);
  // A run or a line tapped belongs to the map shown; another one, forget it.
  useEffect(() => {
    setNote(undefined);
    setLinePick(undefined);
    setLineChoice(undefined);
  }, [content]);

  // Choosing a place: start where the field's place is, or near the other end of the trip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pick) return;
    pickedStop.current = undefined;
    setPicked(undefined);
    const places = plannedPlaces(netRef.current, tRef.current.t('place.myLocation'));
    const own = pickStart ?? places[pick];
    const other = places[pick === 'from' ? 'to' : 'from'];
    if (pickArea) {
      // A village with nowhere in it to go to: all of it in view, the pin in its middle.
      const bounds = new LngLatBounds();
      for (const ring of pickArea.rings) for (const p of ring) bounds.extend([p.lon, p.lat]);
      map.fitBounds(bounds, { padding: 40, duration: 0 });
    } else if (own) map.jumpTo({ center: [own.lon, own.lat], zoom: Math.max(map.getZoom(), 16) });
    else if (other)
      map.jumpTo({ center: [other.lon, other.lat], zoom: Math.max(map.getZoom(), 14) });
    const c = map.getCenter();
    setCenter({ lat: c.lat, lon: c.lng });
    // The map grows to fill the screen while choosing.
    window.setTimeout(() => map.resize(), 50);
  }, [pick, pickArea, pickStart]);

  // Its bounds drawn while the pin is put down in it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: (pick ? (pickArea?.rings ?? []) : []).map((ring) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: ring.map((p) => [p.lon, p.lat]),
        },
      })),
    };
    const source = map.getSource('mb-pick-area') as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else if (data.features.length > 0) {
      map.addSource('mb-pick-area', { type: 'geojson', data });
      map.addLayer({
        id: 'mb-pick-area',
        type: 'line',
        source: 'mb-pick-area',
        paint: { 'line-color': '#0066dd', 'line-width': 3, 'line-dasharray': [2, 1.5] },
      });
    }
  }, [pick, pickArea, ready]);

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
    pickInto(pick, value);
  };

  const pickedLabel = picked?.name || t.t('place.pin');
  return (
    <div className={`${className ?? ''} map-wrap${pick ? ' map-wrap--picking' : ''}`}>
      <div ref={container} className="map-canvas" role="region" aria-label={t.t('map.label')} />
      {pick && (
        <>
          <div className="map-pick" role="status">
            <MapPin size={18} aria-hidden />
            <span>
              {pickArea
                ? t.t('place.pickIn', { name: pickArea.name })
                : t.t(pick === 'from' ? 'place.pickFrom' : 'place.pickTo')}
            </span>
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
      {/* Top left under the bar, as in a maps app: the layers, and every stop and line. */}
      <div className="map-tools">
        <LayerSwitcher
          value={{ ...layers, transit: transitOn }}
          onChange={(map) =>
            map.transit !== transitOn
              ? setTransit(map.transit)
              : setSettings({ map: { ...map, transit: layers.transit } })
          }
        />
        <button
          type="button"
          className="map-tool"
          aria-pressed={transitOn}
          aria-label={t.t('layers.transit')}
          title={t.t('layers.transit')}
          onClick={() => setTransit(!transitOn)}
        >
          <Bus size={18} />
        </button>
      </div>
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
      {linePick && !pick && <LineCard pick={linePick} onClose={() => setLinePick(undefined)} />}
      {lineChoice && !pick && (
        <LineChooser
          routes={lineChoice.routes}
          onClose={() => setLineChoice(undefined)}
          onPick={(r) => {
            const board = lineChoice.routes.find(
              (x) => x.route === r.route && x.pattern === r.pattern,
            )?.board;
            setLinePick({ route: r.route, pattern: r.pattern, stop: board, at: lineChoice.at });
            setLineChoice(undefined);
          }}
        />
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

/** How big a place's photo is drawn at a zoom (px): small far out, larger close in. */
const scenicSize = (zoom: number) => (zoom < 9.5 ? 34 : zoom < 11 ? 46 : zoom < 12.5 ? 60 : 76);

/**
 * Keeps the places with a view on the map as round photos with their names under them,
 * where they are. Those that would crowd one another give way to the ones before them in
 * the list (with a photo first), so zooming in brings out more; a tap opens the place.
 */
function useScenicMarkers(
  mapRef: { current: MapLibreMap | null },
  ready: boolean,
  spots: readonly ScenicSpot[] | undefined,
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !spots || spots.length === 0) return;
    const markers = spots.map((spot) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'scenic-pin';
      el.setAttribute('aria-label', spot.name);
      // The pin's head, turned so its corner points down, and the photo in it upright.
      const face = document.createElement('span');
      face.className = 'scenic-pin__face';
      const pic = document.createElement('span');
      pic.className = `scenic-pin__photo scenic-art--${spot.region}`;
      if (spot.photo) pic.style.backgroundImage = `url("${spot.photo}")`;
      else
        pic.textContent =
          spot.name.replace(/^(Miradouro|Farol|Teleférico) (d[aoe]s? )?/, '')[0] ?? '';
      face.append(pic);
      const name = document.createElement('span');
      name.className = 'scenic-pin__name';
      name.textContent = spot.name;
      const dot = document.createElement('span');
      dot.className = `scenic-pin__dot scenic-art--${spot.region}`;
      el.append(face, name, dot);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(`explore/${spot.id}`);
      });
      return new Marker({ element: el, anchor: 'bottom' })
        .setLngLat([spot.lon, spot.lat])
        .addTo(map);
    });
    // Far out only those that do not crowd the ones before them, the rest as little dots
    // until one zooms in.
    const layout = () => {
      const zoom = map.getZoom();
      const size = scenicSize(zoom);
      const shown: { x: number; y: number }[] = [];
      markers.forEach((m) => {
        const el = m.getElement();
        el.style.setProperty('--pin-size', `${size}px`);
        el.classList.toggle('scenic-pin--named', zoom >= 10.5);
        const p = map.project(m.getLngLat());
        const free = shown.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > size * 1.15);
        el.classList.toggle('scenic-pin--dot', !free);
        if (free) shown.push(p);
      });
    };
    layout();
    map.on('zoomend', layout);
    map.on('moveend', layout);
    return () => {
      map.off('zoomend', layout);
      map.off('moveend', layout);
      for (const m of markers) m.remove();
    };
  }, [mapRef, ready, spots]);
}

/** Opens the planner keeping whatever origin/destination is already set. */
function planWith(patch: Record<string, string>) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const current = path.startsWith('plan') ? Object.fromEntries(new URLSearchParams(query)) : {};
  navigate('plan', { ...current, ...patch, i: undefined });
}

/**
 * A point chosen on the map goes to the screen that asked: a place's page, a bus's trip, or
 * the planner.
 */
function pickInto(field: PickField, value: string) {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (!path.startsWith('explore/') && !path.startsWith('ride/')) {
    return planWith({ [field]: value });
  }
  navigate(path, {
    ...Object.fromEntries(new URLSearchParams(query)),
    [field]: value,
    i: undefined,
  });
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
  // Clear of the buttons down the right side, of the pin's height at the top and, on a
  // phone, of the sheet over the map's bottom.
  const sheet = parseFloat(
    getComputedStyle(map.getContainer()).getPropertyValue('--map-bottom-inset'),
  );
  const room = map.getContainer().clientHeight;
  // A phone on its side has little height: smaller margins, for a larger island. At the
  // top, clear of the buttons there and of the pin and flags standing up from the stops.
  const low = room < 420;
  const top = low ? 56 : 92;
  const bottom = (low ? 16 : 40) + (Number.isFinite(sheet) ? sheet : 0);
  map.fitBounds(bounds, {
    padding: {
      top,
      bottom: Math.min(bottom, Math.max(40, room - top - 80)),
      left: 40,
      right: 64,
    },
    maxZoom: 15.5,
    duration,
  });
}

function apply(map: MapLibreMap, content: MapContent, fit: { current: Fit }) {
  addPlates(map, content);
  addStopDots(map, content);
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
