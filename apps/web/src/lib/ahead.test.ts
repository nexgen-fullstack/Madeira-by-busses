import { describe, expect, it } from 'vitest';
import type { Itinerary, PlanRequest } from '@madeirabus/engine';
import { makeI18n } from '../i18n.ts';
import { dayGroups, findOptions, firstDeparture, type TripPlanner } from './ahead.ts';
import { aheadFrom, dayAhead } from './format.ts';

const option = (depart: number, rides = 1) =>
  ({ key: `${depart}|${rides}`, depart, rides }) as unknown as Itinerary;

/** A planner with these options on the day asked, and these on the next day a bus goes. */
function fake(today: Itinerary[], later?: { date: string; itineraries: Itinerary[] }) {
  const asked: string[] = [];
  const planner: TripPlanner = {
    plan: async () => today,
    ahead: async (r: PlanRequest) => {
      asked.push(r.date);
      return later ?? null;
    },
  };
  return { planner, asked };
}

const request = { from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 0 }, date: '2026-10-06', time: 0 };

describe('options of a later day', () => {
  it("adds the next day's buses when none goes any more today", async () => {
    // At 22:40 nothing goes to Tabua; a long walk is all that is left of today.
    const walk = option(81600, 0);
    const morning = [option(6 * 3600 + 45 * 60), option(7 * 3600 + 30 * 60)];
    const { planner } = fake([walk], { date: '2026-10-07', itineraries: morning });
    const found = await findOptions(planner, request, true);
    expect(found.options).toEqual([walk, ...morning]);
    expect(found.days).toEqual(['2026-10-06', '2026-10-07', '2026-10-07']);
    expect(dayGroups(found).map((g) => [g.day, g.start, g.options.length])).toEqual([
      ['2026-10-06', 0, 1],
      ['2026-10-07', 1, 2],
    ]);
    expect(firstDeparture(morning)).toBe(6 * 3600 + 45 * 60);
  });

  it('looks no further when a bus goes today, or when the day was chosen by hand', async () => {
    const today = fake([option(80000)], { date: '2026-10-07', itineraries: [option(25000)] });
    expect((await findOptions(today.planner, request, true)).options).toHaveLength(1);
    expect(today.asked).toEqual([]);
    const chosen = fake([], { date: '2026-10-07', itineraries: [option(25000)] });
    expect((await findOptions(chosen.planner, request, false)).options).toEqual([]);
    expect(chosen.asked).toEqual([]);
  });

  it('tells the day in words: tomorrow, a weekday of the week to come, or the date', () => {
    const uk = makeI18n('uk');
    const en = makeI18n('en');
    // Tuesday 6 October 2026.
    expect(aheadFrom(uk, '2026-10-07', '2026-10-06', 7 * 3600 + 30 * 60)).toBe('Завтра з 07:30');
    expect(aheadFrom(uk, '2026-10-12', '2026-10-06', 7 * 3600 + 35 * 60)).toBe(
      'У понеділок з 07:35',
    );
    expect(aheadFrom(uk, '2026-10-07', '2026-10-06', 7 * 3600 + 35 * 60, false)).toBe(
      'завтра з 07:35',
    );
    expect(aheadFrom(en, '2026-10-09', '2026-10-06', 6 * 3600)).toBe('On Friday from 06:00');
    expect(dayAhead(en, '2026-10-20', '2026-10-06')).toMatch(/20 October/);
  });
});
