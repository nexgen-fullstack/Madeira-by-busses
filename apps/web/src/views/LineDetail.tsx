import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, Image, Loader2, Printer, Share2 } from 'lucide-react';
import { stopDepartures } from '@madeirabus/engine';
import { HourTable } from '../components/HourTable.tsx';
import { useMapContent } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { isNative } from '../lib/device.ts';
import { canPrint, canShareFiles, printPdf, saveFile, shareFile } from '../lib/files.ts';
import { clock, longDate } from '../lib/format.ts';
import { variantNote } from '../lib/lineSheet.ts';
import { lineDirections, lineOf } from '../lib/lines.ts';
import { routeContent, WAY_TURQUOISE, WAY_YELLOW } from '../lib/mapContent.ts';
import { boardingStops, returnOf, terminusMarks } from '../lib/printable.ts';
import { goBack, navigate } from '../lib/router.ts';
import { lineUrl } from '../lib/site.ts';
import { useLineSheet } from '../lib/useLineSheet.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';

type PdfAction = 'save' | 'print' | 'share';
type ImageAction = 'image' | 'imageShare';

export function LineDetail({ routeIndex }: { routeIndex: number }) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  const today = now.date;
  const [date, setDate] = useState(today);
  const [dirIndex, setDirIndex] = useState(0);
  const [chosenStop, setChosenStop] = useState<number | undefined>();
  const [back, setBack] = useState(true);
  const [busy, setBusy] = useState<PdfAction | ImageAction | undefined>();
  const [toast, setToast] = useState<string | undefined>();
  const route = net.routes[routeIndex];
  // The whole line on one picture, both ways, shown here to keep in the gallery or send.
  const sheet = useLineSheet(net, t, routeIndex, date, today);
  // All variants of the line, as the feed may publish each one as a route.
  const variants = useMemo(() => lineOf(net, routeIndex), [net, routeIndex]);
  const directions = useMemo(() => lineDirections(net, variants), [net, variants]);
  const chosen = Math.min(dirIndex, directions.length - 1);
  const dir = directions[chosen];
  const main = dir?.patterns[0];
  const stops = useMemo(() => (dir ? boardingStops(net, dir) : []), [net, dir]);
  const stop = chosenStop !== undefined && stops.includes(chosenStop) ? chosenStop : stops[0];

  // The chosen way in yellow, the way back in turquoise, as the buttons show; the
  // variants that run on the day of the timetable, telling when they run when tapped.
  useMapContent(
    useMemo(
      () =>
        route
          ? routeContent(net, directions, chosen, date, (d, p) => variantNote(net, t, d, p, date))
          : undefined,
      [net, t, route, directions, chosen, date],
    ),
  );

  // Every bus of this direction that stops here, short runs marked with a letter.
  const timetable = useMemo(() => {
    if (!dir || stop === undefined) return undefined;
    const departures = stopDepartures(net, dir.patterns, stop, date);
    const marks = terminusMarks(net, dir, departures);
    const entries = departures.map((d) => ({ time: d.time, mark: marks.get(d.terminus) }));
    return { departures, marks, entries };
  }, [net, dir, stop, date]);

  if (!route || !dir || main === undefined || stop === undefined || !timetable) {
    return <p className="error">?</p>;
  }
  const agency = net.bundle.agencies[route.agency]!;
  const line = net.routes[variants[0]!]!;
  const { departures } = timetable;
  const mainStops = net.patterns[main]!.stops;

  const switchDirection = (i: number) => {
    // Stay at the same stop across the road when the other direction has one.
    const next = directions[i]!;
    const there = returnOf(net, variants, dir, stop);
    setDirIndex(i);
    setChosenStop(
      there && there.direction.patterns[0] === next.patterns[0] ? there.stop : undefined,
    );
  };

  const pdf = async (action: PdfAction) => {
    setBusy(action);
    try {
      const { makeTimetablePdf } = await import('../lib/pdf/make.ts');
      const { timetable: tt, bytes } = await makeTimetablePdf(
        net,
        t,
        { route: routeIndex, direction: dir, stop, back, from: date, url: lineUrl(line.short) },
        today,
      );
      if (action === 'print') await printPdf(bytes, tt.fileName);
      else if (action === 'share') await shareFile(bytes, tt.fileName, tt.title);
      else if (await saveFile(bytes, tt.fileName))
        flash(t.t(isNative() ? 'print.savedDownloads' : 'print.saved'));
    } catch {
      flash(t.t('print.failed'));
    } finally {
      setBusy(undefined);
    }
  };
  const image = async (action: ImageAction) => {
    if (!sheet || sheet === 'failed') return;
    setBusy(action);
    try {
      const { bytes, fileName, title } = sheet;
      if (action === 'imageShare') await shareFile(bytes, fileName, title, 'image/png');
      else if (await saveFile(bytes, fileName, 'image/png'))
        flash(t.t(isNative() ? 'sheet.savedGallery' : 'sheet.saved'));
    } catch {
      flash(t.t('sheet.failed'));
    } finally {
      setBusy(undefined);
    }
  };
  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2500);
  };
  const pdfButton = (action: PdfAction, label: string, icon: ReactNode, primary = false) => (
    <button
      type="button"
      className={`button ${primary ? 'button--primary' : ''}`}
      onClick={() => void pdf(action)}
      disabled={busy !== undefined}
      aria-busy={busy === action}
    >
      {busy === action ? <Loader2 size={18} className="spin" aria-hidden /> : icon} {label}
    </button>
  );

  return (
    <div className="line-detail">
      <div className="line-hero">
        <button
          type="button"
          className="icon-button line-hero__back"
          onClick={() => goBack('lines')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="line-hero__number">
          <RouteBadge route={line} size="xl" />
        </span>
        <div className="line-hero__text">
          <h2 className="line-hero__name">{line.long}</h2>
          <div className="line-hero__meta">
            {agency.name}
            {line.formerly && <> · {t.t('lines.formerly', { n: line.formerly })}</>}
          </div>
        </div>
      </div>

      {directions.length > 4 ? (
        <select
          className="select"
          aria-label={t.t('lines.direction')}
          value={directions.indexOf(dir)}
          onChange={(e) => switchDirection(Number(e.target.value))}
        >
          {directions.map((d, i) => (
            <option key={d.patterns[0]} value={i}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        directions.length > 1 && (
          <div
            className="segmented segmented--wrap segmented--stack"
            role="group"
            aria-label={t.t('lines.direction')}
          >
            {directions.map((d, i) => (
              <button
                key={d.patterns[0]}
                type="button"
                aria-pressed={d === dir}
                onClick={() => switchDirection(i)}
              >
                <span
                  className="way-swatch"
                  style={{ background: d === dir ? WAY_YELLOW : WAY_TURQUOISE }}
                  aria-hidden
                />
                {d.label}
              </button>
            ))}
          </div>
        )
      )}

      <section className="card">
        <div className="card__row card__row--wrap">
          <h3 className="card__title">{t.t('lines.timetable', { date: longDate(t, date) })}</h3>
          <input
            type="date"
            aria-label={t.t('time.date')}
            value={date}
            min={net.bundle.validity.from}
            max={net.bundle.validity.to}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
        <label className="field">
          <span className="field__label">{t.t('print.from')}</span>
          <select
            className="select select--inline"
            value={stop}
            onChange={(e) => setChosenStop(Number(e.target.value))}
          >
            {stops.map((s) => (
              <option key={s} value={s}>
                {net.stops[s]!.name}
              </option>
            ))}
          </select>
        </label>
        {departures.length === 0 ? (
          <p className="muted">{t.t('lines.noService')}</p>
        ) : (
          <>
            <p className="first-last">
              {t.t('lines.firstLast', {
                first: clock(departures[0]!.time),
                last: clock(departures[departures.length - 1]!.time),
              })}{' '}
              · {t.tn('lines.buses', departures.length)}
            </p>
            <HourTable entries={timetable.entries} now={date === today ? now.time : undefined} />
            {timetable.marks.size > 0 && (
              <ul className="legend">
                {[...timetable.marks.entries()].map(([s, mark]) => (
                  <li key={s}>
                    <sup className="timetable__mark">{mark}</sup>{' '}
                    {t.t('print.endsAt', { stop: net.stops[s]!.name })}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="card print-card">
        <h3 className="card__title">
          <Image size={16} aria-hidden /> {t.t('sheet.card')}
        </h3>
        <p className="muted small">{t.t('sheet.hint')}</p>
        <div className="sheet-preview">
          {sheet === undefined ? (
            <p className="muted small">
              <Loader2 size={16} className="spin" aria-hidden /> {t.t('lineCard.making')}
            </p>
          ) : sheet === 'failed' ? (
            <p className="muted small">{t.t('sheet.failed')}</p>
          ) : (
            <a href={sheet.url} target="_blank" rel="noopener">
              <img src={sheet.url} alt={sheet.title} />
            </a>
          )}
        </div>
        <div className="detail__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void image('image')}
            disabled={busy !== undefined || !sheet || sheet === 'failed'}
            aria-busy={busy === 'image'}
          >
            {busy === 'image' ? (
              <Loader2 size={18} className="spin" aria-hidden />
            ) : (
              <Download size={18} />
            )}{' '}
            {t.t('sheet.download')}
          </button>
          {canShareFiles() && (
            <button
              type="button"
              className="button"
              onClick={() => void image('imageShare')}
              disabled={busy !== undefined || !sheet || sheet === 'failed'}
              aria-busy={busy === 'imageShare'}
            >
              {busy === 'imageShare' ? (
                <Loader2 size={18} className="spin" aria-hidden />
              ) : (
                <Share2 size={18} />
              )}{' '}
              {t.t('print.share')}
            </button>
          )}
        </div>
      </section>

      <section className="card print-card">
        <h3 className="card__title">
          <Printer size={16} aria-hidden /> {t.t('print.card')}
        </h3>
        <p className="muted small">{t.t('print.hint')}</p>
        {directions.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} />
            <span>{t.t('print.back')}</span>
          </label>
        )}
        <div className="detail__actions">
          {pdfButton('save', t.t('print.download'), <Download size={18} />, true)}
          {canPrint() && pdfButton('print', t.t('print.print'), <Printer size={18} />)}
          {canShareFiles() && pdfButton('share', t.t('print.share'), <Share2 size={18} />)}
        </div>
      </section>

      <section className="card">
        <h3 className="card__title">{t.t('lines.stops')}</h3>
        <ol className="stop-line" style={{ ['--route' as string]: `#${line.color}` }}>
          {mainStops.map((s, i) => (
            <li key={`${s}-${i}`} className={s === stop ? 'is-chosen' : undefined}>
              <button type="button" onClick={() => navigate('stop', { ids: String(s) })}>
                {net.stops[s]!.name}
              </button>
            </li>
          ))}
        </ol>
      </section>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
