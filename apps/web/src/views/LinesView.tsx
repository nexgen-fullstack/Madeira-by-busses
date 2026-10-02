import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { madeiraNow } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n.ts';
import { lineGroups } from '../lib/lines.ts';
import { networkContent } from '../lib/mapContent.ts';
import { navigate } from '../lib/router.ts';
import { useNetwork } from '../state/app.tsx';

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

  const byAgency = useMemo(() => {
    const lines = lineGroups(net);
    return net.bundle.agencies.map((agency, a) => ({
      agency,
      lines: lines.filter((l) => l.agency === a),
    }));
  }, [net]);

  return (
    <div className="lines">
      <h2 className="view-title">{t.t('lines.title')}</h2>
      {byAgency.map(({ agency, lines }) =>
        lines.length === 0 ? null : (
          <section key={agency.id} className="card">
            <h3 className="card__title">{agency.name}</h3>
            <ul className="line-list">
              {lines.map((line) => {
                const main = line.routes[0]!;
                const route = net.routes[main]!;
                const trips = line.routes.reduce((n, r) => n + (tripsToday.get(r) ?? 0), 0);
                return (
                  <li key={main}>
                    <button
                      type="button"
                      className="line-list__row"
                      onClick={() => navigate(`lines/${main}`)}
                    >
                      <RouteBadge route={route} />
                      <span className="line-list__name">
                        {route.long}
                        <span className="muted small">
                          {t.tn('lines.trips', trips)}
                          {line.routes.length > 1 &&
                            ` · ${t.tn('lines.variants', line.routes.length)}`}
                        </span>
                      </span>
                      <ChevronRight size={18} aria-hidden className="muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
