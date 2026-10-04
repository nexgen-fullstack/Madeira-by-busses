/**
 * Reads what a PDF needs from a TrueType font: its metrics, which glyph draws
 * each character and how wide each glyph is. The font file itself is
 * embedded unchanged, so nothing here touches the outlines.
 */
export interface TrueTypeFont {
  readonly data: Uint8Array;
  readonly postScriptName: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly bbox: readonly [number, number, number, number];
  readonly italicAngle: number;
  /** The glyph drawing a code point; 0 (the "missing" box) when the font has none. */
  glyph(codePoint: number): number;
  /** Advance width of a glyph in font units. */
  advance(glyph: number): number;
}

interface TableRecord {
  offset: number;
  length: number;
}

export function parseTrueType(data: Uint8Array): TrueTypeFont {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new Error('Not a TrueType font');
  }
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(data[rec]!, data[rec + 1]!, data[rec + 2]!, data[rec + 3]!);
    tables.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  const table = (tag: string) => {
    const t = tables.get(tag);
    if (!t) throw new Error(`Font has no ${tag} table`);
    return t.offset;
  };

  const head = table('head');
  const unitsPerEm = view.getUint16(head + 18);
  const bbox = [
    view.getInt16(head + 36),
    view.getInt16(head + 38),
    view.getInt16(head + 40),
    view.getInt16(head + 42),
  ] as const;

  const hhea = table('hhea');
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  const longMetrics = view.getUint16(hhea + 34);
  const glyphCount = view.getUint16(table('maxp') + 4);
  const hmtx = table('hmtx');
  const widths = new Uint16Array(glyphCount);
  let width = 0;
  for (let g = 0; g < glyphCount; g++) {
    // Glyphs past the long metrics share the last advance width.
    if (g < longMetrics) width = view.getUint16(hmtx + g * 4);
    widths[g] = width;
  }

  let capHeight = Math.round(ascent * 0.7);
  const os2 = tables.get('OS/2');
  if (os2 && view.getUint16(os2.offset) >= 2) capHeight = view.getInt16(os2.offset + 88);
  const post = tables.get('post');
  const italicAngle = post
    ? view.getInt16(post.offset + 4) + view.getUint16(post.offset + 6) / 65536
    : 0;

  const cmap = readCmap(view, table('cmap'));
  return {
    data,
    postScriptName: readName(view, tables.get('name'), 6) ?? 'Font',
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    bbox,
    italicAngle,
    glyph: (cp) => cmap.get(cp) ?? 0,
    advance: (g) => widths[g] ?? 0,
  };
}

/** Unicode → glyph from the best Unicode subtable (format 12, else format 4). */
function readCmap(view: DataView, cmap: number): Map<number, number> {
  const subtables: { platform: number; encoding: number; offset: number }[] = [];
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    subtables.push({
      platform: view.getUint16(rec),
      encoding: view.getUint16(rec + 2),
      offset: cmap + view.getUint32(rec + 4),
    });
  }
  const unicode = (s: { platform: number; encoding: number }) =>
    s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
  const format = (s: { offset: number }) => view.getUint16(s.offset);
  const best =
    subtables.find((s) => unicode(s) && format(s) === 12) ??
    subtables.find((s) => unicode(s) && format(s) === 4);
  if (!best) throw new Error('Font has no Unicode character map');

  const map = new Map<number, number>();
  const at = best.offset;
  if (format(best) === 12) {
    const groups = view.getUint32(at + 12);
    for (let i = 0; i < groups; i++) {
      const g = at + 16 + i * 12;
      const start = view.getUint32(g);
      const end = view.getUint32(g + 4);
      const glyph = view.getUint32(g + 8);
      for (let c = start; c <= end; c++) map.set(c, glyph + c - start);
    }
    return map;
  }
  const segments = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const end = view.getUint16(ends + s * 2);
    const start = view.getUint16(starts + s * 2);
    const delta = view.getInt16(deltas + s * 2);
    const rangeOffset = view.getUint16(rangeOffsets + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        glyph = view.getUint16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(c, glyph);
    }
  }
  return map;
}

/** A name record (6 = PostScript name), preferring the Windows Unicode one. */
function readName(view: DataView, name: TableRecord | undefined, id: number): string | undefined {
  if (!name) return undefined;
  const at = name.offset;
  const strings = at + view.getUint16(at + 4);
  let fallback: string | undefined;
  for (let i = 0; i < view.getUint16(at + 2); i++) {
    const rec = at + 6 + i * 12;
    if (view.getUint16(rec + 6) !== id) continue;
    const platform = view.getUint16(rec);
    const length = view.getUint16(rec + 8);
    const offset = strings + view.getUint16(rec + 10);
    if (platform === 3 || platform === 0) {
      let s = '';
      for (let j = 0; j < length; j += 2) s += String.fromCharCode(view.getUint16(offset + j));
      return s;
    }
    let s = '';
    for (let j = 0; j < length; j++) s += String.fromCharCode(view.getUint8(offset + j));
    fallback ??= s;
  }
  return fallback;
}
