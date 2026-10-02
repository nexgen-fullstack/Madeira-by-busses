import type { BRoute } from '@madeirabus/engine';

export function RouteBadge({ route, size = 'md' }: { route: BRoute; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={`route-badge route-badge--${size}`}
      style={{ background: `#${route.color}`, color: `#${route.text}` }}
      title={route.long}
    >
      {route.short}
    </span>
  );
}
