import type { BRoute } from '@madeirabus/engine';
import { readableOn } from '../lib/color.ts';

export function RouteBadge({ route, size = 'md' }: { route: BRoute; size?: 'sm' | 'md' | 'lg' }) {
  const bg = `#${route.color}`;
  return (
    <span
      className={`route-badge route-badge--${size}`}
      style={{ background: bg, color: readableOn(bg, `#${route.text}`) }}
      title={route.formerly ? `${route.long} (${route.formerly})` : route.long}
    >
      {route.short}
    </span>
  );
}
