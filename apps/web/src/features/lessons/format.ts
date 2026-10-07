import { DATE_RANGES, formatDate, WEEKDAY_LABELS, weekdayOf, type DateRange } from '@slash/shared';

/** '2025-10-05' → 'الأحد 5/10/2025' */
export function dayLabel(iso: string): string {
  return `${WEEKDAY_LABELS[weekdayOf(iso)] ?? ''} ${formatDate(iso)}`.trim();
}

/** 1536 → '2 كيلوبايت', 2_500_000 → '2.4 ميجابايت' */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function parseRange(value: string | null, fallback: DateRange): DateRange {
  return (DATE_RANGES as readonly string[]).includes(value ?? '') ? (value as DateRange) : fallback;
}

const EMPTY_LESSONS: Record<DateRange, string> = {
  today: 'لا توجد دروس اليوم',
  week: 'لا توجد دروس هذا الأسبوع',
  month: 'لا توجد دروس هذا الشهر',
  all: 'لا توجد دروس بعد',
};

const EMPTY_HOMEWORK: Record<DateRange, string> = {
  today: 'لا توجد واجبات اليوم',
  week: 'لا توجد واجبات هذا الأسبوع',
  month: 'لا توجد واجبات هذا الشهر',
  all: 'لا توجد واجبات بعد',
};

export const emptyMessage = (module: 'lessons' | 'homework', range: DateRange) =>
  (module === 'lessons' ? EMPTY_LESSONS : EMPTY_HOMEWORK)[range];
