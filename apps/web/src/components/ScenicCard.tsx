import {
  Building2,
  Clock,
  Footprints,
  Mountain,
  RotateCcw,
  Sun,
  Sunset,
  Waves,
} from 'lucide-react';
import { useI18n, type Key } from '../i18n.ts';
import { clock } from '../lib/format.ts';
import { photo, type Destination, type Outlook } from '../lib/scenic.ts';
import { useNetwork } from '../state/app.tsx';
import { RouteBadge } from './RouteBadge.tsx';

interface Props {
  d: Destination;
  /** Today's buses there, shown on large cards. */
  outlook?: Outlook;
  size?: 'large' | 'small';
  /** No buses there in the app yet. */
  soon?: boolean;
}

/** What a place without a photo yet shows on the colours of its region. */
const REGION_ICONS = {
  funchal: Building2,
  mountains: Mountain,
  west: Sunset,
  north: Waves,
  east: Sun,
} as const;

/** A place's photo or, with none yet, its region's colours and sign. */
export function ScenicArt({ d, className }: { d: Destination; className: string }) {
  const Icon = REGION_ICONS[d.region];
  return (
    <span className={`${className} scenic-art scenic-art--${d.region}`} aria-hidden>
      <Icon className="scenic-art__icon" strokeWidth={1.25} />
    </span>
  );
}

/** A photo of a place, its name and how today's buses get there. */
export function ScenicCard({ d, outlook, size = 'large', soon = false }: Props) {
  const t = useI18n();
  const { net } = useNetwork();
  const small = photo(d, 'sm');
  return (
    <a
      className={`scenic-card scenic-card--${size}${soon ? ' scenic-card--soon' : ''}`}
      href={`#/explore/${d.id}`}
    >
      {small ? (
        <img
          className="scenic-card__photo"
          src={small}
          srcSet={size === 'large' ? `${small} 480w, ${photo(d, 'lg')} 960w` : undefined}
          sizes={size === 'large' ? '(min-width: 900px) 410px, 100vw' : undefined}
          width={480}
          height={320}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <ScenicArt d={d} className="scenic-card__photo" />
      )}
      <span className="scenic-card__shade" aria-hidden />
      {soon && <span className="scenic-card__soon">{t.t('scenic.soon')}</span>}
      <span className="scenic-card__body">
        <span className="scenic-card__tag">{t.t(`scenic.${d.id}.tag` as Key)}</span>
        <span className="scenic-card__name">{d.name}</span>
        {outlook && size === 'large' && (
          <span className="scenic-card__meta">
            {outlook.walk !== undefined ? (
              <span className="scenic-card__fact">
                <Footprints size={14} aria-hidden /> {t.t('walk.min', { m: outlook.walk })}
              </span>
            ) : (
              <>
                {outlook.routes.slice(0, 3).map((r) => (
                  <RouteBadge key={r} route={net.routes[r]!} size="sm" />
                ))}
                {outlook.minutes !== undefined && (
                  <span className="scenic-card__fact">
                    <Clock size={14} aria-hidden /> {t.t('scenic.minutes', { m: outlook.minutes })}
                  </span>
                )}
                {outlook.lastBack !== undefined && (
                  <span className="scenic-card__fact">
                    <RotateCcw size={14} aria-hidden />{' '}
                    {t.t('scenic.lastBack', { t: clock(outlook.lastBack) })}
                  </span>
                )}
              </>
            )}
          </span>
        )}
      </span>
    </a>
  );
}
