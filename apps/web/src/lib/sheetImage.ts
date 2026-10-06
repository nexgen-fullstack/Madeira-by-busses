import boldUrl from '../assets/fonts/Inter-ExtraBold.subset.ttf?url';
import regularUrl from '../assets/fonts/Inter-Regular.subset.ttf?url';
import { readableOn } from './color.ts';
import { clock } from './format.ts';
import type { LineSheet, SheetWay } from './lineSheet.ts';

/**
 * The sheet of a line as a picture (PNG) to keep on the phone, drawn like the timetables
 * the operators put up at the bus station: a band for each kind of day, the buses one way
 * beside the buses back, a time in each column of a main stop. Loaded on demand.
 */

const FAMILY = 'MB Sheet';
const FONT = `'${FAMILY}', 'Inter', system-ui, 'Segoe UI', Roboto, Arial, sans-serif`;
const INK = '#14181F';
const MUTED = '#5B6472';
const NAVY = '#002F85';
const LINE = '#C9CED6';
const STRIPE = '#F1F4F8';
const MARK = '#0B5FFF';
/** The stop boarded at: its column in the yellow of the route on the map. */
const BOARD_HEAD = '#FFD84D';
const BOARD = '#FFF6D1';
const BOARD_STRIPE = '#FCEDB4';
/** The bus taken: its row, and its time where it is boarded. */
const CHOSEN_ROW = '#FFF1B8';
const CHOSEN = '#FFD400';

const PAD = 20;
const COL = 86;
/** Between the two ways of a line. */
const GAP = 10;
const ROW = 21;

let fonts: Promise<void> | undefined;

/** The app's own font, so the picture looks the same on every phone. */
function loadFonts(): Promise<void> {
  fonts ??= Promise.all(
    [
      [regularUrl, '400'],
      [boldUrl, '800'],
    ].map(async ([url, weight]) => {
      const face = new FontFace(FAMILY, `url(${url})`, { weight });
      document.fonts.add(await face.load());
    }),
  )
    .then(() => undefined)
    // Without it (offline before the first use) the system font draws the sheet.
    .catch(() => {
      fonts = undefined;
    });
  return fonts;
}

type Ctx = CanvasRenderingContext2D;

