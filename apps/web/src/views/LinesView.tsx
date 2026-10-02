import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { madeiraNow } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { networkContent } from '../lib/mapContent.ts';
import { navigate } from '../lib/router.ts';
import { useNetwork } from '../state/app.tsx';

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function LinesView() {
  const t = useI18n();
  const { net } = useNetwork();
  useMapContent(useMemo(() => networkContent(net), [net]));

  const today = madeiraNow().date;
  const tripsToday = useMemo(() => {
    const day = net.timetable(today);
    const counts = new Map<number, number>();
    net.patterns.forEach((p, i) =>
      counts.set(p.route, (counts.get(p.route) ?? 0) + day.patterns[i]!.start.length),
    );
    return counts;
  }, [net, today]);

  const byAgency = useMemo(
    () =>
      net.bundle.agencies.map((agency, a) => ({
        agency,
        routes: net.routes
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.agency === a)
          .sort((x, y) => natural.compare(x.r.short, y.r.short)),
      })),
    [net],
  );

  return (
    <div className="lines">
      <h2 className="view-title">{t.t('lines.title')}</h2>
      {byAgency.map(({ agency, routes }) =>
        routes.length === 0 ? null : (
          <section key={agency.id} className="card">
            <h3 className="card__title">{agency.name}</h3>
            <ul className="line-list">
              {routes.map(({ r, i }) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="line-list__row"
                    onClick={() => navigate(`lines/${i}`)}
                  >
                    <RouteBadge route={r} />
                    <span className="line-list__name">
                      {r.long}
                      <span className="muted small">
                        {t.tn('lines.trips', tripsToday.get(i) ?? 0)}
                      </span>
                    </span>
                    <ChevronRight size={18} aria-hidden className="muted" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
