import { formatClock } from '@madeirabus/engine';
import type { I18n } from '../i18n.ts';

export const clock = formatClock;

export function duration(t: I18n, seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return t.t('dur.m', { m });
  return m === 0 ? t.t('dur.h', { h }) : t.t('dur.hm', { h, m });
}

export function price(t: I18n, value: number): string {
  return new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'EUR' }).format(value);
}

export function longDate(t: I18n, iso: string): string {
  return new Intl.DateTimeFormat(t.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function shortDate(t: I18n, iso: string): string {
  return new Intl.DateTimeFormat(t.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** "HH:MM" from an <input type=time> value to seconds. */
export function parseTimeInput(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60;
}

export function toTimeInput(seconds: number): string {
  return formatClock(seconds);
}
