import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { weekdayOf } from '@slash/shared';
import { api, qs } from '../../api/client';

/** GET /api/schools/:schoolId/timetable/class/:classId */
export interface ClassSlot {
  id: string;
  weekday: number;
  period: number;
  subjectId: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
}

/** GET /api/schools/:schoolId/timetable/mine */
export interface MySlot {
  weekday: number;
  period: number;
  classId: string;
  classLabel: string;
  subjectName: string;
}

export interface SlotInput {
  period: number;
  subjectId: string;
  teacherId: string | null;
}

/** School days offered in the pickers: Sunday … Thursday, then Saturday for schools that open on it. */
export const SCHOOL_DAYS = [0, 1, 2, 3, 4, 6] as const;
/** Columns of the director's weekly grid (Saturday is optional). */
export const WEEK_COLUMNS = [0, 1, 2, 3, 4] as const;

/** Today's weekday when it is a school day, else Sunday. */
export function defaultWeekday(today: string | undefined): number {
  if (!today) return 0;
  const day = weekdayOf(today);
  return (SCHOOL_DAYS as readonly number[]).includes(day) ? day : 0;
}

const key = (schoolId: string) => ['schools', schoolId, 'timetable'] as const;

export function useClassTimetable(schoolId: string, classId: string | null) {
  return useQuery({
    queryKey: [...key(schoolId), 'class', classId],
    queryFn: () => api.get<ClassSlot[]>(`/api/schools/${schoolId}/timetable/class/${classId}`),
    enabled: !!classId,
  });
}

export function useMyTimetable(schoolId: string, weekday: number) {
  return useQuery({
    queryKey: [...key(schoolId), 'mine', weekday],
    queryFn: () => api.get<MySlot[]>(`/api/schools/${schoolId}/timetable/mine${qs({ weekday })}`),
  });
}

/** Replace one class's periods for one weekday. */
export function useSaveTimetableDay(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, weekday, slots }: { classId: string; weekday: number; slots: SlotInput[] }) =>
      api.put<ClassSlot[]>(`/api/schools/${schoolId}/timetable/class/${classId}/${weekday}`, { slots }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(schoolId) }),
  });
}
