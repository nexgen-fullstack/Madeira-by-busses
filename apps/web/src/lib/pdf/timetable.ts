import { formatClock } from '@madeirabus/engine';
import type { I18n } from '../../i18n.ts';
import { inkOn, readableOn, tint } from '../color.ts';
import type { PrintableTimetable, PrintSection } from '../printable.ts';
import { A4, PdfDocument, type PdfPage } from './document.ts';
import type { TrueTypeFont } from './truetype.ts';

/** Lays a printable timetable out on A4 pages. */

const M = 36;
const W = A4.width - 2 * M;
/** Lowest baseline for content; the footer sits below it. */
const BOTTOM = A4.height - 62;
/** Where content starts under the header of a new page. */
const PAGE_TOP = 134;
const INK = '#14181F';
const MUTED = '#5B6573';
const RULE = '#DCE2E8';
const ZEBRA = '#F4F6F8';
const R = 'regular';
const B = 'bold';

export async function timetablePdf(
  tt: PrintableTimetable,
  fonts: { regular: TrueTypeFont; bold: TrueTypeFont },
  t: I18n,
  created = new Date(),
): Promise<Uint8Array> {
  const doc = new PdfDocument({
    title: tt.title,
    subject: tt.operator,
    author: 'MadeiraBus',
    lang: t.lang,
    created,
  });
  doc.addFont(R, fonts.regular);
  doc.addFont(B, fonts.bold);
  const pages: PdfPage[] = [];
  let page!: PdfPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage();
    pages.push(page);
    y = header(page, tt, t);
  };
  newPage();

  for (const note of tt.notes) {
    const lines = page.wrap(note, R, 8.5, W - 24);
    const h = lines.length * 11 + 12;
    page.fillRect(M, y - 4, W, h, '#FFF4DC', 8);
    lines.forEach((l, i) =>
      page.text(l, M + 12, y + 10 + i * 11, { font: R, size: 8.5, color: '#6B4300' }),
    );
    y += h + 10;
  }

  tt.sections.forEach((s, i) => {
    if (i > 0) {
      // The way back starts on a page of its own unless most of it fits here.
      if (y > BOTTOM - 260) newPage();
      else y += 18;
    }
    y = drawSection(
      s,
      tt.color,
      t,
      () => page,
      (fresh) => {
        newPage();
        return fresh ? y : continued(page, s, t, y);
      },
      y,
    );
  });

  pages.forEach((p, i) => footer(p, tt, t, i + 1, pages.length));
  return doc.save();
}

function header(page: PdfPage, tt: PrintableTimetable, t: I18n): number {
  const top = 30;
  const h = 78;
  page.fillRect(M, top, W, h, tt.color, 14);
  const ink = readableOn(tt.color);
  const size = tt.number.length > 3 ? 28 : 36;
  const numberW = page.text(tt.number, M + 20, top + h / 2 + size * 0.36, {
    font: B,
    size,
    color: ink,
  });
  const x = M + 20 + Math.max(numberW, 64) + 16;
  const brand = 'MadeiraBus';
  const brandW = page.measure(brand, B, 9);
  const width = M + W - 20 - brandW - 16 - x;
  const name = page.wrap(tt.name, B, 15, width).slice(0, 2);
  const sub = [tt.operator, tt.formerly && t.t('lines.formerly', { n: tt.formerly })]
    .filter(Boolean)
    .join(' · ');
  const block = name.length * 18 + 14;
  let base = top + (h - block) / 2 + 13;
  for (const line of name) {
    page.text(line, x, base, { font: B, size: 15, color: ink });
    base += 18;
  }
  page.text(page.fit(sub, R, 9.5, width), x, base, { font: R, size: 9.5, color: ink });
  page.text(brand, M + W - 20, top + 22, { font: B, size: 9, color: ink, align: 'right' });
  page.text(t.t('print.kind'), M + W - 20, top + 34, {
    font: R,
    size: 8,
    color: ink,
    align: 'right',
  });
  if (tt.url) page.link(M, top, W, h, tt.url);
  return top + h + 26;
}

function footer(page: PdfPage, tt: PrintableTimetable, t: I18n, n: number, total: number) {
  let y = A4.height - 44;
  page.line(M, y, M + W, y, RULE, 0.75);
  y += 12;
  const pageLabel = t.t('print.page', { n, total });
  const pageW = page.measure(pageLabel, B, 7.5);
  for (const line of tt.footer) {
    page.text(page.fit(line, R, 7.5, W - pageW - 16), M, y, { font: R, size: 7.5, color: MUTED });
    y += 10;
  }
  page.text(pageLabel, M + W, A4.height - 32, { font: B, size: 7.5, color: MUTED, align: 'right' });
}

/** Section title again on a new page, so a loose sheet still says what it is. */
function continued(page: PdfPage, s: PrintSection, t: I18n, y: number): number {
  page.text(page.fit(`${s.direction} (${t.t('print.continued')})`, B, 10, W), M, y, {
    font: B,
    size: 10,
    color: MUTED,
  });
  return y + 14;
}

