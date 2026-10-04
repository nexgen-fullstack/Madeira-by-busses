import type { TrueTypeFont } from './truetype.ts';

/**
 * A small PDF writer for the printable timetables: vector shapes and text in
 * embedded TrueType fonts (so Cyrillic, Czech or Portuguese all print), links,
 * several pages, compressed with the browser's own deflate. Coordinates are
 * points from the top-left corner of the page, y growing downwards.
 */

/** A4 portrait, in points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export interface DocumentInfo {
  title: string;
  author?: string;
  subject?: string;
  /** The program that made the file. */
  creator?: string;
  /** BCP 47 language of the text, e.g. "uk". */
  lang?: string;
  /** Defaults to now. */
  created?: Date;
}

export interface TextStyle {
  font: string;
  size: number;
  /** "#rrggbb"; black by default. */
  color?: string;
  align?: 'left' | 'center' | 'right';
}

interface FontEntry {
  ttf: TrueTypeFont;
  resource: string;
  /** Glyphs drawn so far → the character each one stands for. */
  used: Map<number, number>;
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly fonts = new Map<string, FontEntry>();

  constructor(readonly info: DocumentInfo) {}

  addFont(key: string, ttf: TrueTypeFont): void {
    this.fonts.set(key, { ttf, resource: `F${this.fonts.size + 1}`, used: new Map() });
  }

  /** @internal Fonts are looked up by the pages. */
  font(key: string): FontEntry {
    const f = this.fonts.get(key);
    if (!f) throw new Error(`Unknown font "${key}"`);
    return f;
  }

