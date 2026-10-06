import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Download, Loader2, Share2, X } from 'lucide-react';
import { fareClassOf, haversine, type LatLon, type Network } from '@madeirabus/engine';
import { useI18n, type I18n } from '../i18n.ts';
import type { Key } from '../locales/uk.ts';
import { canShareFiles, saveFile, shareFile } from '../lib/files.ts';
import { clock, price } from '../lib/format.ts';
import { lineSheet } from '../lib/lineSheet.ts';
import { lineOf } from '../lib/lines.ts';
import { navigate } from '../lib/router.ts';
import { useNow } from '../lib/useNow.ts';
import { useNetwork } from '../state/app.tsx';
import { RouteBadge } from './RouteBadge.tsx';

/** A line tapped on the map: which, which way, and where (its stop when known). */
export interface LinePick {
  route: number;
  pattern?: number;
  /** The stop it is boarded at on a route; otherwise the stop of the line nearest the tap. */
  stop?: number;
  at?: LatLon;
}

/** The stop of a pattern nearest a point. */
function nearestStop(net: Network, pattern: number, at: LatLon): number | undefined {
  let best: { stop: number; d: number } | undefined;
  for (const s of net.patterns[pattern]!.stops.slice(0, -1)) {
    const d = haversine(net.stops[s]!, at);
    if (!best || d < best.d) best = { stop: s, d };
  }
  return best?.stop;
}

/** What a ticket on the line costs, from the municipalities its main way runs through. */
function linePrice(net: Network, t: I18n, route: number, pattern: number | undefined) {
  const p = pattern !== undefined ? net.patterns[pattern] : undefined;
  const stops = p ? p.stops : [];
  const munis = new Set(stops.map((s) => net.stops[s]!.muni));
  const first = stops[0] !== undefined ? net.stops[stops[0]]!.muni : '';
  const other = [...munis].find((m) => m !== first) ?? first;
  const fareClass = fareClassOf({
    aerobus: Boolean(net.routes[route]!.aerobus),
    fromMunicipality: first,
    toMunicipality: other,
  });
  const table = net.bundle.fares;
  let amount = t.t('price.unknown');
  if (fareClass !== 'aerobus') {
    const fare = table.single[fareClass];
    amount = `${price(t, fare.giro)} ${t.t('pay.giro')} · ${price(t, fare.cash)} ${t.t('pay.cash')}`;
  } else if (table.aerobus.single !== null) {
    amount = price(t, table.aerobus.single);
  }
  return { label: t.t(`fare.${fareClass}` as Key), amount };
}

/**
 * The card of a line tapped on the map: its number in its colour, where it goes, who
 * runs it and what it costs, the next buses from the stop, and its whole timetable as a
 * picture like the sheets at the bus station, to save in the gallery or send on.
 */
