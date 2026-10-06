import type { Itinerary, PlanRequest } from '@madeirabus/engine';

/**
 * The options found for a trip, each with its day: those of the day asked and, when no
 * bus goes there any more that day, those of the first day after it one does — as a
 * maps app offers tomorrow's first buses late at night.
 */
export interface Found {
  options: Itinerary[];
  /** The day of each option (ISO date). */
  days: string[];
}

/** What plans a trip: the planner worker, or the engine itself in tests. */
export interface TripPlanner {
  plan(request: PlanRequest): Promise<Itinerary[]>;
  ahead(request: PlanRequest): Promise<{ date: string; itineraries: Itinerary[] } | null>;
}

/**
 * The options for a request; when none of them goes by bus and `ahead` allows it (the
 * day was not chosen by hand), followed by the first later day's.
 */
export async function findOptions(
  planner: TripPlanner,
  request: PlanRequest,
  ahead: boolean,
): Promise<Found> {
  const options = await planner.plan(request);
  const days = options.map(() => request.date);
  if (!ahead || options.some((it) => it.rides > 0)) return { options, days };
  const later = await planner.ahead(request);
  if (!later) return { options, days };
  return {
    options: [...options, ...later.itineraries],
    days: [...days, ...later.itineraries.map(() => later.date)],
  };
}

/** The options in runs of one day, with the index in `found` each run starts at. */
export function dayGroups(found: Found): { day: string; start: number; options: Itinerary[] }[] {
  const groups: { day: string; start: number; options: Itinerary[] }[] = [];
  found.options.forEach((it, i) => {
    const day = found.days[i]!;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.options.push(it);
    else groups.push({ day, start: i, options: [it] });
  });
  return groups;
}

/** When the first of some options leaves (s). */
export const firstDeparture = (options: readonly Itinerary[]) =>
  Math.min(...options.map((it) => it.depart));
