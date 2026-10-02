import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import {
  buildingLayers,
  fallbackStyle,
  overlayVector,
  placeLayerIds,
  poiLabel,
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
    expect(poiLabel('en', 'amenity', 'ice_cream')).toBe('ice cream');
    expect(poiLabel('en')).toBeUndefined();
  });
});