function drawSection(
  s: PrintSection,
  color: string,
  t: I18n,
  current: () => PdfPage,
  breakPage: (fresh: boolean) => number,
  startY: number,
): number {
  let page = current();
  let y = startY;
  const title = page.wrap(s.direction, B, 14, W).slice(0, 2);
  if (y + title.length * 18 + 80 > BOTTOM) {
    y = breakPage(true);
    page = current();
  }
  for (const line of title) {
    page.text(line, M, y, { font: B, size: 14, color: INK });
    y += 18;
  }
  const label = `${t.t('print.from')} `;
  const lw = page.text(label, M, y, { font: R, size: 10, color: MUTED });
  page.text(page.fit(s.stop, B, 10, W - lw), M + lw, y, { font: B, size: 10, color: INK });
  y += 16;

  // ---- Departures: an hour column, then one column per kind of day.
  const cols = Math.max(1, s.columns.length);
  const hourW = 34;
  const colW = (W - hourW) / cols;
  const minuteW = page.measure('00', R, 9.5);
  const markW = page.measure('a', B, 6.5) + 1;
  const tokenW = minuteW + markW + 4.5;
  const perLine = Math.max(1, Math.floor((colW - 14) / tokenW));
  const byHour = s.columns.map((c) => {
    const m = new Map<number, { time: number; mark?: string }[]>();
    for (const d of c.departures) {
      const h = Math.floor(d.time / 3600);
      m.set(h, [...(m.get(h) ?? []), d]);
    }
    return m;
  });
  const hours = [...new Set(byHour.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  const markInk = inkOn(color, '#FFFFFF');

  const headRow = () => {
    page.fillRect(M, y, W, 24, tint(color, 0.16), 6);
    page.text(t.t('print.hour'), M + 8, y + 15.5, { font: B, size: 8, color: MUTED });
    s.columns.forEach((c, i) => {
      const x = M + hourW + i * colW + 8;
      page.text(page.fit(c.label, B, 9.5, colW - 14), x, y + 15.5, {
        font: B,
        size: 9.5,
        color: INK,
      });
    });
    y += 28;
  };

  if (hours.length === 0) {
    page.fillRect(M, y, W, 40, ZEBRA, 8);
    page.text(t.t('print.none'), M + 14, y + 24, { font: R, size: 10, color: MUTED });
    y += 52;
  } else {
    headRow();
    let tableTop = y;
    const separators = () => {
      for (let i = 0; i < cols; i++) {
        const x = M + hourW + i * colW;
        page.line(x, tableTop - 4, x, y - 2, RULE, 0.75);
      }
    };
    hours.forEach((h, row) => {
      const lines = Math.max(1, ...byHour.map((m) => Math.ceil((m.get(h)?.length ?? 0) / perLine)));
      const rowH = lines * 12.5 + 6;
      if (y + rowH > BOTTOM) {
        separators();
        y = breakPage(false);
        page = current();
        headRow();
        tableTop = y;
      }
      if (row % 2 === 1) page.fillRect(M, y - 2, W, rowH, ZEBRA, 3);
      page.text(String(h % 24).padStart(2, '0'), M + 8, y + 10, { font: B, size: 10, color: INK });
      byHour.forEach((m, i) => {
        (m.get(h) ?? []).forEach((d, k) => {
          const x = M + hourW + i * colW + 8 + (k % perLine) * tokenW;
          const ly = y + 10 + Math.floor(k / perLine) * 12.5;
          page.text(formatClock(d.time).slice(3), x, ly, { font: R, size: 9.5, color: INK });
          if (d.mark) {
            page.text(d.mark, x + minuteW + 0.8, ly - 3.5, { font: B, size: 6.5, color: markInk });
          }
        });
      });
      y += rowH;
    });
    separators();
    y += 8;
  }

  for (const l of s.legend) {
    page.text(l.mark, M + 2, y, { font: B, size: 8.5, color: markInk });
    page.text(page.fit(`— ${l.text}`, R, 8.5, W - 14), M + 12, y, {
      font: R,
      size: 8.5,
      color: INK,
    });
    y += 12;
  }
  for (const c of s.closed) {
    page.text(c, M, y, { font: R, size: 8.5, color: MUTED });
    y += 12;
  }

  // ---- Stops that follow, with the minutes it takes to reach them.
  if (s.stops.length > 1) {
    y += 10;
    const rowH = 11.5;
    const fit = (top: number) => Math.max(0, Math.floor((BOTTOM - top - 20) / rowH)) * 3;
    // A list that almost fits here moves whole to the next page; a long one is split.
    if (fit(y) < s.stops.length && fit(y) < 36 && fit(PAGE_TOP) >= s.stops.length) {
      y = breakPage(false);
      page = current();
    }
    let rest = s.stops;
    while (rest.length > 0) {
      if (fit(y) < Math.min(rest.length, 9)) {
        y = breakPage(false);
        page = current();
      }
      const chunk = rest.slice(0, fit(y));
      rest = rest.slice(chunk.length);
      const title = t.t('print.stops', { stop: s.stop });
      page.text(page.fit(title, B, 10, W), M, y, { font: B, size: 10, color: INK });
      const per = Math.ceil(chunk.length / 3);
      const stopW = W / 3;
      chunk.forEach((st, i) => {
        const x = M + Math.floor(i / per) * stopW;
        const ry = y + 20 + (i % per) * rowH;
        page.text(String(st.minutes), x + 18, ry, {
          font: B,
          size: 8.5,
          color: inkOn(color, '#FFFFFF'),
          align: 'right',
        });
        page.text(page.fit(st.name, R, 8.5, stopW - 30), x + 24, ry, {
          font: R,
          size: 8.5,
          color: INK,
        });
      });
      y += 20 + per * rowH + 4;
    }
  }
  return y;
}
