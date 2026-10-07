import { addDays, weekdayOf } from '@slash/shared';

/** Africa/Khartoum is UTC+2 all year (no daylight saving). */
const KHARTOUM_UTC_OFFSET_HOURS = 2;

export const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

/** Arabic name of the month of an ISO date. */
export function arabicMonthOf(date: string): string {
  return ARABIC_MONTHS[Number(date.slice(5, 7)) - 1];
}

/** First day of the month of `date`, shifted by `months` (e.g. -1 = previous month). */
export function monthStart(date: string, months = 0): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const d = new Date(Date.UTC(year, month, 1));
  return d.toISOString().slice(0, 10);
}

export interface AcademicYearDates {
  startYear: number;
  /** "2025/2026" */
  name: string;
  startsOn: string;
  endsOn: string;
}

/** The academic year containing `today`: 1 July → 30 June. */
export function academicYearOf(today: string): AcademicYearDates {
  const year = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= 7 ? year : year - 1;
  return {
    startYear,
    name: `${startYear}/${startYear + 1}`,
    startsOn: `${startYear}-07-01`,
    endsOn: `${startYear + 1}-06-30`,
  };
}

/** Friday and Saturday. */
export function isWeekend(date: string): boolean {
  const weekday = weekdayOf(date);
  return weekday === 5 || weekday === 6;
}

export const minDate = (a: string, b: string) => (a < b ? a : b);
export const maxDate = (a: string, b: string) => (a > b ? a : b);

/**
 * School days (Sunday–Thursday, minus holidays) around `today`, and Khartoum-time instants that are
 * never later than the real clock (so nothing in the demo appears to come from the future).
 */
export class SchoolCalendar {
  /** The latest school day on or before today (Thursday when today is Friday/Saturday). */
  readonly latest: string;
  private readonly nowMs: number;

  constructor(
    readonly today: string,
    private readonly holidays: ReadonlySet<string>,
    now: Date,
  ) {
    this.nowMs = now.getTime();
    this.latest = this.onOrBefore(today);
  }

  isSchoolDay(date: string): boolean {
    return !isWeekend(date) && !this.holidays.has(date);
  }

  /** Latest school day on or before `date`. */
  onOrBefore(date: string): string {
    let d = date;
    while (!this.isSchoolDay(d)) d = addDays(d, -1);
    return d;
  }

  /** First school day on or after `date`. */
  onOrAfter(date: string): string {
    let d = date;
    while (!this.isSchoolDay(d)) d = addDays(d, 1);
    return d;
  }

  /** First school day strictly after `date`. */
  after(date: string): string {
    return this.onOrAfter(addDays(date, 1));
  }

  /** The `count` school days ending with the latest one, newest first. */
  recent(count: number): string[] {
    const out: string[] = [];
    for (let d = this.latest; out.length < count; d = addDays(d, -1)) {
      if (this.isSchoolDay(d)) out.push(d);
    }
    return out;
  }

  /** `count` consecutive school days starting on or after `from`, oldest first. */
  run(from: string, count: number): string[] {
    const out: string[] = [];
    for (let d = this.onOrAfter(from); out.length < count; d = this.after(d)) out.push(d);
    return out;
  }

  /** The instant `hours:minutes` Khartoum time on `date`, capped at one minute before now. */
  at(date: string, hours: number, minutes = 0): Date {
    const [y, m, d] = date.split('-').map(Number);
    const ms = Date.UTC(y, m - 1, d, hours - KHARTOUM_UTC_OFFSET_HOURS, minutes);
    return new Date(Math.min(ms, this.nowMs - 60_000));
  }
}
