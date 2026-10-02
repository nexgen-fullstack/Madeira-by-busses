import { madeiraNow, type Departure } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { clock } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useNetwork } from '../state/app.tsx';
import { RouteBadge } from './RouteBadge.tsx';

export function DepartureList({ departures, date }: { departures: Departure[]; date: string }) {
  const t = useI18n();
  const { net } = useNetwork();
  const now = madeiraNow();
  if (departures.length === 0) return <p className="muted small">{t.t('dep.noMore')}</p>;
  return (
    <ul className="departures">
      {departures.map((d) => {
        const mins = date === now.date ? Math.round((d.time - now.time) / 60) : undefined;
        return (
          <li key={`${d.tripId}@${d.time}`}>
            <button
              type="button"
              className="departures__row"
              onClick={() => navigate(`lines/${d.route}`)}
            >
              <RouteBadge route={net.routes[d.route]!} />
              <span className="departures__headsign">
                {d.headsign}
                {d.last && <span className="badge badge--muted">{t.t('dep.last')}</span>}
              </span>
              <span className="departures__time">
                {mins !== undefined && mins <= 60
                  ? mins <= 0
                    ? t.t('dep.now')
                    : t.t('dep.in', { n: mins })
                  : clock(d.time)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
