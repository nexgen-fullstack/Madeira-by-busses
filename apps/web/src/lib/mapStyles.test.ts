import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import {
  buildingLayers,
  fallbackStyle,
  overlayVector,
  placeLayerIds,
  poiLabel,
  withHouseNumbers,
  withoutClutter,
} from './mapStyles.ts';

/** A tiny stand-in for the OpenFreeMap Liberty style. */
const VECTOR: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://example.com/planet' } },
  glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
    { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'river', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway' },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
    },
    {
      id: 'poi',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      paint: { 'text-color': '#666' },
    },
    { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
  ],
};

const ids = (s: StyleSpecification) => s.layers.map((l) => l.id);

/** The few expressions the layer filters use, evaluated for a feature's properties. */
function evaluate(e: unknown, props: Record<string, unknown>): unknown {
  if (!Array.isArray(e)) return e;
  const [op, ...args] = e as [string, ...unknown[]];
  const value = (x: unknown) => evaluate(x, props);
  switch (op) {
    case 'all':
      return args.every((a) => value(a) === true);
    case 'any':
      return args.some((a) => value(a) === true);
    case '!':
      return value(args[0]) !== true;
    case 'get':
      return props[args[0] as string];
    case '>=':
      return (value(args[0]) as number) >= (value(args[1]) as number);
    case 'match': {
      const input = value(args[0]);
      for (let i = 1; i + 1 < args.length; i += 2) {
        const labels = args[i];
        if (Array.isArray(labels) ? labels.includes(input) : labels === input) return args[i + 1];
      }
      return args[args.length - 1];
    }
    default:
      throw new Error(`no ${op}`);
  }
}

describe('map styles', () => {
  it('puts labels, roads and buildings over satellite imagery', () => {
    const hybrid = overlayVector(VECTOR, 'satellite');
    expect(ids(hybrid)).toEqual([
      'mb-background',
      'mb-satellite',
      'road',
      'building-3d',
      'poi',
      'place',
    ]);
    expect(hybrid.sources['mb-satellite']).toMatchObject({ type: 'raster' });
    expect(hybrid.glyphs).toBe(VECTOR.glyphs);
    const poi = hybrid.layers.find((l) => l.id === 'poi')!;
    expect(poi.type === 'symbol' && poi.paint?.['text-color']).toBe('#ffffff');
  });

  it('puts the same details over the relief map and keeps building footprints', () => {
    const relief = overlayVector(VECTOR, 'relief');
    expect(ids(relief).slice(0, 5)).toEqual([
      'mb-background',
      'mb-relief',
      'mb-hillshade',
      'mb-sea',
      'building',
    ]);
    expect(relief.sources['mb-dem']).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
  });

  it('adds house numbers under the other labels, also over imagery', () => {
    const style = withHouseNumbers(VECTOR);
    expect(ids(style).slice(-3)).toEqual(['mb-housenumber', 'poi', 'place']);
    expect(style.layers.find((l) => l.id === 'mb-housenumber')).toMatchObject({
      source: 'openmaptiles',
      'source-layer': 'housenumber',
      minzoom: 17,
    });
    expect(withHouseNumbers(style)).toBe(style);
    expect(ids(overlayVector(style, 'satellite'))).toContain('mb-housenumber');
  });

  it('falls back to tile-free styles', () => {
    expect(ids(fallbackStyle('map'))).toContain('mb-relief');
    expect(ids(fallbackStyle('satellite'))).toContain('mb-satellite');
  });

  it('finds place and building layers', () => {
    expect(placeLayerIds(VECTOR)).toEqual(['poi']);
    expect(buildingLayers(VECTOR)).toEqual({ source: 'openmaptiles', extrusions: ['building-3d'] });
    expect(buildingLayers(fallbackStyle('map'))).toEqual({ source: undefined, extrusions: [] });
  });

  it('names places in the user language', () => {
    expect(poiLabel('uk', 'shop', 'pharmacy')).toBe('Аптека');
    expect(poiLabel('pt', 'lodging', 'hotel')).toBe('Hotel');
    expect(poiLabel('en', 'amenity', 'bicycle_rental')).toBe('bicycle rental');
    expect(poiLabel('uk', 'art_gallery', 'gallery')).toBe('Галерея');
    expect(poiLabel('en')).toBeUndefined();
  });

  it('leaves out the icons that only clutter, on every base layer', () => {
    const style = withoutClutter({
      ...VECTOR,
      layers: [
        ...VECTOR.layers,
        {
          id: 'poi_r1',
          type: 'symbol',
          source: 'openmaptiles',
          'source-layer': 'poi',
          filter: ['>=', ['get', 'rank'], 1],
        },
      ],
    });
    const shown = (id: string, properties: Record<string, unknown>) => {
      const layer = style.layers.find((l) => l.id === id)!;
      return evaluate('filter' in layer ? layer.filter : true, properties) === true;
    };
    for (const id of ['poi', 'poi_r1']) {
      // Bins, information boards, statues, pitches, car parks: gone.
      expect(shown(id, { class: 'waste_basket', subclass: 'waste_basket', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'information', subclass: 'board', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'art_gallery', subclass: 'artwork', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'pitch', subclass: 'tennis', rank: 20 })).toBe(false);
      expect(shown(id, { class: 'parking', subclass: 'parking', rank: 20 })).toBe(false);
      // Stops, hotels, cafés, pharmacies, museums, viewpoints, the tourist office: kept.
      expect(shown(id, { class: 'bus', subclass: 'bus_stop', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'lodging', subclass: 'hotel', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'cafe', subclass: 'cafe', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'shop', subclass: 'pharmacy', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'museum', subclass: 'museum', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'attraction', subclass: 'viewpoint', rank: 20 })).toBe(true);
      expect(shown(id, { class: 'information', subclass: 'office', rank: 20 })).toBe(true);
    }
    // The layer's own filter still counts.
    expect(shown('poi_r1', { class: 'cafe', subclass: 'cafe', rank: 0 })).toBe(false);
    // Over imagery too.
    expect(overlayVector(style, 'satellite').layers.find((l) => l.id === 'poi_r1')).toHaveProperty(
      'filter',
    );
  });
});
