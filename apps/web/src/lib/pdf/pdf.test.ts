import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeI18n } from '../../i18n.ts';
import { lineNetwork, stopOf } from '../../test/network.ts';
import { lineDirections, lineGroups } from '../lines.ts';
import { printableTimetable } from '../printable.ts';
import { PdfDocument } from './document.ts';
import { timetablePdf } from './timetable.ts';
import { parseTrueType } from './truetype.ts';

const font = (name: string) =>
  parseTrueType(
    new Uint8Array(readFileSync(new URL(`../../assets/fonts/${name}`, import.meta.url))),
  );
const regular = font('Inter-Regular.subset.ttf');
const bold = font('Inter-ExtraBold.subset.ttf');
const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** Every cross-reference entry must point at the object it names. */
function checkXref(pdf: string) {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)![1]);
  const table = pdf.slice(start).split('\n');
  expect(table[0]).toBe('xref');
  const count = Number(table[1]!.split(' ')[1]);
  for (let id = 1; id < count; id++) {
    const offset = Number(table[2 + id]!.slice(0, 10));
    expect(pdf.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
  }
  return count;
}

describe('TrueType fonts', () => {
  it('reads metrics and the characters of all the app’s languages', () => {
    expect(regular.postScriptName).toBe('Inter-Regular');
    expect(regular.unitsPerEm).toBe(2048);
    for (const ch of 'AzÁãçČřŁżЖїҐґ€→№')
      expect(regular.glyph(ch.codePointAt(0)!), ch).toBeGreaterThan(0);
    expect(regular.glyph(0x6f22)).toBe(0);
    // Tabular digits: times line up in columns.
    const widths = new Set(
      [...'0123456789'].map((d) => regular.advance(regular.glyph(d.codePointAt(0)!))),
    );
    expect(widths.size).toBe(1);
  });
});

describe('PDF writer', () => {
  it('writes a valid file with embedded, searchable text', async () => {
    const doc = new PdfDocument({ title: 'Розклад 110', lang: 'uk', created: new Date(0) });
    doc.addFont('r', regular);
    doc.addFont('b', bold);
    const page = doc.addPage();
    page.fillRect(36, 36, 200, 60, '#663695', 12);
    const w = page.text('110 Ґанок', 50, 80, { font: 'b', size: 24, color: '#ffffff' });
    expect(w).toBeGreaterThan(80);
    expect(page.measure('110 Ґанок', 'b', 24)).toBeCloseTo(w);
    expect(page.wrap('Centro Barreira Lombo Aguiares', 'r', 10, 60).length).toBeGreaterThan(1);
    expect(page.fit('Centro Barreira Lombo Aguiares', 'r', 10, 60)).toMatch(/…$/);
    page.link(36, 36, 200, 60, 'https://example.com/#/lines?q=110');
    doc.addPage().text('2', 36, 60, { font: 'r', size: 12 });
    const pdf = latin1(await doc.save());
    expect(pdf.startsWith('%PDF-1.7\n')).toBe(true);
    expect(checkXref(pdf)).toBeGreaterThan(10);
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/ToUnicode');
    expect(pdf).toContain('/URI (https://example.com/#/lines?q=110)');
  });
});

describe('timetable PDF', () => {
  it('prints both ways of a line', async () => {
    const net = lineNetwork();
    const [line] = lineGroups(net);
    const [out] = lineDirections(net, line!.routes);
    const t = makeI18n('uk');
    const tt = printableTimetable(
      net,
      t,
      {
        route: line!.routes[0]!,
        direction: out!,
        stop: stopOf(net, 'C'),
        back: true,
        from: '2026-10-03',
      },
      '2026-10-04',
    );
    const bytes = await timetablePdf(tt, { regular, bold }, t, new Date(0));
    const pdf = latin1(bytes);
    checkXref(pdf);
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)!.length).toBeGreaterThanOrEqual(1);
    expect(bytes.length).toBeLessThan(120_000);
  });
});
