import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { haversine, type LatLon, type WalkGraphData } from '@madeirabus/engine';

/**
 * How much each walkable way climbs, from the free elevation tiles the app already
 * draws its 3D mountains with (AWS Terrain Tiles, "terrarium" PNGs; mostly SRTM's
 * 30 m model on Madeira), so a walk up from Bairro do Hospital is known to be one;
 * and which ways have a view (along the sea, a promenade, past a viewpoint).
 */

/** Zoom of the tiles read: 16 m a pixel on Madeira, finer than the model under them. */
export const TERRAIN_ZOOM = 13;
const TILE = 256;
const TILES_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/** A PNG's pixels: 8-bit RGB or RGBA, not interlaced (as the elevation tiles are). */
export function decodePng(bytes: Uint8Array): {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const kind = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) {
    throw new Error(`Unsupported PNG (depth ${depth}, colour type ${type})`);
  }
  const channels = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = data.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 255;
    }
    prev = out;
  }
  return { width, height, channels, data };
}

/** Metres above the sea of each pixel of a terrarium tile. */
export function terrariumHeights(png: Uint8Array): Float32Array {
  const { width, height, channels, data } = decodePng(png);
  if (width !== TILE || height !== TILE) throw new Error('Not a 256 px tile');
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) {
    const r = data[i * channels]!;
    const g = data[i * channels + 1]!;
    const b = data[i * channels + 2]!;
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/** Pixel position of a point at a zoom, in the world of 256 px tiles. */
function pixel(p: LatLon, z: number): { x: number; y: number } {
  const n = 2 ** z * TILE;
  const r = (p.lat * Math.PI) / 180;
  return {
    x: ((p.lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

/** The tiles covering some points (with a margin of a pixel). */
export function tilesFor(points: Iterable<LatLon>, z = TERRAIN_ZOOM): { x: number; y: number }[] {
  const keys = new Map<string, { x: number; y: number }>();
  for (const p of points) {
    const { x, y } = pixel(p, z);
    for (const dx of [-1, 1])
      for (const dy of [-1, 1]) {
        const t = { x: Math.floor((x + dx) / TILE), y: Math.floor((y + dy) / TILE) };
        keys.set(`${t.x}/${t.y}`, t);
      }
  }
  return [...keys.values()];
}

/** The ground's height anywhere on the tiles read, between their pixels. */
export class Terrain {
  constructor(
    private readonly tiles: ReadonlyMap<string, Float32Array>,
    private readonly z = TERRAIN_ZOOM,
  ) {}

  /** Metres above the sea (the sea at 0), or undefined off the tiles. */
  at(p: LatLon): number | undefined {
    const { x, y } = pixel(p, this.z);
    // Between the centres of the four pixels around the point.
    const x0 = Math.floor(x - 0.5);
    const y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0;
    const fy = y - 0.5 - y0;
    const h = (px: number, py: number) => {
      const tile = this.tiles.get(`${Math.floor(px / TILE)}/${Math.floor(py / TILE)}`);
      const v = tile?.[(((py % TILE) + TILE) % TILE) * TILE + (((px % TILE) + TILE) % TILE)];
      return v === undefined ? undefined : Math.max(0, v);
    };
    const a = h(x0, y0);
    const b = h(x0 + 1, y0);
    const c = h(x0, y0 + 1);
    const d = h(x0 + 1, y0 + 1);
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      return a ?? b ?? c ?? d;
    }
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

/** Reads the tiles from `dir`, fetching the ones not there yet. */
export async function loadTerrain(
  dir: string,
  tiles: readonly { x: number; y: number }[],
  z = TERRAIN_ZOOM,
): Promise<{ terrain: Terrain; fetched: number; bytes: number }> {
  const read = new Map<string, Float32Array>();
  let fetched = 0;
  let bytes = 0;
  for (const t of tiles) {
    const file = join(dir, String(z), String(t.x), `${t.y}.png`);
    if (!existsSync(file)) {
      const res = await fetch(`${TILES_URL}/${z}/${t.x}/${t.y}.png`);
      if (!res.ok) throw new Error(`Elevation tile ${z}/${t.x}/${t.y}: HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buf);
      fetched++;
      bytes += buf.length;
    }
    read.set(`${t.x}/${t.y}`, terrariumHeights(new Uint8Array(await readFile(file))));
  }
  return { terrain: new Terrain(read, z), fetched, bytes };
}

/** Points along a polyline every `step` metres (its ends included). */
export function resample(points: readonly LatLon[], step: number): LatLon[] {
  const out: LatLon[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = haversine(a, b);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
    }
  }
  return out;
}

/** Metres between samples of a way's height. */
const STEP = 15;
/** A change smaller than this (m) is the model's noise, not a slope. */
const NOISE = 3;

/**
 * Metres climbed along a way and gone down, from its first point to its last. Over a
 * bridge or through a tunnel (`level` says where) the way runs straight between its
 * ends, not down into the ravine or up over the hill above it.
 */
export function climbOf(
  points: readonly LatLon[],
  terrain: Terrain,
  level?: (p: LatLon) => boolean,
): { up: number; down: number } {
  const samples = resample(points, STEP);
  const heights = samples.map((p) => (level?.(p) ? undefined : terrain.at(p)));
  // Unknown heights (bridges, tunnels, off the tiles): straight between the known ones.
  const known = heights.flatMap((h, i) => (h === undefined ? [] : [i]));
  if (known.length === 0) return { up: 0, down: 0 };
  const filled = heights.map((h, i) => {
    if (h !== undefined) return h;
    const after = known.find((k) => k > i);
    const before = [...known].reverse().find((k) => k < i);
    if (before === undefined) return heights[after!]!;
    if (after === undefined) return heights[before]!;
    return (
      heights[before]! + ((heights[after]! - heights[before]!) * (i - before)) / (after - before)
    );
  });
  let up = 0;
  let down = 0;
  let anchor = filled[0]!;
  for (const h of filled.slice(1)) {
    if (h - anchor >= NOISE) {
      up += h - anchor;
      anchor = h;
    } else if (anchor - h >= NOISE) {
      down += anchor - h;
      anchor = h;
    }
  }
  const rest = filled[filled.length - 1]! - anchor;
  if (rest > 0) up += rest;
  else down -= rest;
  return { up: Math.round(up), down: Math.round(down) };
}

/** Segments in a grid, to tell how near a point is to any of them. */
export class SegmentIndex {
  private readonly cells = new Map<string, [LatLon, LatLon][]>();
  private static readonly CELL = 0.002;

  constructor(lines: readonly (readonly LatLon[])[]) {
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const c = SegmentIndex.CELL;
        for (
          let y = Math.floor(Math.min(a.lat, b.lat) / c);
          y <= Math.floor(Math.max(a.lat, b.lat) / c);
          y++
        )
          for (
            let x = Math.floor(Math.min(a.lon, b.lon) / c);
            x <= Math.floor(Math.max(a.lon, b.lon) / c);
            x++
          ) {
            const key = `${y}:${x}`;
            const list = this.cells.get(key);
            if (list) list.push([a, b]);
            else this.cells.set(key, [[a, b]]);
          }
      }
    }
  }

  /** Whether a point is within `max` metres (at most ~200) of a segment. */
  near(p: LatLon, max: number): boolean {
    const c = SegmentIndex.CELL;
    const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
    const ky = 110_540;
    const cy = Math.floor(p.lat / c);
    const cx = Math.floor(p.lon / c);
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++)
        for (const [a, b] of this.cells.get(`${y}:${x}`) ?? []) {
          const ax = (a.lon - p.lon) * kx;
          const ay = (a.lat - p.lat) * ky;
          const dx = (b.lon - a.lon) * kx;
          const dy = (b.lat - a.lat) * ky;
          const len = dx * dx + dy * dy;
          const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
          if (Math.hypot(ax + t * dx, ay + t * dy) <= max) return true;
        }
    return false;
  }
}

/** Along the sea: this near the coastline (m)… */
const COAST = 70;
/** …or a promenade's way, or past a viewpoint. */
const PROMENADE = 12;
const VIEWPOINT = 40;
/** The share of a way that must be by the sea or on a promenade to count. */
const ALONG = 0.6;

export interface Scenery {
  coast: SegmentIndex;
  promenades: SegmentIndex;
  /** Each viewpoint as a segment of no length. */
  viewpoints: SegmentIndex;
}

/** Whether walking a way has a view: along the sea, on a promenade or past a viewpoint. */
export function hasView(points: readonly LatLon[], scenery: Scenery): boolean {
  const samples = resample(points, 20);
  if (samples.some((p) => scenery.viewpoints.near(p, VIEWPOINT))) return true;
  let along = 0;
  for (const p of samples) {
    if (scenery.coast.near(p, COAST) || scenery.promenades.near(p, PROMENADE)) along++;
  }
  return along >= samples.length * ALONG && haversine(points[0]!, points[points.length - 1]!) > 20;
}

/**
 * The walking network with how much each way climbs and which have a view (both kept in
 * walk.bin for the app).
 */
export function addScenery(
  graph: WalkGraphData,
  terrain: Terrain | undefined,
  scenery: Scenery | undefined,
  level?: (p: LatLon) => boolean,
): { climbing: number; scenic: number } {
  let climbing = 0;
  let scenic = 0;
  for (const e of graph.edges) {
    const points = [graph.nodes[e.from]!, ...e.points, graph.nodes[e.to]!];
    if (terrain) {
      const { up, down } = climbOf(points, terrain, level);
      e.up = up;
      e.down = down;
      if (up + down > 0) climbing++;
    }
    if (scenery && hasView(points, scenery)) {
      e.scenic = true;
      scenic++;
    }
  }
  return { climbing, scenic };
}