  addPage(width: number = A4.width, height: number = A4.height): PdfPage {
    const page = new PdfPage(this, width, height);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  async save(): Promise<Uint8Array> {
    const out = new PdfWriter();
    const catalog = out.reserve();
    const pagesRoot = out.reserve();
    const info = out.reserve();
    const fontRefs = new Map<FontEntry, number>();
    for (const font of this.fonts.values()) fontRefs.set(font, await writeFont(out, font));
    const fontDict = [...this.fonts.values()]
      .map((f) => `/${f.resource} ${fontRefs.get(f)} 0 R`)
      .join(' ');
    const kids: number[] = [];
    for (const page of this.pages) {
      const contents = await out.stream('', enc.encode(page.content()));
      const annots = page.links.map(
        (l) =>
          `<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(' ')}] /Border [0 0 0] ` +
          `/A << /S /URI /URI ${asciiString(l.url)} >> >>`,
      );
      kids.push(
        out.object(
          `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
            `/Resources << /Font << ${fontDict} >> >> /Contents ${contents} 0 R` +
            (annots.length ? ` /Annots [${annots.join(' ')}]` : '') +
            ' >>',
        ),
      );
    }
    out.set(
      pagesRoot,
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
    );
    out.set(
      catalog,
      `<< /Type /Catalog /Pages ${pagesRoot} 0 R /ViewerPreferences << /DisplayDocTitle true >>` +
        (this.info.lang ? ` /Lang ${pdfString(this.info.lang)}` : '') +
        ' >>',
    );
    const created = pdfDate(this.info.created ?? new Date());
    out.set(
      info,
      `<< /Title ${pdfString(this.info.title)}` +
        (this.info.author ? ` /Author ${pdfString(this.info.author)}` : '') +
        (this.info.subject ? ` /Subject ${pdfString(this.info.subject)}` : '') +
        (this.info.creator
          ? ` /Creator ${pdfString(this.info.creator)} /Producer ${pdfString(this.info.creator)}`
          : '') +
        ` /CreationDate ${created} >>`,
    );
    return out.finish(catalog, info);
  }
}

export class PdfPage {
  private readonly ops: string[] = [];
  readonly links: { rect: number[]; url: string }[] = [];

  constructor(
    private readonly doc: PdfDocument,
    readonly width: number,
    readonly height: number,
  ) {}

  /** @internal */
  content(): string {
    return this.ops.join('\n');
  }

  fillRect(x: number, y: number, w: number, h: number, color: string, radius = 0): void {
    this.ops.push(`${rgb(color)} rg ${this.path(x, y, w, h, radius)} f`);
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    lineWidth = 0.75,
    radius = 0,
  ): void {
    this.ops.push(`${rgb(color)} RG ${num(lineWidth)} w ${this.path(x, y, w, h, radius)} S`);
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    lineWidth = 0.5,
    dash?: number[],
  ): void {
    this.ops.push(
      `${rgb(color)} RG ${num(lineWidth)} w ${dash ? `[${dash.map(num).join(' ')}] 0 d ` : ''}` +
        `${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S` +
        (dash ? ' [] 0 d' : ''),
    );
  }

  circle(cx: number, cy: number, r: number, fill?: string, stroke?: string, lineWidth = 1): void {
    const k = 0.5523 * r;
    const y = this.height - cy;
    const p =
      `${num(cx + r)} ${num(y)} m ` +
      `${num(cx + r)} ${num(y + k)} ${num(cx + k)} ${num(y + r)} ${num(cx)} ${num(y + r)} c ` +
      `${num(cx - k)} ${num(y + r)} ${num(cx - r)} ${num(y + k)} ${num(cx - r)} ${num(y)} c ` +
      `${num(cx - r)} ${num(y - k)} ${num(cx - k)} ${num(y - r)} ${num(cx)} ${num(y - r)} c ` +
      `${num(cx + k)} ${num(y - r)} ${num(cx + r)} ${num(y - k)} ${num(cx + r)} ${num(y)} c h`;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.ops.push(
      `${fill ? `${rgb(fill)} rg ` : ''}${stroke ? `${rgb(stroke)} RG ${num(lineWidth)} w ` : ''}${p} ${paint}`,
    );
  }

  /** Draws one line of text with its baseline at `y`; returns its width. */
  text(s: string, x: number, y: number, style: TextStyle): number {
    const font = this.doc.font(style.font);
    const glyphs = glyphsOf(font, s);
    const width = advanceOf(font, glyphs, style.size);
    const left = style.align === 'right' ? x - width : style.align === 'center' ? x - width / 2 : x;
    const hex = glyphs.map((g) => g.toString(16).padStart(4, '0')).join('');
    this.ops.push(
      `BT /${font.resource} ${num(style.size)} Tf ${rgb(style.color ?? '#000000')} rg ` +
        `${num(left)} ${num(this.height - y)} Td <${hex}> Tj ET`,
    );
    return width;
  }

  /** Width of `s` in points. */
  measure(s: string, font: string, size: number): number {
    const f = this.doc.font(font);
    return advanceOf(f, glyphsOf(f, s, false), size);
  }

  /** Splits text into lines no wider than `width`. */
  wrap(s: string, font: string, size: number, width: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (const word of s.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (this.measure(next, font, size) <= width || !current) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  /** Text that does not fit in `width` is cut with an ellipsis. */
  fit(s: string, font: string, size: number, width: number): string {
    if (this.measure(s, font, size) <= width) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.measure(`${s.slice(0, mid).trimEnd()}…`, font, size) <= width) lo = mid;
      else hi = mid - 1;
    }
    return `${s.slice(0, lo).trimEnd()}…`;
  }

  /** Makes a rectangle open `url` when clicked in a PDF viewer. */
  link(x: number, y: number, w: number, h: number, url: string): void {
    this.links.push({ rect: [x, this.height - y - h, x + w, this.height - y], url });
  }

  private path(x: number, y: number, w: number, h: number, r: number): string {
    const bottom = this.height - y - h;
    if (r <= 0) return `${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re`;
    const rr = Math.min(r, w / 2, h / 2);
    const k = 0.5523 * rr;
    const top = bottom + h;
    const right = x + w;
    return (
      `${num(x + rr)} ${num(bottom)} m ${num(right - rr)} ${num(bottom)} l ` +
      `${num(right - rr + k)} ${num(bottom)} ${num(right)} ${num(bottom + rr - k)} ${num(right)} ${num(bottom + rr)} c ` +
      `${num(right)} ${num(top - rr)} l ` +
      `${num(right)} ${num(top - rr + k)} ${num(right - rr + k)} ${num(top)} ${num(right - rr)} ${num(top)} c ` +
      `${num(x + rr)} ${num(top)} l ` +
      `${num(x + rr - k)} ${num(top)} ${num(x)} ${num(top - rr + k)} ${num(x)} ${num(top - rr)} c ` +
      `${num(x)} ${num(bottom + rr)} l ` +
      `${num(x)} ${num(bottom + rr - k)} ${num(x + rr - k)} ${num(bottom)} ${num(x + rr)} ${num(bottom)} c h`
    );
  }
}

const enc = new TextEncoder();

/** Glyphs for a string; characters the font lacks fall back to their base letter or a space. */
function glyphsOf(font: FontEntry, s: string, record = true): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    let g = font.ttf.glyph(cp);
    let shown = cp;
    if (g === 0) {
      if (/\s/u.test(ch)) shown = 32;
      else {
        // "ǎ" → "a": drop accents the font cannot draw rather than print a box.
        const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
        shown = base ? base.codePointAt(0)! : 63;
      }
      g = font.ttf.glyph(shown);
      if (g === 0) continue;
    }
    if (record && !font.used.has(g)) font.used.set(g, shown);
    out.push(g);
  }
  return out;
}

function advanceOf(font: FontEntry, glyphs: number[], size: number): number {
  let w = 0;
  for (const g of glyphs) w += font.ttf.advance(g);
  return (w * size) / font.ttf.unitsPerEm;
}

/** Type 0 font with an Identity-H encoding: the content streams address glyphs directly. */
async function writeFont(out: PdfWriter, font: FontEntry): Promise<number> {
  const { ttf } = font;
  const scale = 1000 / ttf.unitsPerEm;
  const name = `MBUSPD+${ttf.postScriptName.replace(/[^\x21-\x7e]|[[\]()<>{}/%#]/g, '')}`;
  const file = await out.stream(`/Length1 ${ttf.data.length}`, ttf.data);
  const descriptor = out.object(
    `<< /Type /FontDescriptor /FontName /${name} /Flags 32 ` +
      `/FontBBox [${ttf.bbox.map((v) => Math.round(v * scale)).join(' ')}] ` +
      `/ItalicAngle ${num(ttf.italicAngle)} /Ascent ${Math.round(ttf.ascent * scale)} ` +
      `/Descent ${Math.round(ttf.descent * scale)} /CapHeight ${Math.round(ttf.capHeight * scale)} ` +
      `/StemV 80 /FontFile2 ${file} 0 R >>`,
  );
  const glyphs = [...font.used.keys()].sort((a, b) => a - b);
  const widths = glyphs.map((g) => `${g} [${Math.round(ttf.advance(g) * scale)}]`).join(' ');
  const cid = out.object(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`,
  );
  const toUnicode = await out.stream('', enc.encode(toUnicodeCMap(font.used)));
  return out.object(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H ` +
      `/DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  );
}

/** Lets viewers copy and search the text: glyph → Unicode. */
function toUnicodeCMap(used: Map<number, number>): string {
  const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(
      `${chunk.length} beginbfchar\n` +
        chunk.map(([g, cp]) => `<${hex4(g)}> <${utf16Hex(cp)}>`).join('\n') +
        '\nendbfchar',
    );
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** Collects numbered objects and writes the file with its cross-reference table. */
class PdfWriter {
  private readonly bodies = new Map<number, Uint8Array[]>();
  private next = 1;

  reserve(): number {
    return this.next++;
  }

  set(id: number, dict: string): void {
    this.bodies.set(id, [enc.encode(dict)]);
  }

  object(dict: string): number {
    const id = this.reserve();
    this.set(id, dict);
    return id;
  }

  async stream(extra: string, data: Uint8Array): Promise<number> {
    const packed = await deflate(data);
    const body = packed ?? data;
    const id = this.reserve();
    this.bodies.set(id, [
      enc.encode(
        `<< /Length ${body.length}${packed ? ' /Filter /FlateDecode' : ''}${extra ? ` ${extra}` : ''} >>\nstream\n`,
      ),
      body,
      enc.encode('\nendstream'),
    ]);
    return id;
  }

  finish(root: number, info: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (c: Uint8Array) => {
      chunks.push(c);
      length += c.length;
    };
    // The binary comment tells transfer tools the file is not plain text.
    push(new Uint8Array([...enc.encode('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const offsets: number[] = [];
    for (let id = 1; id < this.next; id++) {
      const body = this.bodies.get(id);
      if (!body) throw new Error(`PDF object ${id} was reserved but never written`);
      offsets[id] = length;
      push(enc.encode(`${id} 0 obj\n`));
      body.forEach(push);
      push(enc.encode('\nendobj\n'));
    }
    const xref = length;
    const rows = offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`);
    push(
      enc.encode(
        `xref\n0 ${this.next}\n0000000000 65535 f \n${rows.join('')}` +
          `trailer\n<< /Size ${this.next} /Root ${root} 0 R /Info ${info} 0 R >>\n` +
          `startxref\n${xref}\n%%EOF\n`,
      ),
    );
    const file = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      file.set(c, at);
      at += c.length;
    }
    return file;
  }
}

/** zlib-deflated data (what /FlateDecode expects), or undefined where the browser cannot. */
async function deflate(data: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

function num(n: number): string {
  const s = n.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function rgb(hex: string): string {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
  return [0, 2, 4].map((i) => num(parseInt(v.slice(i, i + 2), 16) / 255)).join(' ');
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

function utf16Hex(cp: number): string {
  if (cp < 0x10000) return hex4(cp);
  const v = cp - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}

/** A literal string of printable ASCII, as URIs must be. */
function asciiString(s: string): string {
  const ascii = s.replace(/[^\x20-\x7e]/gu, (c) => encodeURIComponent(c));
  return `(${ascii.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** A PDF text string: UTF-16 with a byte order mark, in hex. */
function pdfString(s: string): string {
  let out = 'FEFF';
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return `<${out}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`
  );
}
