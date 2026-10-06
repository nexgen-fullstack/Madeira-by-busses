import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, Loader2, Share2 } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import { isNative } from '../lib/device.ts';
import { canShareFiles, saveFile, shareFile } from '../lib/files.ts';
import type { SheetMark } from '../lib/lineSheet.ts';
import { useLineSheet } from '../lib/useLineSheet.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';

interface Props {
  route: number;
  /** The week the sheet shows starts on this day. */
  date: string;
  /** The stop the line is boarded at (and the bus taken), to stand out. */
  board?: SheetMark;
  /**
   * In a line's card on the map: small buttons, and the picture fills the card when
   * tapped (`whole`); on a page: a picture that opens on its own, and big buttons.
   */
  look: 'card' | 'page';
  whole?: boolean;
  onWhole?: (whole: boolean) => void;
  /** "Open the whole line" beside the buttons. */
  onOpenLine?: () => void;
  /** Drawn once it comes near the screen, not before (several under a route). */
  lazy?: boolean;
}

/**
 * A line's whole timetable as a picture, like the sheets at the bus station, with
 * the buttons to save it in the gallery and send it on: the same in a line's card,
 * on its page and under a chosen route.
 */
export function LineSheetBlock({
  route,
  date,
  board,
  look,
  whole,
  onWhole,
  onOpenLine,
  lazy = false,
}: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!lazy);
  useEffect(() => {
    const el = box.current;
    if (near || !el) return;
    // Scrolled near, or anyway once the screen has settled (not while the panel opens).
    const later = window.setTimeout(() => setNear(true), 1500);
    const seen =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            (entries) => entries.some((e) => e.isIntersecting) && setNear(true),
            { rootMargin: '300px' },
          );
    seen?.observe(el);
    return () => {
      window.clearTimeout(later);
      seen?.disconnect();
    };
  }, [near]);
  const sheet = useLineSheet(net, t, route, date, now.date, board, near);
  const [busy, setBusy] = useState<'save' | 'share' | undefined>();
  const [toast, setToast] = useState<string>();
  const ready = sheet !== undefined && sheet !== 'failed' ? sheet : undefined;

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2500);
  };
  const act = async (action: 'save' | 'share') => {
    if (!ready) return;
    setBusy(action);
    try {
      if (action === 'share')
        await shareFile(ready.bytes, ready.fileName, ready.title, 'image/png');
      else if (await saveFile(ready.bytes, ready.fileName, 'image/png'))
        flash(t.t(isNative() ? 'sheet.savedGallery' : 'sheet.saved'));
    } catch {
      flash(t.t('sheet.failed'));
    } finally {
      setBusy(undefined);
    }
  };

  const card = look === 'card';
  const icon = (action: 'save' | 'share') =>
    busy === action ? (
      <Loader2 size={card ? 14 : 18} className="spin" aria-hidden />
    ) : action === 'save' ? (
      <Download size={card ? 14 : 18} />
    ) : (
      <Share2 size={card ? 14 : 18} />
    );
  const small = card ? ' button--small' : '';

  return (
    <>
      <div ref={box} className={card ? 'line-card__sheet' : 'sheet-preview'}>
        {ready ? (
          card ? (
            <button
              type="button"
              className="line-card__picture"
              aria-pressed={whole}
              onClick={() => onWhole?.(!whole)}
            >
              <img src={ready.url} alt={ready.title} />
            </button>
          ) : (
            <a href={ready.url} target="_blank" rel="noopener">
              <img src={ready.url} alt={ready.title} />
            </a>
          )
        ) : sheet === 'failed' ? (
          <p className="muted small">{t.t('sheet.failed')}</p>
        ) : (
          <p className="muted small">
            <Loader2 size={16} className="spin" aria-hidden /> {t.t('lineCard.making')}
          </p>
        )}
      </div>
      <div className={card ? 'line-card__actions' : 'detail__actions'}>
        <button
          type="button"
          className={`button button--primary${small}`}
          disabled={!ready || busy !== undefined}
          aria-busy={busy === 'save'}
          onClick={() => void act('save')}
        >
          {icon('save')} {t.t(card ? 'lineCard.save' : 'sheet.download')}
        </button>
        {canShareFiles() && (
          <button
            type="button"
            className={`button${small}`}
            disabled={!ready || busy !== undefined}
            aria-busy={busy === 'share'}
            onClick={() => void act('share')}
          >
            {icon('share')} {t.t(card ? 'lineCard.share' : 'print.share')}
          </button>
        )}
        {onOpenLine && (
          <button type="button" className={`button${small}`} onClick={onOpenLine}>
            {t.t('lineCard.open')} <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </div>
      {toast && (
        <div className={card ? 'line-card__toast small' : 'toast'} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
