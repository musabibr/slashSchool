import type { DateRange } from '../enums';

// Dates are passed around as ISO calendar dates ('YYYY-MM-DD') — never as Date objects —
// so "today" is always computed in the school's timezone, not the server's.

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Calendar date of `now` in the given IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return toUtc(iso).getUTCDay();
}

export function monthBounds(iso: string): { from: string; to: string } {
  const d = toUtc(iso);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function weekBounds(iso: string, weekStart: number): { from: string; to: string } {
  const offset = (weekdayOf(iso) - weekStart + 7) % 7;
  const from = addDays(iso, -offset);
  return { from, to: addDays(from, 6) };
}

/**
 * Inclusive bounds for the lesson/homework filters (P5, P7).
 * `all` returns nulls — no date filter.
 */
export function dateRangeBounds(
  range: DateRange,
  today: string,
  weekStart: number,
): { from: string | null; to: string | null } {
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return weekBounds(today, weekStart);
    case 'month':
      return monthBounds(today);
    case 'all':
      return { from: null, to: null };
  }
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
