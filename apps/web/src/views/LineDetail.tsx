import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { madeiraNow } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { clock, longDate } from '../lib/format.ts';
import { routeContent } from '../lib/mapContent.ts';
import { navigate } from '../lib/router.ts';
import { useNetwork } from '../state/app.tsx';

export function LineDetail({ routeIndex }: { routeIndex: number }) {
  const t = useI18n();
  const { net } = useNetwork();
  const [date, setDate] = useState(madeiraNow().date);
  const [dirIndex, setDirIndex] = useState(0);
  const route = net.routes[routeIndex];

  // Directions = patterns grouped by terminus pair, most-served pattern first.
  const directions = useMemo(() => {
    const groups = new Map<string, number[]>();
    net.patterns.forEach((p, i) => {
      if (p.route !== routeIndex) return;
      const key = `${net.stops[p.stops[0]!]!.name} → ${net.stops[p.stops[p.stops.length - 1]!]!.name}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    return [...groups.entries()].map(([label, patterns]) => ({
      label,
      patterns: patterns.sort(
        (a, b) => net.patterns[b]!.trips.length - net.patterns[a]!.trips.length,
      ),
    }));
  }, [net, routeIndex]);
  const dir = directions[Math.min(dirIndex, directions.length - 1)];
  const main = dir?.patterns[0];

  useMapContent(
    useMemo(
      () => (route ? routeContent(net, routeIndex, main) : undefined),
      [net, route, routeIndex, main],
    ),
  );

  const times = useMemo(() => {
    if (!dir) return [];
    const day = net.timetable(date);
    return dir.patterns
      .flatMap((p) =>
        day.patterns[p]!.start.map((_, j) => net.departureAt(p, day.patterns[p]!, j, 0)),
      )
      .sort((a, b) => a - b);
  }, [net, dir, date]);

  const byHour = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const s of times) {
      const h = Math.floor(s / 3600);
      m.set(h, [...(m.get(h) ?? []), s]);
    }
    return [...m.entries()];
  }, [times]);

  if (!route || !dir || main === undefined) return <p className="error">?</p>;
  const agency = net.bundle.agencies[route.agency]!;
  const stops = net.patterns[main]!.stops;

  return (
    <div className="line-detail">
      <div className="detail__header">
        <button
          type="button"
          className="icon-button"
          onClick={() => navigate('lines')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <RouteBadge route={route} size="lg" />
        <div>
          <h2 className="view-title">{route.long}</h2>
          <div className="muted small">{agency.name}</div>
        </div>
      </div>

      {directions.length > 1 && (
        <div className="segmented segmented--wrap" role="group" aria-label={t.t('lines.direction')}>
          {directions.map((d, i) => (
            <button
              key={d.label}
              type="button"
              aria-pressed={d === dir}
              onClick={() => setDirIndex(i)}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <div className="card__row">
          <h3 className="card__title">{t.t('lines.timetable', { date: longDate(t, date) })}</h3>
          <input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
        {times.length === 0 ? (
          <p className="muted">{t.t('lines.noService')}</p>
        ) : (
          <table className="timetable">
            <tbody>
              {byHour.map(([h, list]) => (
                <tr key={h}>
                  <th scope="row">{String(h % 24).padStart(2, '0')}</th>
                  <td>
                    {list.map((s) => (
                      <span key={s}>{clock(s).slice(3)}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3 className="card__title">{t.t('lines.stops')}</h3>
        <ol className="stop-line" style={{ ['--route' as string]: `#${route.color}` }}>
          {stops.map((s, i) => (
            <li key={`${s}-${i}`}>
              <button type="button" onClick={() => navigate('stop', { ids: String(s) })}>
                {net.stops[s]!.name}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
