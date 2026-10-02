import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * Map styles and layers.
 *
 * - "map": OpenFreeMap Liberty (OpenStreetMap data): streets, buildings,
 *   shops and institutions with their names.
 * - "satellite": aerial imagery with the same labels, roads and places on top
 *   (a "hybrid" view like in Google Maps).
 * - "relief": a physical map of the island coloured by elevation with hill
 *   shading — useful on mountainous Madeira — plus the same labels.
 *
 * Overlays (3D buildings, places, 3D terrain) are toggled on whatever base is
 * shown. Every style degrades gracefully: without the vector tiles (offline,
 * blocked network) the relief layers still draw the island.
 */

export type BaseLayer = 'map' | 'satellite' | 'relief';

export interface MapLayers {
  base: BaseLayer;
  buildings3d: boolean;
  places: boolean;
  terrain3d: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  base: 'map',
  buildings3d: false,
  places: true,
  terrain3d: false,
};

const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Imagery tiles; override with VITE_SATELLITE_TILES (e.g. a MapTiler or Esri key for production). */
export const SATELLITE_TILES: string =
  import.meta.env.VITE_SATELLITE_TILES ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION =
  import.meta.env.VITE_SATELLITE_ATTRIBUTION ||
  'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

/** Open elevation tiles (Terrain Tiles on AWS Open Data, Terrarium encoding). */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRAIN_ATTRIBUTION =
  'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (SRTM, EU-DEM and others)';

const SEA = '#a8d1e7';

export function demSource(): SourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [TERRAIN_TILES],
    tileSize: 256,
    maxzoom: 14,
    encoding: 'terrarium',
    attribution: TERRAIN_ATTRIBUTION,
  };
}

/** Elevation-tinted land, sea and hill shading. */
function reliefLayers(): LayerSpecification[] {
  return [
    { id: 'mb-background', type: 'background', paint: { 'background-color': SEA } },
    {
      id: 'mb-relief',
      type: 'color-relief',
      source: 'mb-dem',
      paint: {
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          -50,
          SEA,
          0,
          SEA,
          1,
          '#cfe5c0',
          250,
          '#d7e4b0',
          700,
          '#e3d9a6',
          1200,
          '#d6c19c',
          1600,
          '#c9b9a8',
          1862,
          '#f3efe8',
        ],
      },
    },
    {
      id: 'mb-hillshade',
      type: 'hillshade',
      source: 'mb-dem-shade',
      paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#3d4a3a' },
    },
    {
      // Flat sea on top: hill shading of the sea floor only adds noise.
      id: 'mb-sea',
      type: 'color-relief',
      source: 'mb-dem',
      paint: {
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          -100,
          SEA,
          0,
          SEA,
          0.5,
          'rgba(168, 209, 231, 0)',
        ],
      },
    },
  ];
}

function satelliteLayers(): LayerSpecification[] {
  return [
    { id: 'mb-background', type: 'background', paint: { 'background-color': '#1d2a33' } },
    { id: 'mb-satellite', type: 'raster', source: 'mb-satellite' },
  ];
}

function baseSources(base: BaseLayer): Record<string, SourceSpecification> {
  if (base === 'satellite') {
    return {
      'mb-satellite': {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: SATELLITE_ATTRIBUTION,
      },
    };
  }
  return { 'mb-dem': demSource(), 'mb-dem-shade': demSource() };
}

/** Style used when the vector tiles can't be loaded: still a readable island. */
export function fallbackStyle(base: BaseLayer): StyleSpecification {
  return {
    version: 8,
    sources: baseSources(base === 'map' ? 'relief' : base),
    layers: base === 'satellite' ? satelliteLayers() : reliefLayers(),
  };
}

const sourceLayer = (l: LayerSpecification): string | undefined =>
  'source-layer' in l ? (l['source-layer'] as string | undefined) : undefined;

/**
 * Puts the labels, roads, places and buildings of a vector style on top of
 * imagery or relief. Fills (land use, water, parks) are dropped so the base
 * shows through; on imagery, text switches to white with a dark halo.
 */
export function overlayVector(
  vector: StyleSpecification,
  base: Exclude<BaseLayer, 'map'>,
): StyleSpecification {
  const keepLines = new Set(['transportation', 'boundary', 'aeroway']);
  const kept: LayerSpecification[] = [];
  for (const layer of vector.layers) {
    if (layer.type === 'symbol' || layer.type === 'fill-extrusion') {
      kept.push(base === 'satellite' && layer.type === 'symbol' ? brightText(layer) : layer);
    } else if (layer.type === 'line' && keepLines.has(sourceLayer(layer) ?? '')) {
      kept.push({
        ...layer,
        paint: { ...layer.paint, 'line-opacity': base === 'satellite' ? 0.45 : 0.7 },
      } as LayerSpecification);
    } else if (layer.type === 'fill' && sourceLayer(layer) === 'building' && base === 'relief') {
      kept.push(layer);
    }
  }
  return {
    ...vector,
    sources: { ...vector.sources, ...baseSources(base) },
    layers: [...(base === 'satellite' ? satelliteLayers() : reliefLayers()), ...kept],
  };
}

function brightText(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol') return layer;
  return {
    ...layer,
    paint: {
      ...layer.paint,
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0, 0, 0, 0.8)',
      'text-halo-width': 1.4,
    },
  };
}

let vectorStyle: Promise<StyleSpecification> | undefined;

