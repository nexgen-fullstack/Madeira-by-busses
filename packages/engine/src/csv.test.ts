import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords, toCsv } from './csv.ts';

describe('csv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    const text = '﻿id,name\r\n1,"Funchal, Centro"\r\n2,"Say ""olá"""\r\n';
    expect(parseCsv(text)).toEqual([
      ['id', 'name'],
      ['1', 'Funchal, Centro'],
      ['2', 'Say "olá"'],
    ]);
  });

  it('maps records by trimmed header and tolerates short rows', () => {
    expect(parseCsvRecords('a, b\n1\n')).toEqual([{ a: '1', b: '' }]);
  });

  it('round-trips through toCsv', () => {
    const csv = toCsv(['x', 'y'], [['a,b', 'c"d']]);
    expect(parseCsvRecords(csv)).toEqual([{ x: 'a,b', y: 'c"d' }]);
  });
});
