import { useState } from 'react';
import { CalendarClock, FlaskConical, WifiOff, X } from 'lucide-react';
import { madeiraNow } from '@madeirabus/engine';
import { useI18n } from '../i18n.ts';
import { fullDate } from '../lib/format.ts';
import { load, save } from '../lib/storage.ts';
import { useApp } from '../state/app.tsx';

const DISMISSED_KEY = 'madeirabus.dataNotice.v1';

export function StatusBanners() {
  const t = useI18n();
  const { data, online } = useApp();
  const bundle = data.status === 'ready' ? data.net.bundle : undefined;
  // The data notice comes back whenever a new timetable is published.
  const [dismissed, setDismissed] = useState(() => load(DISMISSED_KEY, { at: '' }).at);
  const projected =
    bundle?.projected && madeiraNow().date > bundle.projected.officialUntil
      ? bundle.projected
      : undefined;
  const missing = bundle?.missingOperators ?? [];
  const showNotice =
    bundle && !bundle.demo && (projected || missing.length > 0) && dismissed !== bundle.generatedAt;
  return (
    <>
      {bundle?.demo && (
        <div className="banner banner--demo" role="note">
          <FlaskConical size={16} aria-hidden />
          <span>{t.t('demo.banner')}</span>
        </div>
      )}
      {showNotice && (
        <div className="banner banner--info" role="note">
          <CalendarClock size={16} aria-hidden />
          <span>
            {projected && t.t('data.projected', { date: fullDate(t, projected.officialUntil) })}
            {projected && missing.length > 0 && ' '}
            {missing.length > 0 && t.t('data.missing', { operators: missing.join(', ') })}
          </span>
          <button
            type="button"
            className="banner__close"
            aria-label={t.t('close')}
            onClick={() => {
              save(DISMISSED_KEY, { at: bundle.generatedAt });
              setDismissed(bundle.generatedAt);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!online && (
        <div className="banner banner--offline" role="status">
          <WifiOff size={16} aria-hidden />
          <span>{t.t('offline')}</span>
        </div>
      )}
    </>
  );
}
