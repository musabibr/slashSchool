import { addDays, formatDate, weekdayOf, WEEKDAY_LABELS, type ExamPeriodKind } from '@slash/shared';

/** '2025-10-05' → 'الأحد 5/10/2025' */
export function dayLabel(iso: string): string {
  return `${WEEKDAY_LABELS[weekdayOf(iso)] ?? ''} ${formatDate(iso)}`.trim();
}

/** 18.5 → '18.5', 20 → '20' (Western digits, at most two decimals). */
export function formatScore(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** "15 من 30" */
export function scoreOf(score: number, maxScore: number): string {
  return `${formatScore(score)} من ${maxScore}`;
}

/** The exam types offered in S12, in the sketch's order. */
export const PERIOD_KIND_OPTIONS: Array<{ value: ExamPeriodKind; label: string }> = [
  { value: 'monthly', label: 'شهري' },
  { value: 'term', label: 'فترة' },
  { value: 'weekly', label: 'أسبوعي' },
  { value: 'final', label: 'نهائي' },
];

export const PERIOD_KIND_SHORT: Record<ExamPeriodKind, string> = {
  monthly: 'شهري',
  term: 'فترة',
  weekly: 'أسبوعي',
  final: 'نهائي',
};

const MONTHS = [
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
];

/** A ready-made period name so staff rarely need to type one. */
export function defaultPeriodName(kind: ExamPeriodKind, today: string | undefined): string {
  switch (kind) {
    case 'monthly':
      return today ? `الامتحانات الشهرية - ${MONTHS[Number(today.slice(5, 7)) - 1]}` : 'الامتحانات الشهرية';
    case 'weekly':
      return 'الامتحان الأسبوعي';
    case 'term':
      return 'امتحانات الفترة';
    case 'final':
      return 'الامتحانات النهائية';
  }
}

/** Friday and Saturday. */
const WEEKEND = new Set([5, 6]);

/** The next school day on or after `iso` (skips the weekend). */
export function nextSchoolDay(iso: string): string {
  let d = iso;
  while (WEEKEND.has(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

/** `count` consecutive school days starting on (or after) `from`. */
export function schoolDays(from: string, count: number): string[] {
  const out: string[] = [];
  let d = nextSchoolDay(from);
  while (out.length < count) {
    out.push(d);
    d = nextSchoolDay(addDays(d, 1));
  }
  return out;
}

/** Colour of a grade label, from the percentage. */
export function gradeColor(percentage: number): string {
  if (percentage >= 75) return 'teal';
  if (percentage >= 50) return 'blue';
  return 'red';
}
