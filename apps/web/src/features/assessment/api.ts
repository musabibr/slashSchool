import { useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AssessmentKind, ExamPeriodKind } from '@slash/shared';
import { api, ApiError, qs } from '../../api/client';
import type {
  Assessment,
  ExamPeriod,
  GuardianExams,
  PeriodResults,
  PeriodTimetable,
  QuizPayload,
  ResultItem,
  ResultSheet,
  ScoreSheet,
  TimetableRowInput,
} from './types';

// ───────────────────────────── Query keys ─────────────────────────────

export const staffKeys = {
  all: (schoolId: string) => ['schools', schoolId, 'assessment'] as const,
  periods: (schoolId: string, gradeLevelId: string | null) =>
    ['schools', schoolId, 'assessment', 'periods', gradeLevelId] as const,
  timetable: (schoolId: string, periodId: string) => ['schools', schoolId, 'assessment', 'timetable', periodId] as const,
  results: (schoolId: string, periodId: string, classId: string | null) =>
    ['schools', schoolId, 'assessment', 'results', periodId, classId] as const,
  list: (schoolId: string, filters: AssessmentFilters) => ['schools', schoolId, 'assessment', 'list', filters] as const,
  detail: (schoolId: string, id: string) => ['schools', schoolId, 'assessment', 'detail', id] as const,
  scores: (schoolId: string, id: string) => ['schools', schoolId, 'assessment', 'scores', id] as const,
};

export const studentKeys = {
  exams: (studentId: string) => ['students', studentId, 'exams'] as const,
  results: (studentId: string) => ['students', studentId, 'results'] as const,
  sheet: (studentId: string, periodId: string) => ['students', studentId, 'results', periodId] as const,
};

/** Staff changes show up on every student's exams/results screens (guardian app and admin profile). */
function invalidateAfterStaffChange(qc: QueryClient, schoolId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: staffKeys.all(schoolId) }),
    qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === 'students' && (q.queryKey[2] === 'exams' || q.queryKey[2] === 'results'),
    }),
  ]);
}

// ───────────────────────────── Staff: exam periods ─────────────────────────────

export function usePeriods(schoolId: string, gradeLevelId: string | null) {
  return useQuery({
    queryKey: staffKeys.periods(schoolId, gradeLevelId),
    queryFn: () => api.get<ExamPeriod[]>(`/api/schools/${schoolId}/exam-periods${qs({ gradeLevelId })}`),
    enabled: !!gradeLevelId,
  });
}

export function usePeriodTimetable(schoolId: string, periodId: string | null) {
  return useQuery({
    queryKey: staffKeys.timetable(schoolId, periodId ?? ''),
    queryFn: () => api.get<PeriodTimetable>(`/api/schools/${schoolId}/exam-periods/${periodId}/timetable`),
    enabled: !!periodId,
  });
}

export function usePeriodResults(schoolId: string, periodId: string, classId: string | null, enabled = true) {
  return useQuery({
    queryKey: staffKeys.results(schoolId, periodId, classId),
    queryFn: () => api.get<PeriodResults>(`/api/schools/${schoolId}/exam-periods/${periodId}/results${qs({ classId })}`),
    enabled: enabled && !!classId,
    placeholderData: keepPreviousData,
  });
}

export function useCreatePeriod(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { gradeLevelId: string; kind: ExamPeriodKind; name: string }) =>
      api.post<ExamPeriod>(`/api/schools/${schoolId}/exam-periods`, body),
    onSuccess: () => invalidateAfterStaffChange(qc, schoolId),
  });
}

export function useUpdatePeriod(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; kind: ExamPeriodKind }) =>
      api.patch<ExamPeriod>(`/api/schools/${schoolId}/exam-periods/${id}`, body),
    onSuccess: () => invalidateAfterStaffChange(qc, schoolId),
  });
}

