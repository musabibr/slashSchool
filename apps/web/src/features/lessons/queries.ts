import { useEffect, useRef } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { DateRange } from '@slash/shared';
import { api, qs } from '../../api/client';
import { notifyError } from '../../lib/notify';
import type { GuardianHomework, GuardianLesson, LessonModule, StaffLesson, SubjectTile } from './types';

// ───────────────────────────── Query keys ─────────────────────────────

export const guardianKeys = {
  module: (studentId: string, module: LessonModule) => ['students', studentId, module] as const,
  subjects: (studentId: string, module: LessonModule) => ['students', studentId, module, 'subjects'] as const,
  lists: (studentId: string, module: LessonModule) => ['students', studentId, module, 'list'] as const,
  list: (studentId: string, module: LessonModule, subjectId: string, range: DateRange) =>
    ['students', studentId, module, 'list', subjectId, range] as const,
};

export interface StaffLessonFilters {
  classId: string | null;
  subjectId: string | null;
  from?: string | null;
  to?: string | null;
}

export const staffKeys = {
  all: (schoolId: string) => ['schools', schoolId, 'lessons'] as const,
  list: (schoolId: string, filters: StaffLessonFilters, pageSize: number) =>
    ['schools', schoolId, 'lessons', 'list', filters, pageSize] as const,
  detail: (schoolId: string, lessonId: string) => ['schools', schoolId, 'lessons', 'detail', lessonId] as const,
};

// ───────────────────────────── Guardian ─────────────────────────────

/**
 * Subject tiles for P4 / P6. Loading them marks the module as seen on the server, so the home badge
 * (summary) is refreshed afterwards. `fresh` refetches on every mount so per-subject badges are current.
 */
export function useGuardianSubjects(studentId: string, module: LessonModule, { fresh = false } = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: guardianKeys.subjects(studentId, module),
    queryFn: () => api.get<SubjectTile[]>(`/api/students/${studentId}/subjects${qs({ module })}`),
    refetchOnMount: fresh ? 'always' : true,
  });
  const { isSuccess, dataUpdatedAt } = query;
  // Only after a fetch made while mounted (not when the tiles merely came from the cache).
  const lastSynced = useRef(dataUpdatedAt);
  useEffect(() => {
    if (!isSuccess || dataUpdatedAt === lastSynced.current) return;
    lastSynced.current = dataUpdatedAt;
    void qc.invalidateQueries({ queryKey: ['students', studentId, 'summary'] });
  }, [qc, studentId, isSuccess, dataUpdatedAt]);
  return query;
}

export function useGuardianLessons(studentId: string, subjectId: string, range: DateRange) {
  return useQuery({
    queryKey: guardianKeys.list(studentId, 'lessons', subjectId, range),
    queryFn: () => api.get<GuardianLesson[]>(`/api/students/${studentId}/lessons${qs({ subjectId, range })}`),
    placeholderData: keepPreviousData,
  });
}

export function useGuardianHomework(studentId: string, subjectId: string, range: DateRange) {
  return useQuery({
    queryKey: guardianKeys.list(studentId, 'homework', subjectId, range),
    queryFn: () => api.get<GuardianHomework[]>(`/api/students/${studentId}/homework${qs({ subjectId, range })}`),
    placeholderData: keepPreviousData,
  });
}

/** The "تم" checkbox (P7), applied optimistically and rolled back on failure. */
export function useToggleHomework(studentId: string, listKey: QueryKey) {
  const qc = useQueryClient();
  const mutationKey = ['students', studentId, 'homework', 'done'];
  return useMutation({
    mutationKey,
    mutationFn: ({ lessonId, done }: { lessonId: string; done: boolean }) =>
      api.put<{ lessonId: string; done: boolean }>(`/api/students/${studentId}/homework/${lessonId}/done`, { done }),
    onMutate: async ({ lessonId, done }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<GuardianHomework[]>(listKey);
      qc.setQueryData<GuardianHomework[]>(listKey, (list) =>
        list?.map((h) => (h.id === lessonId ? { ...h, done } : h)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
      notifyError(err);
    },
    onSettled: () => {
      // Refetch only once the last pending toggle settles, so a quick second tick is not overwritten.
      if (qc.isMutating({ mutationKey }) === 1) {
        void qc.invalidateQueries({ queryKey: guardianKeys.lists(studentId, 'homework') });
      }
    },
  });
}

// ───────────────────────────── Staff ─────────────────────────────

export function useStaffLessons(schoolId: string, filters: StaffLessonFilters, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: staffKeys.list(schoolId, filters, pageSize),
    queryFn: ({ pageParam }) =>
      api.get<StaffLesson[]>(
        `/api/schools/${schoolId}/lessons${qs({ ...filters, limit: pageSize, offset: pageParam })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < pageSize ? undefined : pages.length * pageSize),
    placeholderData: keepPreviousData,
  });
}

export function useStaffLesson(schoolId: string, lessonId: string | undefined) {
  return useQuery({
    queryKey: staffKeys.detail(schoolId, lessonId ?? ''),
    queryFn: () => api.get<StaffLesson>(`/api/schools/${schoolId}/lessons/${lessonId}`),
    enabled: !!lessonId,
  });
}
