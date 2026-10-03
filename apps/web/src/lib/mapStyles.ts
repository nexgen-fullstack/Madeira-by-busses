import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { Lang } from '../i18n.ts';

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

/** Human label for an OpenMapTiles POI class/subclass, in every app language. */
// prettier-ignore
const POI_LABELS: Record<string, Record<Lang, string>> = {
  town: { uk: 'Місто', en: 'Town', pt: 'Cidade', es: 'Ciudad', fr: 'Ville', it: 'Città', de: 'Stadt', cs: 'Město', pl: 'Miasto', ru: 'Город' },
  village: { uk: 'Селище', en: 'Village', pt: 'Localidade', es: 'Pueblo', fr: 'Village', it: 'Paese', de: 'Ort', cs: 'Obec', pl: 'Miejscowość', ru: 'Посёлок' },
  locality: { uk: 'Місцевість', en: 'Locality', pt: 'Sítio', es: 'Paraje', fr: 'Lieu-dit', it: 'Località', de: 'Ortsteil', cs: 'Místo', pl: 'Okolica', ru: 'Местность' },
  cable_car: { uk: 'Канатна дорога', en: 'Cable car', pt: 'Teleférico', es: 'Teleférico', fr: 'Téléphérique', it: 'Funivia', de: 'Seilbahn', cs: 'Lanovka', pl: 'Kolejka linowa', ru: 'Канатная дорога' },
  marketplace: { uk: 'Ринок', en: 'Market', pt: 'Mercado', es: 'Mercado', fr: 'Marché', it: 'Mercato', de: 'Markt', cs: 'Tržnice', pl: 'Targ', ru: 'Рынок' },
  mall: { uk: 'Торговий центр', en: 'Shopping centre', pt: 'Centro comercial', es: 'Centro comercial', fr: 'Centre commercial', it: 'Centro commerciale', de: 'Einkaufszentrum', cs: 'Obchodní centrum', pl: 'Centrum handlowe', ru: 'Торговый центр' },
  peak: { uk: 'Вершина', en: 'Peak', pt: 'Pico', es: 'Pico', fr: 'Sommet', it: 'Vetta', de: 'Gipfel', cs: 'Vrchol', pl: 'Szczyt', ru: 'Вершина' },
  nature: { uk: 'Природа', en: 'Nature', pt: 'Natureza', es: 'Naturaleza', fr: 'Nature', it: 'Natura', de: 'Natur', cs: 'Příroda', pl: 'Przyroda', ru: 'Природа' },
  trailhead: { uk: 'Початок стежки', en: 'Trailhead', pt: 'Início de trilho', es: 'Inicio de sendero', fr: 'Départ de sentier', it: 'Inizio sentiero', de: 'Wanderweg-Start', cs: 'Začátek stezky', pl: 'Początek szlaku', ru: 'Начало тропы' },
  historic: { uk: 'Пам’ятка', en: 'Landmark', pt: 'Monumento', es: 'Monumento', fr: 'Monument', it: 'Monumento', de: 'Sehenswürdigkeit', cs: 'Památka', pl: 'Zabytek', ru: 'Достопримечательность' },
  hospital: { uk: 'Лікарня', en: 'Hospital', pt: 'Hospital', es: 'Hospital', fr: 'Hôpital', it: 'Ospedale', de: 'Krankenhaus', cs: 'Nemocnice', pl: 'Szpital', ru: 'Больница' },
  pharmacy: { uk: 'Аптека', en: 'Pharmacy', pt: 'Farmácia', es: 'Farmacia', fr: 'Pharmacie', it: 'Farmacia', de: 'Apotheke', cs: 'Lékárna', pl: 'Apteka', ru: 'Аптека' },
  school: { uk: 'Школа', en: 'School', pt: 'Escola', es: 'Escuela', fr: 'École', it: 'Scuola', de: 'Schule', cs: 'Škola', pl: 'Szkoła', ru: 'Школа' },
  college: { uk: 'Навчальний заклад', en: 'College', pt: 'Ensino', es: 'Centro educativo', fr: 'Établissement d’enseignement', it: 'Istituto', de: 'Hochschule', cs: 'Vysoká škola', pl: 'Uczelnia', ru: 'Учебное заведение' },
  bank: { uk: 'Банк', en: 'Bank', pt: 'Banco', es: 'Banco', fr: 'Banque', it: 'Banca', de: 'Bank', cs: 'Banka', pl: 'Bank', ru: 'Банк' },
  atm: { uk: 'Банкомат', en: 'ATM', pt: 'Multibanco', es: 'Cajero', fr: 'Distributeur', it: 'Bancomat', de: 'Geldautomat', cs: 'Bankomat', pl: 'Bankomat', ru: 'Банкомат' },
  lodging: { uk: 'Житло', en: 'Accommodation', pt: 'Alojamento', es: 'Alojamiento', fr: 'Hébergement', it: 'Alloggio', de: 'Unterkunft', cs: 'Ubytování', pl: 'Nocleg', ru: 'Жильё' },
  hotel: { uk: 'Готель', en: 'Hotel', pt: 'Hotel', es: 'Hotel', fr: 'Hôtel', it: 'Hotel', de: 'Hotel', cs: 'Hotel', pl: 'Hotel', ru: 'Отель' },
  restaurant: { uk: 'Ресторан', en: 'Restaurant', pt: 'Restaurante', es: 'Restaurante', fr: 'Restaurant', it: 'Ristorante', de: 'Restaurant', cs: 'Restaurace', pl: 'Restauracja', ru: 'Ресторан' },
  cafe: { uk: 'Кафе', en: 'Café', pt: 'Café', es: 'Cafetería', fr: 'Café', it: 'Caffè', de: 'Café', cs: 'Kavárna', pl: 'Kawiarnia', ru: 'Кафе' },
  bar: { uk: 'Бар', en: 'Bar', pt: 'Bar', es: 'Bar', fr: 'Bar', it: 'Bar', de: 'Bar', cs: 'Bar', pl: 'Bar', ru: 'Бар' },
  fast_food: { uk: 'Фастфуд', en: 'Fast food', pt: 'Comida rápida', es: 'Comida rápida', fr: 'Restauration rapide', it: 'Fast food', de: 'Schnellimbiss', cs: 'Rychlé občerstvení', pl: 'Fast food', ru: 'Фастфуд' },
  shop: { uk: 'Магазин', en: 'Shop', pt: 'Loja', es: 'Tienda', fr: 'Magasin', it: 'Negozio', de: 'Geschäft', cs: 'Obchod', pl: 'Sklep', ru: 'Магазин' },
  grocery: { uk: 'Продукти', en: 'Grocery', pt: 'Mercearia', es: 'Alimentación', fr: 'Épicerie', it: 'Alimentari', de: 'Lebensmittel', cs: 'Potraviny', pl: 'Sklep spożywczy', ru: 'Продукты' },
  supermarket: { uk: 'Супермаркет', en: 'Supermarket', pt: 'Supermercado', es: 'Supermercado', fr: 'Supermarché', it: 'Supermercato', de: 'Supermarkt', cs: 'Supermarket', pl: 'Supermarket', ru: 'Супермаркет' },
  town_hall: { uk: 'Ратуша', en: 'Town hall', pt: 'Câmara Municipal', es: 'Ayuntamiento', fr: 'Mairie', it: 'Municipio', de: 'Rathaus', cs: 'Radnice', pl: 'Ratusz', ru: 'Мэрия' },
  police: { uk: 'Поліція', en: 'Police', pt: 'Polícia', es: 'Policía', fr: 'Police', it: 'Polizia', de: 'Polizei', cs: 'Policie', pl: 'Policja', ru: 'Полиция' },
  post: { uk: 'Пошта', en: 'Post office', pt: 'Correios', es: 'Correos', fr: 'Poste', it: 'Posta', de: 'Post', cs: 'Pošta', pl: 'Poczta', ru: 'Почта' },
  museum: { uk: 'Музей', en: 'Museum', pt: 'Museu', es: 'Museo', fr: 'Musée', it: 'Museo', de: 'Museum', cs: 'Muzeum', pl: 'Muzeum', ru: 'Музей' },
  attraction: { uk: 'Пам’ятка', en: 'Attraction', pt: 'Atração', es: 'Atracción', fr: 'Attraction', it: 'Attrazione', de: 'Sehenswürdigkeit', cs: 'Atrakce', pl: 'Atrakcja', ru: 'Достопримечательность' },
  place_of_worship: { uk: 'Храм', en: 'Place of worship', pt: 'Igreja', es: 'Lugar de culto', fr: 'Lieu de culte', it: 'Luogo di culto', de: 'Gotteshaus', cs: 'Kostel', pl: 'Świątynia', ru: 'Храм' },
  bus: { uk: 'Зупинка', en: 'Bus stop', pt: 'Paragem', es: 'Parada de autobús', fr: 'Arrêt de bus', it: 'Fermata', de: 'Bushaltestelle', cs: 'Zastávka', pl: 'Przystanek', ru: 'Остановка' },
  fuel: { uk: 'АЗС', en: 'Fuel', pt: 'Combustível', es: 'Gasolinera', fr: 'Station-service', it: 'Distributore', de: 'Tankstelle', cs: 'Čerpací stanice', pl: 'Stacja paliw', ru: 'АЗС' },
  parking: { uk: 'Паркінг', en: 'Parking', pt: 'Estacionamento', es: 'Aparcamiento', fr: 'Parking', it: 'Parcheggio', de: 'Parkplatz', cs: 'Parkoviště', pl: 'Parking', ru: 'Парковка' },
  park: { uk: 'Парк', en: 'Park', pt: 'Parque', es: 'Parque', fr: 'Parc', it: 'Parco', de: 'Park', cs: 'Park', pl: 'Park', ru: 'Парк' },
  beach: { uk: 'Пляж', en: 'Beach', pt: 'Praia', es: 'Playa', fr: 'Plage', it: 'Spiaggia', de: 'Strand', cs: 'Pláž', pl: 'Plaża', ru: 'Пляж' },
  aerodrome: { uk: 'Аеропорт', en: 'Airport', pt: 'Aeroporto', es: 'Aeropuerto', fr: 'Aéroport', it: 'Aeroporto', de: 'Flughafen', cs: 'Letiště', pl: 'Lotnisko', ru: 'Аэропорт' },
  harbor: { uk: 'Порт', en: 'Harbour', pt: 'Porto', es: 'Puerto', fr: 'Port', it: 'Porto', de: 'Hafen', cs: 'Přístav', pl: 'Port', ru: 'Порт' },
  ferry_terminal: { uk: 'Пором', en: 'Ferry', pt: 'Ferry', es: 'Ferry', fr: 'Ferry', it: 'Traghetto', de: 'Fähre', cs: 'Trajekt', pl: 'Prom', ru: 'Паром' },
  doctors: { uk: 'Лікар', en: 'Doctor', pt: 'Médico', es: 'Médico', fr: 'Médecin', it: 'Medico', de: 'Arztpraxis', cs: 'Lékař', pl: 'Lekarz', ru: 'Врач' },
  dentist: { uk: 'Стоматолог', en: 'Dentist', pt: 'Dentista', es: 'Dentista', fr: 'Dentiste', it: 'Dentista', de: 'Zahnarzt', cs: 'Zubař', pl: 'Dentysta', ru: 'Стоматолог' },
  library: { uk: 'Бібліотека', en: 'Library', pt: 'Biblioteca', es: 'Biblioteca', fr: 'Bibliothèque', it: 'Biblioteca', de: 'Bibliothek', cs: 'Knihovna', pl: 'Biblioteka', ru: 'Библиотека' },
  cinema: { uk: 'Кінотеатр', en: 'Cinema', pt: 'Cinema', es: 'Cine', fr: 'Cinéma', it: 'Cinema', de: 'Kino', cs: 'Kino', pl: 'Kino', ru: 'Кинотеатр' },
  theatre: { uk: 'Театр', en: 'Theatre', pt: 'Teatro', es: 'Teatro', fr: 'Théâtre', it: 'Teatro', de: 'Theater', cs: 'Divadlo', pl: 'Teatr', ru: 'Театр' },
  stadium: { uk: 'Стадіон', en: 'Stadium', pt: 'Estádio', es: 'Estadio', fr: 'Stade', it: 'Stadio', de: 'Stadion', cs: 'Stadion', pl: 'Stadion', ru: 'Стадион' },
  viewpoint: { uk: 'Оглядовий майданчик', en: 'Viewpoint', pt: 'Miradouro', es: 'Mirador', fr: 'Point de vue', it: 'Belvedere', de: 'Aussichtspunkt', cs: 'Vyhlídka', pl: 'Punkt widokowy', ru: 'Смотровая площадка' },
};

/** A place's name in the reader's language when OpenStreetMap has one. */
export function placeName(place: { name: string; names?: Record<string, string> }, lang: Lang) {
  return place.names?.[lang] ?? place.name;
}

export function poiLabel(lang: Lang, klass?: string, subclass?: string): string | undefined {
  const hit = (subclass && POI_LABELS[subclass]) || (klass && POI_LABELS[klass]);
  if (hit) return hit[lang];
  const raw = subclass || klass;
  return raw ? raw.replaceAll('_', ' ') : undefined;
}
