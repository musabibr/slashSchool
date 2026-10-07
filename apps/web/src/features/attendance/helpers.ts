import { useSearchParams } from 'react-router';
import { formatDate, isIsoDate, weekdayOf, WEEKDAY_LABELS } from '@slash/shared';
import type { AttendanceToday } from './api';

export interface ClassDate {
  classId: string | null;
  date: string | null;
}

/** "الأحد 5/10/2025" */
export function dayLabel(date: string): string {
  return `${WEEKDAY_LABELS[weekdayOf(date)]} ${formatDate(date)}`;
}

export function recordedSummary(data: AttendanceToday): string {
  const done = data.classes.filter((c) => c.recorded).length;
  return `تم تسجيل الغياب في ${done} من ${data.classes.length} فصول`;
}

/** ?classId&date (&mode) from the URL, invalid dates ignored; `set` replaces the history entry. */
export function useClassDateParams() {
  const [params, setParams] = useSearchParams();
  const rawDate = params.get('date');
  const value: ClassDate = {
    classId: params.get('classId') || null,
    date: rawDate && isIsoDate(rawDate) ? rawDate : null,
  };
  const set = (next: ClassDate) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const key of ['classId', 'date'] as const) {
          const v = next[key];
          if (v) p.set(key, v);
          else p.delete(key);
        }
        return p;
      },
      { replace: true },
    );
  return { ...value, mode: params.get('mode'), set };
}
