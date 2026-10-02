import { haversine, type GtfsFeed, type NetworkBundle } from '@madeirabus/engine';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  count: number;
  samples: string[];
}

/** Bounding box of the archipelago (Madeira + Porto Santo + Desertas). */
const BBOX = { minLat: 32.3, maxLat: 33.2, minLon: -17.4, maxLon: -16.1 };
/** Faster than this between consecutive stops means broken data (km/h). */
const MAX_SPEED_KMH = 110;

class IssueCollector {
  private readonly map = new Map<string, Issue>();

  add(severity: Severity, code: string, message: string, sample: string) {
    const issue = this.map.get(code);
    if (issue) {
      issue.count++;
      if (issue.samples.length < 5) issue.samples.push(sample);
    } else {
      this.map.set(code, { severity, code, message, count: 1, samples: [sample] });
    }
  }

  list(): Issue[] {
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    return [...this.map.values()].sort(
      (a, b) => order[a.severity] - order[b.severity] || b.count - a.count,
    );
  }
}

/** Checks a parsed feed for problems that would produce wrong journeys. */
export function validateFeed(feed: GtfsFeed, today: string): Issue[] {
  const issues = new IssueCollector();
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.add('error', `duplicate-${kind}`, `Duplicate ${kind} id`, id);
      seen.add(id);
    }
    return seen;
  };
  const stopIds = dup(
    'stop',
    feed.stops.map((s) => s.stop_id),
  );
  const routeIds = dup(
    'route',
    feed.routes.map((r) => r.route_id),
  );
  const tripIds = dup(
    'trip',
    feed.trips.map((t) => t.trip_id),
  );
  const serviceIds = new Set([
    ...feed.calendars.map((c) => c.service_id),
    ...feed.calendarDates.map((c) => c.service_id),
  ]);

  const stopsById = new Map(feed.stops.map((s) => [s.stop_id, s]));
  for (const s of feed.stops) {
    if (!Number.isFinite(s.stop_lat) || !Number.isFinite(s.stop_lon)) {
      issues.add('error', 'stop-no-coordinates', 'Stop without coordinates', s.stop_id);
    } else if (
      s.stop_lat < BBOX.minLat ||
      s.stop_lat > BBOX.maxLat ||
      s.stop_lon < BBOX.minLon ||
      s.stop_lon > BBOX.maxLon
    ) {
      issues.add(
        'error',
        'stop-outside-madeira',
        'Stop outside the Madeira archipelago',
        `${s.stop_id} (${s.stop_lat}, ${s.stop_lon})`,
      );
    }
    if (!s.stop_name) issues.add('warning', 'stop-no-name', 'Stop without a name', s.stop_id);
  }

  const routesWithTrips = new Set<string>();
  for (const t of feed.trips) {
    if (!routeIds.has(t.route_id))
      issues.add('error', 'trip-unknown-route', 'Trip references an unknown route', t.trip_id);
    if (!serviceIds.has(t.service_id))
      issues.add('error', 'trip-unknown-service', 'Trip references an unknown service', t.trip_id);
    routesWithTrips.add(t.route_id);
  }
  for (const r of feed.routes) {
    if (!routesWithTrips.has(r.route_id))
      issues.add('warning', 'route-without-trips', 'Route has no trips', r.route_id);
    if (!r.route_short_name && !r.route_long_name)
      issues.add('warning', 'route-no-name', 'Route without a name', r.route_id);
  }

  const byTrip = new Map<string, typeof feed.stopTimes>();
  for (const st of feed.stopTimes) {
    if (!tripIds.has(st.trip_id))
      issues.add(
        'error',
        'stop-time-unknown-trip',
        'stop_times row references an unknown trip',
        st.trip_id,
      );
    if (!stopIds.has(st.stop_id))
      issues.add(
        'error',
        'stop-time-unknown-stop',
        'stop_times row references an unknown stop',
        `${st.trip_id} → ${st.stop_id}`,
      );
    const list = byTrip.get(st.trip_id);
    if (list) list.push(st);
    else byTrip.set(st.trip_id, [st]);
  }
  for (const [tripId, sts] of byTrip) {
    sts.sort((a, b) => a.stop_sequence - b.stop_sequence);
    let prevTime: number | undefined;
    let prevStop: (typeof feed.stops)[number] | undefined;
    for (const st of sts) {
      const time = st.arrival_time ?? st.departure_time;
      const stop = stopsById.get(st.stop_id);
      if (time !== undefined && prevTime !== undefined) {
        if (time < prevTime) {
          issues.add(
            'error',
            'time-travel',
            'Times go backwards within a trip',
            `${tripId} at ${st.stop_id}`,
          );
        } else if (stop && prevStop) {
          const km =
            haversine(
              { lat: prevStop.stop_lat, lon: prevStop.stop_lon },
              { lat: stop.stop_lat, lon: stop.stop_lon },
            ) / 1000;
          const hours = Math.max(time - prevTime, 30) / 3600;
          if (km > 1 && km / hours > MAX_SPEED_KMH) {
            issues.add(
              'warning',
              'teleport',
              `Implausible speed (> ${MAX_SPEED_KMH} km/h) between stops`,
              `${tripId}: ${prevStop.stop_id} → ${stop.stop_id} ${Math.round(km / hours)} km/h`,
            );
          }
        }
      }
      if (time !== undefined) {
        prevTime = st.departure_time ?? time;
        prevStop = stop;
      }
    }
    if (sts.length < 2)
      issues.add('warning', 'trip-too-short', 'Trip with fewer than two stops', tripId);
  }
  for (const t of feed.trips) {
    if (!byTrip.has(t.trip_id))
      issues.add('warning', 'trip-without-times', 'Trip without stop_times', t.trip_id);
  }

  const todayCompact = today.replaceAll('-', '');
  const lastDate = [
    ...feed.calendars.map((c) => c.end_date),
    ...feed.calendarDates.filter((c) => c.exception_type === 1).map((c) => c.date),
  ]
    .sort()
    .pop();
  if (lastDate && lastDate < todayCompact) {
    issues.add(
      'error',
      'feed-expired',
      'The whole timetable has expired',
      `last service date ${lastDate}`,
    );
  }
  return issues.list();
}

/** Checks the merged bundle: coverage of the coming days and fare coverage. */
export function validateBundle(bundle: NetworkBundle, today: string): Issue[] {
  const issues = new IssueCollector();
  const in14 = new Date(`${today}T00:00:00Z`);
  in14.setUTCDate(in14.getUTCDate() + 14);
  const horizon = in14.toISOString().slice(0, 10);
  if (bundle.validity.to < horizon) {
    issues.add(
      'warning',
      'validity-short',
      'Timetable ends within 14 days',
      `valid to ${bundle.validity.to}`,
    );
  }
  const guessed = bundle.stops.filter((s) => s.muniGuessed).length;
  if (guessed > 0) {
    issues.add(
      'info',
      'municipality-guessed',
      `${guessed} stops got their municipality from the nearest seat; fares near borders may be off`,
      `${guessed} stops`,
    );
  }
  if (!bundle.fares.verified) {
    issues.add(
      'info',
      'fares-unverified',
      'Fare table not yet confirmed with Tiim',
      bundle.fares.source,
    );
  }
  if (bundle.routes.some((r) => r.aerobus) && bundle.fares.aerobus.single === null) {
    issues.add(
      'info',
      'aerobus-fare-unknown',
      'Aerobus single fare unknown; the app shows it as "price to confirm"',
      'aerobus',
    );
  }
  return issues.list();
}
