import {
  addDays,
  CALENDAR_KINDS,
  formatDate,
  WEEKDAY_LABELS,
  weekdayOf,
  type AudienceType,
  type CalendarKind,
} from '@slash/shared';
import { dayjs, DATES_LOCALE } from '../../lib/dayjs';
import type { CalendarEvent } from './api';

/** Dot / circle colour per event kind (Mantine palette names). */
export const KIND_COLORS: Record<CalendarKind, string> = {
  holiday: 'green',
  event: 'blue',
  exam: 'orange',
  meeting: 'grape',
};

/** Colour of the audience line on announcement cards. */
export const AUDIENCE_COLORS: Record<AudienceType, string> = {
  school: 'cyan.9',
  grade_level: 'indigo.7',
  class_section: 'teal.8',
  student: 'red.7',
};

/** '2025-10-05' → 'الأحد 5/10/2025' */
export function dayLabel(iso: string): string {
  return `${WEEKDAY_LABELS[weekdayOf(iso)] ?? ''} ${formatDate(iso)}`.trim();
}

/** An ISO instant → its local calendar date ('YYYY-MM-DD'). */
export function localDate(instant: string): string {
  return dayjs(instant).format('YYYY-MM-DD');
}

/** '2025-10' → 'أكتوبر 2025' */
export function monthTitle(month: string): string {
  return dayjs(`${month}-01`).locale(DATES_LOCALE).format('MMMM YYYY');
}

/** '2025-10-05' → 'أكتوبر' */
export function monthName(iso: string): string {
  return dayjs(iso).locale(DATES_LOCALE).format('MMMM');
}

/** The month before/after 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
  return dayjs(`${month}-01`).add(delta, 'month').format('YYYY-MM');
}

export function isMonth(value: string | null): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** 'الأحد 5/10/2025' for one day, 'من 1/10/2025 إلى 3/10/2025' for a range. */
export function eventDates(e: Pick<CalendarEvent, 'startsOn' | 'endsOn'>): string {
  return e.startsOn === e.endsOn
    ? dayLabel(e.startsOn)
    : `من ${formatDate(e.startsOn)} إلى ${formatDate(e.endsOn)}`;
}

export const coversDay = (e: Pick<CalendarEvent, 'startsOn' | 'endsOn'>, day: string) =>
  e.startsOn <= day && e.endsOn >= day;

/** Kinds of the events on each day of `month` ('YYYY-MM'), in a stable order — the calendar dots. */
export function kindsByDay(events: CalendarEvent[], month: string): Map<string, CalendarKind[]> {
  const out = new Map<string, Set<CalendarKind>>();
  const first = `${month}-01`;
  const last = dayjs(first).endOf('month').format('YYYY-MM-DD');
  for (const e of events) {
    const from = e.startsOn > first ? e.startsOn : first;
    const to = e.endsOn < last ? e.endsOn : last;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const kinds = out.get(d) ?? new Set<CalendarKind>();
      kinds.add(e.kind);
      out.set(d, kinds);
    }
  }
  return new Map([...out].map(([day, kinds]) => [day, CALENDAR_KINDS.filter((k) => kinds.has(k))]));
}

/** What guardians will see above the announcement (mirrors the server's audience labels). */
export function audiencePreview(type: AudienceType, name: string | null): string | null {
  switch (type) {
    case 'school':
      return 'إعلان لجميع الطلاب';
    case 'grade_level':
    case 'class_section':
      return name ? `إعلان لطلاب ${name}` : null;
    case 'student':
      return name ? `إعلان خاص لـ ولي أمر الطالب ${name}` : null;
  }
}
