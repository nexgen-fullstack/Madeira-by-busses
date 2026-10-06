import { useEffect, useState } from 'react';
import type { Network } from '@madeirabus/engine';
import type { I18n } from '../i18n.ts';
import { lineSheet, type SheetMark } from './lineSheet.ts';

/** A line's whole timetable drawn as a picture, ready to show, save or send. */
export interface SheetPicture {
  /** For an <img>; revoked when the picture is no longer shown. */
  url: string;
  bytes: Uint8Array;
  fileName: string;
  title: string;
}

/**
 * The picture of a line's timetable (both ways, as at the bus station) from
 * `from` on, drawn as soon as it is asked for, with the stop it is boarded at
 * (and the bus taken) standing out: undefined while it is drawn, 'failed' when
 * it could not be.
 */
export function useLineSheet(
  net: Network,
  t: I18n,
  route: number,
  from: string,
  printedOn: string,
  board?: SheetMark,
  /** Drawn only once this is true (the picture scrolled into view). */
  wanted = true,
): SheetPicture | 'failed' | undefined {
  const [sheet, setSheet] = useState<SheetPicture | 'failed'>();
  const { stop, pattern, tripId, date } = board ?? {};
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    setSheet(undefined);
    if (!wanted) return;
    void (async () => {
      try {
        const { lineSheetPng } = await import('./sheetImage.ts');
        const mark = stop === undefined ? undefined : { stop, pattern, tripId, date };
        const made = lineSheet(net, t, route, from, printedOn, mark);
        const bytes = await lineSheetPng(made);
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setSheet({ url, bytes, fileName: made.fileName, title: made.title });
      } catch {
        if (!cancelled) setSheet('failed');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [net, t, route, from, printedOn, stop, pattern, tripId, date, wanted]);
  return sheet;
}
