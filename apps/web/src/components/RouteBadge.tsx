import type { BRoute } from '@madeirabus/engine';
import { readableOn } from '../lib/color.ts';

interface Props {
  route: BRoute;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function RouteBadge({ route, size = 'md' }: Props) {
  const bg = `#${route.color}`;
  // Names rather than numbers ("Aerobus") get a smaller type in the large sizes.
  const long = route.short.length > 4 ? ' route-badge--long' : '';
  return (
    <span
      className={`route-badge route-badge--${size}${long}`}
      style={{ background: bg, color: readableOn(bg, `#${route.text}`) }}
      title={route.formerly ? `${route.long} (${route.formerly})` : route.long}
    >
      {route.short}
    </span>
  );
}
