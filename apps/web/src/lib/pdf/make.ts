import type { Network } from '@madeirabus/engine';
import boldUrl from '../../assets/fonts/Inter-ExtraBold.subset.ttf?url';
import regularUrl from '../../assets/fonts/Inter-Regular.subset.ttf?url';
import type { I18n } from '../../i18n.ts';
import { printableTimetable, type PrintableTimetable, type PrintRequest } from '../printable.ts';
import { timetablePdf } from './timetable.ts';
import { parseTrueType, type TrueTypeFont } from './truetype.ts';

/**
 * The printable timetable of a line as a PDF. Loaded on demand: the PDF
 * writer and its fonts stay out of the app until someone asks for a sheet.
 */

let fonts: Promise<{ regular: TrueTypeFont; bold: TrueTypeFont }> | undefined;

function loadFonts() {
  fonts ??= Promise.all(
    [regularUrl, boldUrl].map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseTrueType(new Uint8Array(await res.arrayBuffer()));
    }),
  ).then(([regular, bold]) => ({ regular: regular!, bold: bold! }));
  // A failed download (offline before the first use) is tried again next time.
  fonts.catch(() => (fonts = undefined));
  return fonts;
}

export async function makeTimetablePdf(
  net: Network,
  t: I18n,
  request: PrintRequest,
  today: string,
): Promise<{ timetable: PrintableTimetable; bytes: Uint8Array }> {
  const timetable = printableTimetable(net, t, request, today);
  const bytes = await timetablePdf(timetable, await loadFonts(), t);
  return { timetable, bytes };
}
