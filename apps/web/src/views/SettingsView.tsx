import { useEffect, useState } from 'react';
import { Camera, ChevronDown, Database, Download, Info, Smartphone } from 'lucide-react';
import { useI18n, LANGS } from '../i18n.ts';
import { isNative } from '../lib/device.ts';
import { fullDate, shortDate } from '../lib/format.ts';
import { lineGroups } from '../lib/lines.ts';
import { canInstall, install, isStandalone, onInstallChange } from '../lib/pwa.ts';
import { DESTINATIONS } from '../lib/scenic.ts';
import { photoCredits } from '../lib/photos.ts';
import { APP_NAME } from '../lib/site.ts';
import { useApp } from '../state/app.tsx';

/** The latest Android build, published by the "Android app" workflow. */
const APK_URL =
  import.meta.env.VITE_ANDROID_APK ||
  'https://github.com/nexgen-fullstack/Madeira-by-busses/releases/latest/download/Madeira-by-busses.apk';

/** Install the website as an app, or download the Android app. */
function InstallCard() {
  const t = useI18n();
  const [installable, setInstallable] = useState(canInstall);
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);
  if (isNative()) return null;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return (
    <section className="card">
      <h3 className="card__title">
        <Smartphone size={16} aria-hidden /> {t.t('install.title')}
      </h3>
      <p>{t.t('install.text')}</p>
      <div className="detail__actions">
        {installable && (
          <button type="button" className="button button--primary" onClick={() => void install()}>
            <Download size={18} /> {t.t('install.button')}
          </button>
        )}
        {!ios && (
          <a className="button" href={APK_URL} rel="noopener">
            <Download size={18} /> {t.t('install.android')}
          </a>
        )}
      </div>
      {!ios && <p className="muted small">{t.t('install.androidHint')}</p>}
      {ios && !isStandalone() && <p className="muted small">{t.t('install.ios')}</p>}
    </section>
  );
}

const PACES = [
  { value: 1.0, key: 'settings.slow' },
  { value: 1.25, key: 'settings.normal' },
  { value: 1.5, key: 'settings.fast' },
] as const;

const ROUTES = [
  { value: 'best', key: 'settings.routeBest', hint: 'settings.routeBestHint' },
  { value: 'fewerTransfers', key: 'settings.routeTransfers', hint: 'settings.routeTransfersHint' },
  { value: 'lessWalking', key: 'settings.routeWalk', hint: 'settings.routeWalkHint' },
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
      <InstallCard />
      <section className="card">
        <h3 className="card__title">{t.t('settings.payment')}</h3>
        <div className="segmented" role="group" aria-label={t.t('settings.payment')}>
          <button
            type="button"
            aria-pressed={settings.payment === 'cash'}
            onClick={() => setSettings({ payment: 'cash', paymentChosen: true })}
          >
            {t.t('settings.cash')}
          </button>
          <button
            type="button"
            aria-pressed={settings.payment === 'giro'}
            onClick={() => setSettings({ payment: 'giro', paymentChosen: true })}
          >
            {t.t('settings.giro')}
          </button>
        </div>
      </section>
      <section className="card">
        <h3 className="card__title">{t.t('settings.route')}</h3>
        <div className="segmented segmented--wrap" role="group" aria-label={t.t('settings.route')}>
          {ROUTES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={settings.route === r.value}
              onClick={() => setSettings({ route: r.value })}
            >
              {t.t(r.key)}
            </button>
          ))}
        </div>
        <p className="muted small">
          {t.t(ROUTES.find((r) => r.value === settings.route)?.hint ?? 'settings.routeBestHint')}
        </p>
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
        {b.partialOperators && b.partialOperators.length > 0 && (
          <p className="muted small">
            {t.t('data.partial', { operators: b.partialOperators.join(', ') })}
          </p>
        )}
        <p>
          {t.t('settings.validity', {
            from: shortDate(t, b.validity.from),
            to: shortDate(t, b.validity.to),
          })}
        </p>
        {/* Where the timetable comes from: a tap away, not a screen of small print. */}
        <details className="fold">
          <summary className="fold__head">
            {t.t('settings.sources')}
            <ChevronDown size={16} aria-hidden className="fold__chevron" />
          </summary>
          <p className="muted">
            {t.t('settings.stats', {
              stops: b.stats.stops,
              routes: lines,
              trips: b.stats.trips,
            })}
          </p>
          <p className="muted small">
            {b.sources.map((s) => (s.url ? `${s.name} (${s.url})` : s.name)).join(', ')}
          </p>
          <p className="muted small">{t.t('fare.note')}</p>
        </details>
      </section>
      {/* Who took the photos and under which licence: one tap opens the list. */}
      <details className="card fold">
        <summary className="fold__head">
          <h3 className="card__title">
            <Camera size={16} aria-hidden /> {t.t('scenic.credits')}
          </h3>
          <ChevronDown size={18} aria-hidden className="fold__chevron" />
        </summary>
        <p className="muted small">{t.t('scenic.creditsHint')}</p>
        <ul className="credits">
          {DESTINATIONS.flatMap(({ id, name, credit }) =>
            credit
              ? [
                  <li key={id}>
                    <a href={credit.source} target="_blank" rel="noopener noreferrer">
                      {name}
                    </a>{' '}
                    — {credit.author},{' '}
                    <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer">
                      {credit.license}
                    </a>
                  </li>,
                ]
              : [],
          )}
          {photoCredits().map((p) => (
            <li key={p.file}>
              <a href={p.source} target="_blank" rel="noopener noreferrer">
                {p.title}
              </a>{' '}
              — {p.author},{' '}
              <a href={p.licenseUrl} target="_blank" rel="noopener noreferrer">
                {p.license}
              </a>
            </li>
          ))}
        </ul>
        <p className="muted small">Inter · SIL Open Font License 1.1</p>
      </details>
      <section className="card">
        <h3 className="card__title">
          <Info size={16} aria-hidden /> {t.t('settings.about')}
        </h3>
        <div className="about">
          <img className="about__logo" src="logo.png" alt="" width={64} height={64} />
          <div>
            <p className="about__name">{APP_NAME}</p>
            <p className="muted small">{t.t('settings.slogan')}</p>
            {__APP_VERSION__ && (
              <p className="muted small">{t.t('settings.version', { version: __APP_VERSION__ })}</p>
            )}
          </div>
        </div>
        <p>{t.t('settings.aboutText')}</p>
        <p className="small">
          <a href="privacy.html" target="_blank" rel="noopener noreferrer">
            {t.t('settings.privacy')}
          </a>
        </p>
        <p className="muted small">© OpenStreetMap contributors · OpenFreeMap</p>
      </section>
    </div>
  );
}