function wrap(ctx: Ctx, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** At most `max` lines, the last one cut with an ellipsis. */
function clip(ctx: Ctx, text: string, width: number, max: number): string[] {
  const lines = wrap(ctx, text, width);
  if (lines.length <= max) return lines;
  let last = lines.slice(max - 1).join(' ');
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  return [...lines.slice(0, max - 1), `${last.trimEnd()}…`];
}

const font = (size: number, bold = false) => `${bold ? 800 : 400} ${size}px ${FONT}`;

/** The ways of the line in pairs, one beside the other (a third way below). */
const pairs = (ways: SheetWay[]) =>
  ways.reduce<SheetWay[][]>((out, w, i) => {
    if (i % 2 === 0) out.push([w]);
    else out[out.length - 1]!.push(w);
    return out;
  }, []);

const pairWidth = (pair: SheetWay[]) =>
  pair.reduce((w, way) => w + way.columns.length * COL, 0) + GAP * (pair.length - 1);

/** Draws the sheet; called twice, to measure and to paint. */
function draw(ctx: Ctx, sheet: LineSheet, width: number): number {
  const inner = width - 2 * PAD;
  let y = PAD;
  ctx.textBaseline = 'middle';

  // The number of the line in its colour, its name, who runs it.
  ctx.font = font(26, true);
  const badge = Math.max(64, ctx.measureText(sheet.number).width + 24);
  ctx.fillStyle = sheet.color;
  ctx.beginPath();
  ctx.roundRect(PAD, y, badge, 52, 10);
  ctx.fill();
  ctx.fillStyle = readableOn(sheet.color);
  ctx.textAlign = 'center';
  ctx.fillText(sheet.number, PAD + badge / 2, y + 27);
  ctx.textAlign = 'left';
  const textX = PAD + badge + 14;
  ctx.font = font(17, true);
  ctx.fillStyle = INK;
  const name = clip(ctx, sheet.name, width - PAD - textX, 2);
  name.forEach((l, i) => ctx.fillText(l, textX, y + 12 + i * 21));
  ctx.font = font(12);
  ctx.fillStyle = MUTED;
  const meta = [sheet.operator, sheet.formerly].filter(Boolean).join(' · ');
  ctx.fillText(meta, textX, y + 12 + name.length * 21);
  y += Math.max(52, 12 + name.length * 21 + 10) + 14;

  for (const days of sheet.days) {
    // The kind of day across the sheet.
    ctx.fillStyle = NAVY;
    ctx.fillRect(PAD, y, inner, 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(14, true);
    ctx.textAlign = 'center';
    ctx.fillText(days.label, width / 2, y + 15);
    y += 28;
    for (const pair of pairs(days.ways)) {
      let x = PAD + (inner - pairWidth(pair)) / 2;
      const top = y;
      const rows = Math.max(...pair.map((w) => w.rows.length));
      // Header: the way, then its main stops.
      ctx.font = font(10, true);
      const headLines = Math.max(
        ...pair.flatMap((w) => w.columns.map((c) => clip(ctx, c, COL - 8, 3).length)),
      );
      const head = 24 + headLines * 12 + 8;
      const body = rows * ROW;
      for (const [k, way] of pair.entries()) {
        const w = way.columns.length * COL;
        ctx.fillStyle = '#E4E9F2';
        ctx.fillRect(x, top, w, head);
        if (way.marked !== undefined) {
          ctx.fillStyle = BOARD_HEAD;
          ctx.fillRect(x + way.marked * COL, top + 22, COL, head - 22);
        }
        ctx.fillStyle = NAVY;
        ctx.font = font(11, true);
        ctx.textAlign = 'center';
        ctx.fillText(clip(ctx, way.direction, w - 10, 1)[0] ?? '', x + w / 2, top + 12);
        ctx.font = font(10, true);
        ctx.fillStyle = INK;
        way.columns.forEach((c, i) => {
          const lines = clip(ctx, c, COL - 8, 3);
          const cy = top + 24 + (headLines * 12 - lines.length * 12) / 2 + 10;
          lines.forEach((l, j) => ctx.fillText(l, x + i * COL + COL / 2, cy + j * 12));
        });
        // The buses, a stripe every other one.
        way.rows.forEach((row, r) => {
          const ry = top + head + r * ROW;
          if (r % 2 === 1) {
            ctx.fillStyle = STRIPE;
            ctx.fillRect(x, ry, w, ROW);
          }
          if (row.chosen) {
            ctx.fillStyle = CHOSEN_ROW;
            ctx.fillRect(x, ry, w, ROW);
          }
          if (way.marked !== undefined) {
            ctx.fillStyle = row.chosen ? CHOSEN : r % 2 === 1 ? BOARD_STRIPE : BOARD;
            ctx.fillRect(x + way.marked * COL, ry, COL, ROW);
          }
          let marked = false;
          row.times.forEach((time, i) => {
            const cx = x + i * COL + COL / 2;
            ctx.fillStyle = time === undefined ? LINE : INK;
            ctx.font = font(13, Boolean(row.chosen));
            ctx.textAlign = 'center';
            const text = time === undefined ? '–' : clock(time);
            ctx.fillText(text, cx, ry + ROW / 2 + 1);
            if (row.mark && time !== undefined && !marked) {
              marked = true;
              const tw = ctx.measureText(text).width;
              ctx.font = font(10, true);
              ctx.fillStyle = MARK;
              ctx.textAlign = 'left';
              ctx.fillText(row.mark, cx + tw / 2 + 2, ry + ROW / 2 - 3);
            }
          });
        });
        // Columns and the frame.
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        for (let i = 1; i < way.columns.length; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * COL + 0.5, top + 24);
          ctx.lineTo(x + i * COL + 0.5, top + head + body);
          ctx.stroke();
        }
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, top, w, head + body);
        x += w + (k < pair.length - 1 ? GAP : 0);
      }
      y = top + head + body + 10;
    }
    y += 8;
  }

  // What the letters mean, what to know, where it comes from.
  ctx.textAlign = 'left';
  for (const { mark, text } of sheet.legend) {
    ctx.font = font(12, true);
    ctx.fillStyle = MARK;
    ctx.fillText(mark, PAD, y + 8);
    ctx.font = font(12);
    ctx.fillStyle = INK;
    for (const l of wrap(ctx, text, inner - 18)) {
      ctx.fillText(l, PAD + 16, y + 8);
      y += 17;
    }
  }
  if (sheet.legend.length > 0) y += 6;
  ctx.font = font(11);
  for (const [i, text] of [...sheet.notes, ...sheet.footer].entries()) {
    ctx.fillStyle = i < sheet.notes.length ? INK : MUTED;
    for (const l of wrap(ctx, text, inner)) {
      ctx.fillText(l, PAD, y + 7);
      y += 15;
    }
  }
  ctx.font = font(12, true);
  ctx.fillStyle = NAVY;
  ctx.textAlign = 'right';
  ctx.fillText('Madeira by busses', width - PAD, y + 12);
  return y + 24 + PAD;
}

/** Fits in what phones can draw (iOS: 16.7 million pixels). */
const MAX_PIXELS = 16_000_000;

export async function lineSheetPng(sheet: LineSheet): Promise<Uint8Array> {
  await loadFonts();
  const widest = Math.max(460, ...sheet.days.flatMap((d) => pairs(d.ways).map(pairWidth)));
  const width = Math.ceil(widest + 2 * PAD);
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  const height = Math.ceil(draw(measure, sheet, width));
  const scale = Math.max(1, Math.min(2, Math.sqrt(MAX_PIXELS / (width * height))));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  draw(ctx, sheet, width);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG');
  return new Uint8Array(await blob.arrayBuffer());
}
