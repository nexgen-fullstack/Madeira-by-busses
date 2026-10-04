import { useMemo, useState, type CSSProperties } from 'react';
import { Search, X } from 'lucide-react';
import { madeiraNow } from '@madeirabus/engine';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n } from '../i18n.ts';
import { lineColors } from '../lib/color.ts';
import { lineGroups, lineMatches } from '../lib/lines.ts';
import { networkContent } from '../lib/mapContent.ts';
import { navigate, type Route } from '../lib/router.ts';
import { useNetwork } from '../state/app.tsx';

export function LinesView({ route }: { route: Route }) {
  const t = useI18n();
  const { net } = useNetwork();
  // A printed timetable links here with its line number.
  const [query, setQuery] = useState(() => route.query.get('q') ?? '');
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

  const lines = useMemo(() => lineGroups(net), [net]);
  const byAgency = useMemo(
    () =>
      net.bundle.agencies.map((agency, a) => ({
        agency,
        lines: lines.filter((l) => l.agency === a && lineMatches(net, l, query)),
      })),
    [net, lines, query],
  );
  const found = byAgency.some((s) => s.lines.length > 0);

  return (
    <div className="lines">
      <div className="lines__head">
        <h2 className="view-title">{t.t('lines.title')}</h2>
        <label className="search-field">
          <Search size={18} aria-hidden className="search-field__icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.t('lines.search')}
            aria-label={t.t('lines.search')}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label={t.t('place.clear')}
              onClick={() => setQuery('')}
            >
              <X size={16} />
            </button>
          )}
        </label>
      </div>
      {!found && <p className="muted">{t.t('lines.none', { q: query.trim() })}</p>}
      {byAgency.map(({ agency, lines: shown }) =>
        shown.length === 0 ? null : (
          <section key={agency.id} className="line-section" aria-label={agency.name}>
            <h3 className="line-section__title">
              {agency.name} <span className="count-badge">{shown.length}</span>
            </h3>
            <ul className="line-grid">
              {shown.map((line) => {
                const main = line.routes[0]!;
                const r = net.routes[main]!;
                const trips = line.routes.reduce((n, i) => n + (tripsToday.get(i) ?? 0), 0);
                return (
                  <li key={main}>
                    <button
                      type="button"
                      className="line-tile"
                      style={lineColors(`#${r.color}`) as CSSProperties}
                      onClick={() => navigate(`lines/${main}`)}
                    >
                      <span className="line-tile__number">{r.short}</span>
                      {r.formerly && (
                        <span className="line-tile__was">
                          {t.t('lines.formerly', { n: r.formerly })}
                        </span>
                      )}
                      <span className="line-tile__name">{r.long}</span>
                      <span className="line-tile__meta">{t.tn('lines.trips', trips)}</span>
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