export function useDeletePeriod(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/exam-periods/${id}`),
    onSuccess: () => invalidateAfterStaffChange(qc, schoolId),
  });
}

export function useSaveTimetable(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId, rows }: { periodId: string; rows: TimetableRowInput[] }) =>
      api.put<PeriodTimetable>(`/api/schools/${schoolId}/exam-periods/${periodId}/timetable`, { rows }),
    onSuccess: (data) => {
      qc.setQueryData(staffKeys.timetable(schoolId, data.period.id), data);
      return invalidateAfterStaffChange(qc, schoolId);
    },
  });
}

export function usePublishPeriod(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId, published }: { periodId: string; published: boolean }) =>
      api.post<ExamPeriod>(`/api/schools/${schoolId}/exam-periods/${periodId}/publish`, { published }),
    onSuccess: () => invalidateAfterStaffChange(qc, schoolId),
  });
}

// ───────────────────────────── Staff: quizzes & grades ─────────────────────────────

export interface AssessmentFilters {
  classId?: string | null;
  subjectId?: string | null;
  kind?: AssessmentKind | null;
}

export function useAssessments(schoolId: string, filters: AssessmentFilters, enabled = true) {
  return useQuery({
    queryKey: staffKeys.list(schoolId, filters),
    queryFn: () => api.get<Assessment[]>(`/api/schools/${schoolId}/assessments${qs({ ...filters })}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useAssessment(schoolId: string, id: string | undefined) {
  return useQuery({
    queryKey: staffKeys.detail(schoolId, id ?? ''),
    queryFn: () => api.get<Assessment>(`/api/schools/${schoolId}/assessments/${id}`),
    enabled: !!id,
  });
}

export function useSaveQuiz(schoolId: string, id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: QuizPayload) =>
      id
        ? api.patch<Assessment>(`/api/schools/${schoolId}/assessments/${id}`, payload)
        : api.post<Assessment>(`/api/schools/${schoolId}/assessments`, payload),
    onSuccess: () => invalidateAfterStaffChange(qc, schoolId),
  });
}

export function useDeleteQuiz(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/assessments/${id}`),
    onSuccess: (_res, id) => {
      qc.removeQueries({ queryKey: staffKeys.detail(schoolId, id) });
      return invalidateAfterStaffChange(qc, schoolId);
    },
  });
}

export function useScoreSheet(schoolId: string, id: string | null) {
  return useQuery({
    queryKey: staffKeys.scores(schoolId, id ?? ''),
    queryFn: () => api.get<ScoreSheet>(`/api/schools/${schoolId}/assessments/${id}/scores`),
    enabled: !!id,
  });
}

export function useSaveScores(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scores }: { id: string; scores: Array<{ studentId: string; score: number | null }> }) =>
      api.put<ScoreSheet>(`/api/schools/${schoolId}/assessments/${id}/scores`, { scores }),
    onSuccess: (data) => {
      qc.setQueryData(staffKeys.scores(schoolId, data.assessment.id), data);
      return invalidateAfterStaffChange(qc, schoolId);
    },
  });
}

// ───────────────────────────── Guardian / student ─────────────────────────────

/**
 * Loading a guardian list marks the module as seen on the server, so refresh the home badges after
 * each fetch made while the screen is open.
 */
function useRefreshSummary(studentId: string, dataUpdatedAt: number) {
  const qc = useQueryClient();
  const last = useRef(0);
  useEffect(() => {
    if (!dataUpdatedAt || dataUpdatedAt === last.current) return;
    last.current = dataUpdatedAt;
    void qc.invalidateQueries({ queryKey: ['students', studentId, 'summary'] });
  }, [qc, studentId, dataUpdatedAt]);
}

export function useGuardianExams(studentId: string) {
  const query = useQuery({
    queryKey: studentKeys.exams(studentId),
    queryFn: () => api.get<GuardianExams>(`/api/students/${studentId}/exams`),
  });
  useRefreshSummary(studentId, query.dataUpdatedAt);
  return query;
}

export function useStudentResults(studentId: string, { refreshBadges = false } = {}) {
  const query = useQuery({
    queryKey: studentKeys.results(studentId),
    queryFn: () => api.get<ResultItem[]>(`/api/students/${studentId}/results`),
  });
  useRefreshSummary(studentId, refreshBadges ? query.dataUpdatedAt : 0);
  return query;
}

export function useResultSheet(studentId: string, periodId: string, enabled = true) {
  return useQuery({
    queryKey: studentKeys.sheet(studentId, periodId),
    queryFn: () => api.get<ResultSheet>(`/api/students/${studentId}/results/${periodId}`),
    enabled: enabled && !!periodId,
    retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status === 404),
  });
}
