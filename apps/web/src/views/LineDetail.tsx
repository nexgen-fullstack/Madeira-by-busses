import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Clock, Download, Image, Loader2, Printer, Share2 } from 'lucide-react';
import { stopDepartures } from '@madeirabus/engine';
import { WaysTable, type WayColumn, type WayEntry } from '../components/HourTable.tsx';
import { LineSheetBlock } from '../components/LineSheetBlock.tsx';
import { useMapContent, useSpotlight } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { isNative } from '../lib/device.ts';
import { canPrint, canShareFiles, printPdf, saveFile, shareFile } from '../lib/files.ts';
import { clock, longDate } from '../lib/format.ts';
import { variantNote } from '../lib/lineSheet.ts';
import {
  expresswayStretches,
  kilometres,
  lineDirections,
  lineOf,
  type Direction,
} from '../lib/lines.ts';
import { routeContent, WAY_TURQUOISE, WAY_YELLOW } from '../lib/mapContent.ts';
import { boardingStops, returnOf, terminusMarks } from '../lib/printable.ts';
import { goBack, navigate } from '../lib/router.ts';
import { lineUrl } from '../lib/site.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';
import { routeColor } from '../lib/color.ts';

type PdfAction = 'save' | 'print' | 'share';

interface Props {
  routeIndex: number;
  /** The stop it is boarded at, when opened from a timetable: its way and its buses from there. */
  at?: number;
  /** The day of that timetable. */
  day?: string;
}

