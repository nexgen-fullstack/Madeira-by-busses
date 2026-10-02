import { describe, expect, it } from 'vitest';
import { adviseTicket, quoteFare, SIGA_FARES_2026, type FareRide } from './fares.ts';

const ride = (from: string, to: string, aerobus = false): FareRide => ({
  aerobus,
  fromMunicipality: from,
  toMunicipality: to,
});

describe('fares', () => {
  it('quotes municipal and intermunicipal rides', () => {
    const q = quoteFare([ride('FNC', 'FNC'), ride('FNC', 'RBR')], SIGA_FARES_2026);
    expect(q.rides.map((r) => r.fareClass)).toEqual(['municipal', 'intermunicipal']);
    expect(q.giro).toBe(3.4);
    expect(q.cash).toBe(4.6);
    expect(q.complete).toBe(true);
  });

  it('does not invent a price for the Aerobus', () => {
    const q = quoteFare([ride('SCR', 'FNC', true), ride('FNC', 'RBR')], SIGA_FARES_2026);
    expect(q.giro).toBeNull();
    expect(q.knownGiro).toBe(1.95);
    expect(q.complete).toBe(false);
  });

  it('recommends a day pass when it is cheaper', () => {
    const day = [ride('FNC', 'RBR'), ride('RBR', 'PMZ'), ride('PMZ', 'RBR'), ride('RBR', 'FNC')];
    const advice = adviseTicket(day, SIGA_FARES_2026);
    expect(advice.options[0]!.total).toBe(7.8);
    expect(advice.best.id).toBe('day1-intermunicipal');
    expect(advice.saving).toBe(1.25);
  });

  it('keeps singles for a single short ride', () => {
    expect(adviseTicket([ride('FNC', 'FNC')], SIGA_FARES_2026).best.id).toBe('singles');
  });

  it('covers an unknown Aerobus fare only with the tourist pass', () => {
    const advice = adviseTicket([ride('SCR', 'FNC', true), ride('FNC', 'FNC')], SIGA_FARES_2026);
    expect(advice.best.id).toBe('tourist1');
    expect(advice.options.find((o) => o.id === 'singles')!.total).toBeNull();
  });

  it('multiplies one-day passes over several days', () => {
    const rides = Array.from({ length: 12 }, () => ride('FNC', 'CML'));
    const advice = adviseTicket(rides, SIGA_FARES_2026, 3);
    const daily = advice.options.find((o) => o.id === 'day1-intermunicipal')!;
    expect(daily.count).toBe(3);
    expect(advice.best.id).toBe('day3-intermunicipal');
  });
});
