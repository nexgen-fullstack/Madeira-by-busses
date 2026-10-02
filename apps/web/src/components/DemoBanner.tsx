import { FlaskConical, WifiOff } from 'lucide-react';
import { useI18n } from '../i18n.ts';
import { useApp } from '../state/app.tsx';

export function StatusBanners() {
  const t = useI18n();
  const { data, online } = useApp();
  const demo = data.status === 'ready' && data.net.bundle.demo;
  return (
    <>
      {demo && (
        <div className="banner banner--demo" role="note">
          <FlaskConical size={16} aria-hidden />
          <span>{t.t('demo.banner')}</span>
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