export function LineDetail({ routeIndex, at, day }: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  const today = now.date;
  const route = net.routes[routeIndex];
  // All variants of the line, as the feed may publish each one as a route.
  const variants = useMemo(() => lineOf(net, routeIndex), [net, routeIndex]);
  const directions = useMemo(() => lineDirections(net, variants), [net, variants]);
  const [date, setDate] = useState(day ?? today);
  const [dirIndex, setDirIndex] = useState(() =>
    Math.max(
      0,
      at === undefined ? 0 : directions.findIndex((d) => boardingStops(net, d).includes(at)),
    ),
  );
  const [chosenStop, setChosenStop] = useState<number | undefined>(at);
  const [back, setBack] = useState(true);
  const [busy, setBusy] = useState<PdfAction | undefined>();
  const [toast, setToast] = useState<string | undefined>();
  const chosen = Math.min(dirIndex, directions.length - 1);
  const dir = directions[chosen];
  const main = dir?.patterns[0];
  const stops = useMemo(() => (dir ? boardingStops(net, dir) : []), [net, dir]);
  const stop = chosenStop !== undefined && stops.includes(chosenStop) ? chosenStop : stops[0];
  // A stop of the list tapped: shown on the map.
  const spot = useSpotlight();
  // Where this way runs on the Via Rápida, between which of its stops.
  const expressways = useMemo(
    () => (main === undefined ? [] : expresswayStretches(net, main)),
    [net, main],
  );

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

  // Every bus of this direction that stops here, short runs marked with a letter; and beside
  // them the way back's from its stop across the road, as the map shows the two.
  const timetable = useMemo(() => {
    if (!dir || stop === undefined) return undefined;
    const way = (d: Direction, s: number) => {
      const departures = stopDepartures(net, d.patterns, s, date);
      const marks = terminusMarks(net, d, departures);
      const entries: WayEntry[] = departures.map((x) => ({
        time: x.time,
        mark: marks.get(x.terminus),
        pattern: x.pattern,
        dayTrip: x.dayTrip,
      }));
      const ends = net.patterns[d.patterns[0]!]!.stops;
      return { direction: d, stop: s, departures, marks, entries, end: ends[ends.length - 1]! };
    };
    const there = way(dir, stop);
    const other = returnOf(net, variants, dir, stop);
    return { there, back: other ? way(other.direction, other.stop) : undefined };
  }, [net, variants, dir, stop, date]);

  if (!route || !dir || main === undefined || stop === undefined || !timetable) {
    return <p className="error">?</p>;
  }
  const agency = net.bundle.agencies[route.agency]!;
  const line = net.routes[variants[0]!]!;
  const { departures } = timetable.there;
  const ways = [timetable.there, ...(timetable.back ? [timetable.back] : [])];
  const columns: WayColumn[] = ways.map((w, i) => ({
    color: i === 0 ? WAY_YELLOW : WAY_TURQUOISE,
    title: net.stops[w.end]!.name,
    from: t.t('lines.fromStop', { stop: net.stops[w.stop]!.name }),
    entries: w.entries,
  }));
  // A bus tapped: its trip, to plan the way with it. This page keeps its way, stop and day
  // in its address, so back comes to it as it was.
  const openTrip = (e: WayEntry, way: number) => {
    const here = `#/lines/${routeIndex}?${new URLSearchParams({ s: String(stop), d: date })}`;
    try {
      history.replaceState(history.state, '', here);
    } catch {
      // History unavailable (sandboxed frames): back opens the line at its first stop.
    }
    navigate(`ride/${e.pattern}/${e.dayTrip}`, { d: date, s: String(ways[way]!.stop) });
  };
  const mainStops = net.patterns[main]!.stops;
  const stopName = (pos: number) => net.stops[mainStops[pos]!]!.name;

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

      {expressways.length > 0 && (
        <div className="vr-note">
          <span className="vr-mark" aria-hidden>
            VR
          </span>
          <div>
            <div className="vr-note__title">{t.t('vr.title')}</div>
            {expressways.map((x) => (
              <div key={x.from}>
                {t.t('vr.stretch', {
                  from: stopName(x.from),
                  to: stopName(x.to),
                  km: kilometres(x.metres, t.locale),
                })}
              </div>
            ))}
            <div className="vr-note__hint">{t.t('vr.hint')}</div>
          </div>
        </div>
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
        {departures.length === 0 && !timetable.back?.departures.length ? (
          <p className="muted">{t.t('lines.noService')}</p>
        ) : (
          <>
            {departures.length > 0 && (
              <p className="first-last">
                {t.t('lines.firstLast', {
                  first: clock(departures[0]!.time),
                  last: clock(departures[departures.length - 1]!.time),
                })}{' '}
                · {t.tn('lines.buses', departures.length)}
              </p>
            )}
            <WaysTable
              ways={columns}
              now={date === today ? now.time : undefined}
              label={(time) => t.t('ride.title', { time: clock(time) })}
              onPick={openTrip}
            />
            {ways.some((w) => w.marks.size > 0) && (
              <ul className="legend">
                {ways.flatMap((w, i) =>
                  [...w.marks.entries()].map(([s, mark]) => (
                    <li key={`${i}-${s}`}>
                      {ways.length > 1 && (
                        <span
                          className="way-swatch"
                          style={{ background: columns[i]!.color }}
                          aria-hidden
                        />
                      )}
                      <sup className="timetable__mark">{mark}</sup>{' '}
                      {t.t('print.endsAt', { stop: net.stops[s]!.name })}
                    </li>
                  )),
                )}
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
        {/* The whole line on one picture, both ways, to keep in the gallery or send. */}
        <LineSheetBlock route={routeIndex} date={date} look="page" />
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
        <ol className="stop-line" style={{ ['--route' as string]: routeColor(line) }}>
          {mainStops.map((s, i) => {
            const vr = expressways.find((x) => x.from === i);
            const onVr = expressways.some((x) => i > x.from && i < x.to);
            const className = [s === stop && 'is-chosen', onVr && 'stop-line__on-vr']
              .filter(Boolean)
              .join(' ');
            return (
              <Fragment key={`${s}-${i}`}>
                <li className={className || undefined}>
                  <button
                    type="button"
                    className="stop-spot"
                    aria-pressed={spot.isShown(net.stops[s]!)}
                    title={t.t('map.showStop')}
                    onClick={() => spot.show({ ...net.stops[s]! })}
                  >
                    {net.stops[s]!.name}
                  </button>
                  <button
                    type="button"
                    className="icon-button stop-line__times"
                    aria-label={t.t('map.stopTimes', { stop: net.stops[s]!.name })}
                    title={t.t('map.stopTimes', { stop: net.stops[s]!.name })}
                    onClick={() => navigate('stop', { ids: String(s) })}
                  >
                    <Clock size={16} />
                  </button>
                </li>
                {/* Where it takes the Via Rápida, between the stops it leaves and reaches it at. */}
                {vr && (
                  <li className="stop-line__vr" title={t.t('vr.hint')}>
                    <span className="vr-mark" aria-hidden>
                      VR
                    </span>
                    {t.t('vr.ride', { km: kilometres(vr.metres, t.locale) })}
                  </li>
                )}
              </Fragment>
            );
          })}
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
