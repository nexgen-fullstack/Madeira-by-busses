import { formatClock, weekday } from '@madeirabus/engine';
import type { I18n } from '../i18n.ts';

export const clock = formatClock;

/** Whole days from one ISO date to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** "tomorrow", "on Monday" (in the week to come) or the date: when `date` is, seen from `today`. */
export function dayAhead(t: I18n, date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 1) return t.t('day.tomorrow');
  if (days > 1 && days < 7) return t.t('day.on').split('|')[weekday(date)] ?? longDate(t, date);
  return longDate(t, date);
}

/** The text with a capital letter, as it starts a sentence. */
export const capitalise = (t: I18n, text: string) =>
  text.charAt(0).toLocaleUpperCase(t.locale) + text.slice(1);

/** "Tomorrow from 07:30", "On Monday from 07:30": the first bus of a later day. */
export function aheadFrom(t: I18n, date: string, today: string, time: number, capital = true) {
  const text = t.t('ahead.from', { day: dayAhead(t, date, today), t: clock(time) });
  return capital ? capitalise(t, text) : text;
}

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

/** "7 October" in the reader's language. */
export function dayMonth(t: I18n, iso: string): string {
  return new Intl.DateTimeFormat(t.locale, {
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

/** "31 July 2026" in the reader's language. */
export function fullDate(t: I18n, iso: string): string {
  return new Intl.DateTimeFormat(t.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}
