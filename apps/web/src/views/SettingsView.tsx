import { Database, Info } from 'lucide-react';
import { useI18n, LANGS } from '../i18n.ts';
import { fullDate, shortDate } from '../lib/format.ts';
import { lineGroups } from '../lib/lines.ts';
import { useApp } from '../state/app.tsx';

const PACES = [
  { value: 1.0, key: 'settings.slow' },
  { value: 1.25, key: 'settings.normal' },
  { value: 1.5, key: 'settings.fast' },
] as const;

export function SettingsView() {
  const t = useI18n();
  const { settings, setSettings, data } = useApp();
  if (data.status !== 'ready') throw new Error('Network not ready');
  const { net, fallback } = data;
  const b = net.bundle;
  const lines = lineGroups(net).length;

  return (
    <div className="settings">
      <h2 className="view-title">{t.t('tab.settings')}</h2>
      <section className="card">
        <h3 className="card__title">{t.t('settings.language')}</h3>
        <div className="lang-grid" role="group" aria-label={t.t('settings.language')}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={settings.lang === l.code}
              onClick={() => setSettings({ lang: l.code })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3 className="card__title">{t.t('settings.payment')}</h3>
        <div className="segmented" role="group" aria-label={t.t('settings.payment')}>
          <button
            type="button"
            aria-pressed={settings.payment === 'giro'}
            onClick={() => setSettings({ payment: 'giro' })}
          >
            {t.t('settings.giro')}
          </button>
          <button
            type="button"
            aria-pressed={settings.payment === 'cash'}
            onClick={() => setSettings({ payment: 'cash' })}
          >
            {t.t('settings.cash')}
          </button>
        </div>
      </section>
      <section className="card">
        <h3 className="card__title">{t.t('settings.walk')}</h3>
        <div className="segmented" role="group" aria-label={t.t('settings.walk')}>
          {PACES.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={settings.walkSpeed === p.value}
              onClick={() => setSettings({ walkSpeed: p.value })}
            >
              {t.t(p.key)}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3 className="card__title">
          <Database size={16} aria-hidden /> {t.t('settings.data')}
          {b.demo && <span className="badge badge--demo">{t.t('demo.badge')}</span>}
        </h3>
        <div
          className="segmented segmented--wrap"
          role="group"
          aria-label={t.t('settings.dataset')}
        >
          {(['real', 'demo'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={settings.dataset === d}
              onClick={() => settings.dataset !== d && setSettings({ dataset: d })}
            >
              {t.t(d === 'real' ? 'settings.real' : 'settings.demo')}
            </button>
          ))}
        </div>
        {fallback && <p className="muted small">{t.t('settings.realMissing')}</p>}
        {b.projected && (
          <p className="muted small">
            {t.t('data.projected', { date: fullDate(t, b.projected.officialUntil) })}
          </p>
        )}
        {b.missingOperators && b.missingOperators.length > 0 && (
          <p className="muted small">
            {t.t('data.missing', { operators: b.missingOperators.join(', ') })}
          </p>
        )}
        <p>
          {t.t('settings.validity', {
            from: shortDate(t, b.validity.from),
            to: shortDate(t, b.validity.to),
          })}
        </p>
        <p className="muted">
          {t.t('settings.stats', {
            stops: b.stats.stops,
            routes: lines,
            trips: b.stats.trips,
          })}
        </p>
        <p className="muted small">
          {t.t('settings.sources')}:{' '}
          {b.sources.map((s) => (s.url ? `${s.name} (${s.url})` : s.name)).join(', ')}
        </p>
        <p className="muted small">{t.t('fare.note')}</p>
      </section>
      <section className="card">
        <h3 className="card__title">
          <Info size={16} aria-hidden /> {t.t('settings.about')}
        </h3>
        <p>{t.t('settings.aboutText')}</p>
        <p className="muted small">© OpenStreetMap contributors · OpenFreeMap</p>
      </section>
    </div>
  );
}