async function fetchVectorStyle(): Promise<StyleSpecification> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(VECTOR_STYLE, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as StyleSpecification;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves the full style for a base layer, falling back to tile-free layers. */
export async function loadStyle(
  base: BaseLayer,
): Promise<{ style: StyleSpecification; vector: boolean }> {
  try {
    vectorStyle ??= fetchVectorStyle();
    const vector = await vectorStyle;
    return { style: base === 'map' ? vector : overlayVector(vector, base), vector: true };
  } catch {
    vectorStyle = undefined; // retry next time (e.g. when back online)
    return { style: fallbackStyle(base), vector: false };
  }
}

/** Ids of style layers showing shops, services and institutions. */
export function placeLayerIds(style: StyleSpecification): string[] {
  return style.layers.filter((l) => sourceLayer(l) === 'poi').map((l) => l.id);
}

/** The vector source and existing 3D layers for buildings, if the style has them. */
export function buildingLayers(style: StyleSpecification): {
  source?: string;
  extrusions: string[];
} {
  let source: string | undefined;
  const extrusions: string[] = [];
  for (const l of style.layers) {
    if (sourceLayer(l) !== 'building') continue;
    source ??= 'source' in l ? (l.source as string) : undefined;
    if (l.type === 'fill-extrusion') extrusions.push(l.id);
  }
  return { source, extrusions };
}

/** A 3D buildings layer for styles that only draw flat footprints. */
export function extrusionLayer(source: string, satellite: boolean): LayerSpecification {
  return {
    id: 'mb-buildings-3d',
    type: 'fill-extrusion',
    source,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': satellite ? '#e9e4da' : '#d9d3c8',
      'fill-extrusion-opacity': satellite ? 0.75 : 0.85,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
    },
  };
}

/** Human label for an OpenMapTiles POI class/subclass. */
const POI_LABELS: Record<string, Record<'uk' | 'pt' | 'en', string>> = {
  hospital: { uk: 'Лікарня', pt: 'Hospital', en: 'Hospital' },
  pharmacy: { uk: 'Аптека', pt: 'Farmácia', en: 'Pharmacy' },
  school: { uk: 'Школа', pt: 'Escola', en: 'School' },
  college: { uk: 'Навчальний заклад', pt: 'Ensino', en: 'College' },
  bank: { uk: 'Банк', pt: 'Banco', en: 'Bank' },
  atm: { uk: 'Банкомат', pt: 'Multibanco', en: 'ATM' },
  lodging: { uk: 'Готель', pt: 'Alojamento', en: 'Hotel' },
  hotel: { uk: 'Готель', pt: 'Hotel', en: 'Hotel' },
  restaurant: { uk: 'Ресторан', pt: 'Restaurante', en: 'Restaurant' },
  cafe: { uk: 'Кафе', pt: 'Café', en: 'Café' },
  bar: { uk: 'Бар', pt: 'Bar', en: 'Bar' },
  fast_food: { uk: 'Фастфуд', pt: 'Comida rápida', en: 'Fast food' },
  shop: { uk: 'Магазин', pt: 'Loja', en: 'Shop' },
  grocery: { uk: 'Продукти', pt: 'Mercearia', en: 'Grocery' },
  supermarket: { uk: 'Супермаркет', pt: 'Supermercado', en: 'Supermarket' },
  town_hall: { uk: 'Ратуша', pt: 'Câmara Municipal', en: 'Town hall' },
  police: { uk: 'Поліція', pt: 'Polícia', en: 'Police' },
  post: { uk: 'Пошта', pt: 'Correios', en: 'Post office' },
  museum: { uk: 'Музей', pt: 'Museu', en: 'Museum' },
  attraction: { uk: 'Пам’ятка', pt: 'Atração', en: 'Attraction' },
  place_of_worship: { uk: 'Храм', pt: 'Igreja', en: 'Place of worship' },
  bus: { uk: 'Зупинка', pt: 'Paragem', en: 'Bus stop' },
  fuel: { uk: 'АЗС', pt: 'Combustível', en: 'Fuel' },
  parking: { uk: 'Паркінг', pt: 'Estacionamento', en: 'Parking' },
  park: { uk: 'Парк', pt: 'Parque', en: 'Park' },
  beach: { uk: 'Пляж', pt: 'Praia', en: 'Beach' },
  aerodrome: { uk: 'Аеропорт', pt: 'Aeroporto', en: 'Airport' },
  harbor: { uk: 'Порт', pt: 'Porto', en: 'Harbour' },
  ferry_terminal: { uk: 'Пором', pt: 'Ferry', en: 'Ferry' },
  doctors: { uk: 'Лікар', pt: 'Médico', en: 'Doctor' },
  dentist: { uk: 'Стоматолог', pt: 'Dentista', en: 'Dentist' },
  library: { uk: 'Бібліотека', pt: 'Biblioteca', en: 'Library' },
  cinema: { uk: 'Кіно', pt: 'Cinema', en: 'Cinema' },
  theatre: { uk: 'Театр', pt: 'Teatro', en: 'Theatre' },
  stadium: { uk: 'Стадіон', pt: 'Estádio', en: 'Stadium' },
  viewpoint: { uk: 'Оглядовий майданчик', pt: 'Miradouro', en: 'Viewpoint' },
};

export function poiLabel(
  lang: 'uk' | 'pt' | 'en',
  klass?: string,
  subclass?: string,
): string | undefined {
  const hit = (subclass && POI_LABELS[subclass]) || (klass && POI_LABELS[klass]);
  if (hit) return hit[lang];
  const raw = subclass || klass;
  return raw ? raw.replaceAll('_', ' ') : undefined;
}
