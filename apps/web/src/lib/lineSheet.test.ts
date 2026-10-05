import { describe, expect, it } from 'vitest';
import { formatClock } from '@madeirabus/engine';
import { makeI18n } from '../i18n.ts';
import { lineNetwork } from '../test/network.ts';
import { lineSheet, variantNote, variantText } from './lineSheet.ts';
import { lineDirections, lineGroups } from './lines.ts';

const net = lineNetwork();
const [line] = lineGroups(net);
const [out] = lineDirections(net, line!.routes);
const en = makeI18n('en');
const uk = makeI18n('uk');
// Tuesday 6 October 2026.
const FROM = '2026-10-06';
const short = out!.patterns[1]!;

describe('a variant of a line', () => {
  it('says how it differs from the main way', () => {
    expect(variantText(net, en, out!.patterns[0]!, short)).toBe('to «Igreja»');
    expect(variantText(net, en, out!.patterns[0]!, out!.patterns[0]!)).toBe('');
  });

  it('says when it runs, tapped on the map', () => {
    expect(variantNote(net, uk, out!, short, FROM)).toEqual({
      title: 'Окремий рейс: до «Igreja»',
      lines: ['Відправлення від «Centro»', 'Субота: 21:30'],
    });
  });
});

describe('the sheet of a line', () => {
  const sheet = lineSheet(net, en, line!.routes[0]!, FROM, '2026-10-01');
  const day = (label: string) => sheet.days.find((d) => d.label === label)!;
  const rows = (w: { rows: { times: (number | undefined)[]; mark?: string }[] }) =>
    w.rows.map((r) => [...r.times.map((t) => (t === undefined ? '–' : formatClock(t))), r.mark]);

  it('has a band for each kind of day, both ways side by side', () => {
    expect(sheet.days.map((d) => d.label)).toEqual([
      'Mon–Fri',
      'Saturday',
      'Sunday & public holidays',
    ]);
    expect(day('Mon–Fri').ways.map((w) => [w.direction, w.columns])).toEqual([
      ['Centro → Barreira', ['Centro', 'Barreira']],
      ['Barreira → Praça', ['Barreira', 'Praça']],
    ]);
    expect(rows(day('Mon–Fri').ways[1]!)).toEqual([
      ['07:30', '07:45', undefined],
      ['08:30', '08:45', undefined],
    ]);
  });

  it('marks the buses going another way with a letter it explains', () => {
    expect(rows(day('Saturday').ways[0]!)).toEqual([
      ['08:30', '08:45', undefined],
      ['21:00', '21:15', undefined],
      ['21:30', '–', 'a'],
    ]);
    expect(sheet.legend).toEqual([{ mark: 'a', text: 'to «Igreja»' }]);
    expect(sheet.fileName).toMatch(/-110\.png$/);
    expect(sheet.formerly).toBe('formerly 10A');
  });
});
