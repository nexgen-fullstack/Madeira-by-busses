import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Footprints,
  Navigation,
  PlayCircle,
  RotateCcw,
  Share2,
  Ticket,
} from 'lucide-react';
import { adviseTicket, type Itinerary } from '@madeirabus/engine';
import { useI18n, type Key } from '../i18n.ts';
import { clock, duration, price } from '../lib/format.ts';
import { fareRides } from '../lib/itinerary.ts';
import { useApp, useNetwork } from '../state/app.tsx';
import { RouteBadge } from './RouteBadge.tsx';

interface Props {
  it: Itinerary;
  date: string;
  onBack: () => void;
  onStart: (simulate: boolean) => void;
  onShare: () => void;
}

export function ItineraryDetail({ it, date, onBack, onStart, onShare }: Props) {
  const t = useI18n();
  const { net, planner } = useNetwork();
  const { settings } = useApp();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [lastBack, setLastBack] = useState<{ state: 'loading' } | { state: 'done'; time?: number }>(
    { state: 'loading' },
  );

  const firstLeg = it.legs[0]!;
  const lastLeg = it.legs[it.legs.length - 1]!;

  useEffect(() => {
    if (it.rides === 0) return;
    let cancelled = false;
    setLastBack({ state: 'loading' });
    const origin =
      firstLeg.kind === 'ride' ? { ...firstLeg.from, stops: [firstLeg.from.stop!] } : firstLeg.from;
    const dest =
      lastLeg.kind === 'ride' ? { ...lastLeg.to, stops: [lastLeg.to.stop!] } : lastLeg.to;
    planner
      .lastConnection({
        from: dest,
        to: origin,
        date,
        time: it.arrive,
        options: { walkSpeed: settings.walkSpeed },
      })
      .then((r) => {
        if (!cancelled)
          setLastBack({ state: 'done', time: r?.legs.find((l) => l.kind === 'ride')?.start });
      })
      .catch(() => !cancelled && setLastBack({ state: 'done' }));
    return () => {
      cancelled = true;
    };
  }, [it, date, planner, settings.walkSpeed, firstLeg, lastLeg]);

  const rides = useMemo(() => fareRides(net, it), [net, it]);
  const advice = useMemo(
    () => (rides.length ? adviseTicket([...rides, ...rides], net.bundle.fares) : undefined),
    [rides, net],
  );
  const total = settings.payment === 'cash' ? it.fare.cash : it.fare.giro;

  const toggle = (i: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="detail">
      <div className="detail__header">
        <button type="button" className="icon-button" onClick={onBack} aria-label={t.t('back')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="detail__times">
            {clock(it.depart)} – {clock(it.arrive)}
          </div>
          <div className="detail__sub">
            {duration(t, it.duration)} ·{' '}
            {it.rides === 0
              ? t.t('it.walkOnly')
              : it.transfers === 0
                ? t.t('it.direct')
                : t.tn('it.transfers', it.transfers)}
            {it.rides > 0 && <> · {total !== null ? price(t, total) : t.t('price.unknown')}</>}
          </div>
        </div>
      </div>

      <ol className="timeline">
        {it.legs.map((leg, i) => {
          if (leg.kind === 'walk') {
            const minutes = Math.max(1, Math.round((leg.end - leg.start) / 60));
            return (
              <li key={i} className="timeline__walk">
                <span className="timeline__time">{clock(leg.start)}</span>
                <span className="timeline__icon">
                  <Footprints size={16} />
                </span>
                <div>
                  <div>{t.t('walk.min', { m: minutes })}</div>
                  <div className="muted">
                    {t.t('walk.dist', { d: leg.distance })} · {leg.to.name}
                  </div>
                </div>
              </li>
            );
          }
          const route = net.routes[leg.route]!;
          const between = leg.stops.slice(1, -1);
          const open = expanded.has(i);
          return (
            <li
              key={i}
              className="timeline__ride"
              style={{ ['--route' as string]: `#${route.color}` }}
            >
              {leg.wait >= 60 && (
                <div className="timeline__wait">
                  <Clock size={14} aria-hidden /> {t.t('wait', { d: duration(t, leg.wait) })}
                  {leg.risky && (
                    <span className="badge badge--warn" title={t.t('it.riskyHint')}>
                      <AlertTriangle size={12} aria-hidden /> {t.t('it.risky')}
                    </span>
                  )}
                </div>
              )}
              <div className="timeline__stop timeline__stop--board">
                <span className="timeline__time strong">{clock(leg.start)}</span>
                <span className="timeline__dot" />
                <div>
                  <div className="strong">{leg.from.name}</div>
                  <div className="timeline__route">
                    <RouteBadge route={route} size="sm" />{' '}
                    {t.t('detail.towards', { h: leg.headsign })}
                  </div>
                  {leg.nextDeparture !== undefined && (
                    <div className="muted small">
                      {t.t('detail.next', { t: clock(leg.nextDeparture) })}
                    </div>
                  )}
                </div>
              </div>
              {between.length > 0 && (
                <button
                  type="button"
                  className="timeline__toggle"
                  onClick={() => toggle(i)}
                  aria-expanded={open}
                >
                  {t.tn('detail.stops', between.length + 1)} · {duration(t, leg.end - leg.start)}
                </button>
              )}
              {open && (
                <ul className="timeline__between">
                  {between.map((s) => (
                    <li key={s.stop}>
                      <span className="timeline__time">{clock(s.dep)}</span>
                      <span className="timeline__mini-dot" />
                      <span>{net.stops[s.stop]!.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="timeline__stop timeline__stop--alight">
                <span className="timeline__time strong">{clock(leg.end)}</span>
                <span className="timeline__dot" />
                <div className="strong">{leg.to.name}</div>
              </div>
            </li>
          );
        })}
        {lastLeg.kind === 'walk' && (
          <li className="timeline__end">
            <span className="timeline__time strong">{clock(it.arrive)}</span>
            <span className="timeline__icon">
              <Navigation size={16} />
            </span>
            <div className="strong">{lastLeg.to.name}</div>
          </li>
        )}
      </ol>

      {it.rides > 0 && (
        <div className="detail__actions">
          <button type="button" className="button button--primary" onClick={() => onStart(false)}>
            <Navigation size={18} /> {t.t('detail.start')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => onStart(true)}
            title={t.t('trip.simulateHint')}
          >
            <PlayCircle size={18} /> {t.t('detail.simulate')}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={onShare}
            aria-label={t.t('detail.share')}
          >
            <Share2 size={18} />
          </button>
        </div>
      )}

      {it.rides > 0 && (
        <section className="card">
          <h3 className="card__title">
            <RotateCcw size={16} aria-hidden />{' '}
            {lastBack.state === 'loading'
              ? t.t('return.checking')
              : lastBack.time !== undefined
                ? t.t('return.last', { t: clock(lastBack.time) })
                : t.t('return.none')}
          </h3>
        </section>
      )}

      {it.rides > 0 && (
        <section className="card">
          <h3 className="card__title">
            <Ticket size={16} aria-hidden /> {t.t('ticket.title')}
          </h3>
          <ul className="fares">
            {it.legs
              .filter((l) => l.kind === 'ride')
              .map((l, i) => {
                const f = it.fare.rides[i]!;
                const r = net.routes[l.route]!;
                return (
                  <li key={i}>
                    <RouteBadge route={r} size="sm" />
                    <span className="muted">{t.t(`fare.${f.fareClass}` as Key)}</span>
                    <span className="fares__price">
                      {f.giro !== null
                        ? `${price(t, f.giro)} ${t.t('pay.giro')} · ${price(t, f.cash!)} ${t.t('pay.cash')}`
                        : t.t('price.unknown')}
                    </span>
                  </li>
                );
              })}
          </ul>
          {advice && (
            <p className="fares__advice">
              {advice.best.total !== null &&
                t.t('ticket.best', {
                  name: t.t(`pass.${advice.best.id}` as Key),
                  price: price(t, advice.best.total),
                })}
              {advice.saving > 0 && <> — {t.t('ticket.save', { s: price(t, advice.saving) })}</>}
            </p>
          )}
          <p className="muted small">{t.t('fare.note')}</p>
        </section>
      )}
    </div>
  );
}
