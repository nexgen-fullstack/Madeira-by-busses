import { describe, expect, it } from 'vitest';
import {
  cumulativeDistances,
  decodePolyline,
  encodePolyline,
  GridIndex,
  haversine,
  pointAlong,
  projectOnPolyline,
  slicePolyline,
  walkSeconds,
} from './geo.ts';

describe('geo', () => {
  it('computes great-circle distances', () => {
    // Funchal marina → airport is roughly 13 km as the crow flies.
    const d = haversine({ lat: 32.6469, lon: -16.9086 }, { lat: 32.6941, lon: -16.7745 });
    expect(d).toBeGreaterThan(12_500);
    expect(d).toBeLessThan(14_000);
  });

  it('round-trips encoded polylines', () => {
    const pts = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    // Reference value from Google's documentation.
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });

  it('projects points onto a polyline', () => {
    const line = [
      { lat: 32.65, lon: -16.95 },
      { lat: 32.65, lon: -16.94 },
      { lat: 32.66, lon: -16.94 },
    ];
    const cum = cumulativeDistances(line);
    const pr = projectOnPolyline(line, cum, { lat: 32.6505, lon: -16.945 });
    expect(pr.segment).toBe(0);
    expect(pr.along).toBeCloseTo(cum[1]! / 2, -1);
    expect(pr.offset).toBeGreaterThan(40);
    expect(pr.offset).toBeLessThan(70);
    const mid = pointAlong(line, cum, cum[1]! + 100);
    expect(mid.lon).toBeCloseTo(-16.94, 6);
    expect(mid.lat).toBeGreaterThan(32.65);
  });

  it('finds nearby points with the grid index', () => {
    const pts = [
      { lat: 32.65, lon: -16.95 },
      { lat: 32.651, lon: -16.95 },
      { lat: 32.7, lon: -16.95 },
    ];
    const grid = new GridIndex(pts);
    expect(grid.within({ lat: 32.6501, lon: -16.95 }, 300).map((h) => h.index)).toEqual([0, 1]);
    expect(grid.nearest({ lat: 32.69, lon: -16.95 }, 1)[0]!.index).toBe(2);
  });

  it('makes uphill walks slower than downhill ones', () => {
    const flat = walkSeconds(500, 1.25);
    const up = walkSeconds(500, 1.25, 0, 100);
    const down = walkSeconds(500, 1.25, 100, 0);
    expect(up).toBeGreaterThan(flat * 1.5);
    expect(down).toBeLessThan(up);
    expect(flat).toBe(500);
  });
});

describe('slicePolyline', () => {
  it('cuts a polyline between two distances', () => {
    const line = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0, lon: 0.02 },
    ];
    const cum = cumulativeDistances(line);
    const part = slicePolyline(line, cum, cum[1]! / 2, cum[1]! * 1.5);
    expect(part).toHaveLength(3);
    expect(part[0]!.lon).toBeCloseTo(0.005, 6);
    expect(part[1]).toEqual(line[1]);
    expect(part[2]!.lon).toBeCloseTo(0.015, 6);
  });
});
