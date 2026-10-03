import { useMemo } from 'react';
import { ArrowLeft, Flag, MapPin, Star } from 'lucide-react';
import { municipalityName } from '@madeirabus/engine';
import { DepartureList } from '../components/DepartureList.tsx';
import { useMapContent } from '../components/mapContext.tsx';
import { useI18n } from '../i18n.ts';
import { encodePlace } from '../lib/itinerary.ts';
import { stopsContent } from '../lib/mapContent.ts';
import { goBack, navigate, type Route } from '../lib/router.ts';
import { isSaved, toSaved } from '../lib/saved.ts';
import { useNow } from '../lib/useNow.ts';
import { useApp, useNetwork } from '../state/app.tsx';

export function StopView({ route }: { route: Route }) {
  const t = useI18n();
  const { net } = useNetwork();
  const { saved, toggleSaved } = useApp();
  const now = useNow();
  const ids = useMemo(
    () =>
      (route.query.get('ids') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < net.stops.length),
    [route, net],
  );
  const first = net.stops[ids[0] ?? -1];
  const group = useMemo(
    () =>
      first
        ? {
            name: first.name,
            muni: first.muni,
            stops: ids,
            lat: ids.reduce((a, s) => a + net.stops[s]!.lat, 0) / ids.length,
            lon: ids.reduce((a, s) => a + net.stops[s]!.lon, 0) / ids.length,
          }
        : undefined,
    [first, ids, net],
  );
  useMapContent(
    useMemo(
      () => (group ? stopsContent([group], undefined, `stop:${ids.join('.')}`) : undefined),
      [group, ids],
    ),
  );

  if (!group) return <p className="error">?</p>;
  const place = encodePlace(group, net);
  const starred = isSaved(net, saved, group.stops);
  return (
    <div className="stop-view">
      <div className="detail__header">
        <button
          type="button"
          className="icon-button"
          onClick={() => goBack('nearby')}
          aria-label={t.t('back')}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="detail__grow">
          <h2 className="view-title">{group.name}</h2>
          <div className="muted small">{municipalityName(group.muni)}</div>
        </div>
        <button
          type="button"
          className={`icon-button star ${starred ? 'star--on' : ''}`}
          aria-pressed={starred}
          aria-label={t.t(starred ? 'saved.remove' : 'saved.add')}
          title={t.t(starred ? 'saved.remove' : 'saved.add')}
          onClick={() => toggleSaved(toSaved(net, group))}
        >
          <Star size={22} fill={starred ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="detail__actions">
        <button type="button" className="button" onClick={() => navigate('plan', { from: place })}>
          <MapPin size={16} /> {t.t('from')}
        </button>
        <button type="button" className="button" onClick={() => navigate('plan', { to: place })}>
          <Flag size={16} /> {t.t('to')}
        </button>
      </div>
      <section className="card">
        <DepartureList
          departures={net.departures(group.stops, now.date, now.time, 15)}
          date={now.date}
        />
      </section>
    </div>
  );
}