export function LineCard({ pick, onClose }: { pick: LinePick; onClose: () => void }) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = useNow();
  const route = net.routes[pick.route]!;
  const variants = useMemo(() => lineOf(net, pick.route), [net, pick.route]);
  const pattern = pick.pattern ?? net.patterns.findIndex((p) => variants.includes(p.route));
  const stop =
    pick.stop ?? (pick.at && pattern >= 0 ? nearestStop(net, pattern, pick.at) : undefined);
  const agency = net.bundle.agencies[route.agency];
  const fare = linePrice(net, t, pick.route, pattern >= 0 ? pattern : undefined);
  const next = useMemo(() => {
    if (stop === undefined) return [];
    return net
      .departures([stop], now.date, now.time, 60)
      .filter((d) => variants.includes(d.route))
      .slice(0, 4);
  }, [net, stop, now.date, now.time, variants]);

  // The whole timetable as a picture, drawn when the card opens.
  const [sheet, setSheet] = useState<{
    url: string;
    bytes: Uint8Array;
    fileName: string;
    title: string;
  }>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'save' | 'share' | undefined>();
  const [toast, setToast] = useState<string>();
  // The picture alone, filling the map, to read it or take a screenshot of it whole.
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    setSheet(undefined);
    setFailed(false);
    void (async () => {
      try {
        const { lineSheetPng } = await import('../lib/sheetImage.ts');
        const made = lineSheet(net, t, pick.route, now.date, now.date);
        const bytes = await lineSheetPng(made);
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setSheet({ url, bytes, fileName: made.fileName, title: made.title });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // A new picture for another line or day, not for every tick of the clock.
  }, [net, pick.route, now.date, t]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2500);
  };
  const act = async (action: 'save' | 'share') => {
    if (!sheet) return;
    setBusy(action);
    try {
      if (action === 'share')
        await shareFile(sheet.bytes, sheet.fileName, sheet.title, 'image/png');
      else if (await saveFile(sheet.bytes, sheet.fileName, 'image/png')) flash(t.t('sheet.saved'));
    } catch {
      flash(t.t('sheet.failed'));
    } finally {
      setBusy(undefined);
    }
  };
  const headsign = pattern >= 0 ? net.patterns[pattern]!.headsign : route.long;

  return (
    <div
      className={`line-card${whole ? ' line-card--whole' : ''}`}
      role="dialog"
      aria-label={`${route.short} ${headsign}`}
    >
      <div className="line-card__head">
        <RouteBadge route={route} size="lg" />
        <div className="line-card__title">
          <div className="strong">{t.t('detail.towards', { h: headsign })}</div>
          <div className="muted small">
            {[agency?.name, `${fare.label}: ${fare.amount}`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button type="button" className="icon-button" aria-label={t.t('close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {stop !== undefined && (
        <div className="line-card__next small">
          <span className="muted">{t.t('lineCard.next', { stop: net.stops[stop]!.name })}</span>{' '}
          {next.length > 0 ? (
            <span className="strong">{next.map((d) => clock(d.time)).join(' · ')}</span>
          ) : (
            <span>{t.t('lineCard.none')}</span>
          )}
        </div>
      )}
      <div className="line-card__sheet">
        {sheet ? (
          <button
            type="button"
            className="line-card__picture"
            aria-pressed={whole}
            onClick={() => setWhole(!whole)}
          >
            <img src={sheet.url} alt={sheet.title} />
          </button>
        ) : failed ? (
          <p className="muted small">{t.t('sheet.failed')}</p>
        ) : (
          <p className="muted small">
            <Loader2 size={16} className="spin" aria-hidden /> {t.t('lineCard.making')}
          </p>
        )}
      </div>
      <div className="line-card__actions">
        <button
          type="button"
          className="button button--primary button--small"
          disabled={!sheet || busy !== undefined}
          onClick={() => void act('save')}
        >
          {busy === 'save' ? (
            <Loader2 size={14} className="spin" aria-hidden />
          ) : (
            <Download size={14} />
          )}{' '}
          {t.t('lineCard.save')}
        </button>
        {canShareFiles() && (
          <button
            type="button"
            className="button button--small"
            disabled={!sheet || busy !== undefined}
            onClick={() => void act('share')}
          >
            {busy === 'share' ? (
              <Loader2 size={14} className="spin" aria-hidden />
            ) : (
              <Share2 size={14} />
            )}{' '}
            {t.t('lineCard.share')}
          </button>
        )}
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            onClose();
            navigate(`lines/${variants[0] ?? pick.route}`);
          }}
        >
          {t.t('lineCard.open')} <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      {toast && (
        <div className="line-card__toast small" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** A short list to choose from when several lines lie under the finger. */
export function LineChooser({
  routes,
  onPick,
  onClose,
}: {
  routes: { route: number; pattern?: number }[];
  onPick: (choice: { route: number; pattern?: number }) => void;
  onClose: () => void;
}) {
  const t = useI18n();
  const { net } = useNetwork();
  return (
    <div className="line-card line-card--choose" role="dialog" aria-label={t.t('lineCard.which')}>
      <div className="line-card__head">
        <div className="line-card__title strong">{t.t('lineCard.which')}</div>
        <button type="button" className="icon-button" aria-label={t.t('close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ul className="line-card__list">
        {routes.map((r) => {
          const route = net.routes[r.route]!;
          const headsign = r.pattern !== undefined ? net.patterns[r.pattern]!.headsign : route.long;
          return (
            <li key={`${r.route}:${r.pattern ?? ''}`}>
              <button type="button" onClick={() => onPick(r)}>
                <RouteBadge route={route} size="sm" />
                <span>{headsign}</span>
                <ChevronRight size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
