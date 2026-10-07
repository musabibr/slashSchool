import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { EvaluationRating } from '@slash/shared';
import { api, qs } from '../../api/client';

// ───────────────────────────── Types (API responses) ─────────────────────────────

/** GET /api/schools/:schoolId/regulations */
export interface Regulation {
  id: string;
  code: string | null;
  title: string;
  defaultPenalty: string | null;
  incidentCount: number;
}

export interface RegulationPayload {
  code: string | null;
  title: string;
  defaultPenalty: string | null;
}

/** GET/POST /api/schools/:schoolId/behavior */
export interface Incident {
  id: string;
  studentId: string;
  studentName: string;
  classLabel: string | null;
  regulationId: string;
  regulationTitle: string;
  date: string;
  details: string | null;
  penalty: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface IncidentPayload {
  studentId: string;
  regulationId: string;
  date: string;
  details: string | null;
  penalty: string | null;
}

export interface IncidentFilters {
  classId?: string | null;
  studentId?: string | null;
  limit?: number;
}

/** GET /api/students/:studentId/behavior (P14) */
export interface StudentBehavior {
  violations: number;
  penalties: number;
  incidents: Array<{
    id: string;
    date: string;
    regulationTitle: string;
    details: string | null;
    penalty: string | null;
  }>;
  evaluations: StudentEvaluation[];
}

export interface StudentEvaluation {
  date: string;
  subjectName: string;
  rating: EvaluationRating;
  comment: string | null;
  teacherName: string | null;
}

/** GET/PUT /api/schools/:schoolId/evaluations */
export interface EvaluationEntry {
  studentId: string;
  rating: EvaluationRating;
  comment: string | null;
}

export interface SaveEvaluationsPayload {
  classSectionId: string;
  subjectId: string;
  date: string;
  items: Array<{ studentId: string; rating: EvaluationRating | null; comment: string | null }>;
}

// ───────────────────────────── Query keys ─────────────────────────────

export const behaviorKeys = {
  school: (schoolId: string) => ['schools', schoolId, 'behavior'] as const,
  regulations: (schoolId: string) => ['schools', schoolId, 'behavior', 'regulations'] as const,
  incidents: (schoolId: string, filters: IncidentFilters) =>
    ['schools', schoolId, 'behavior', 'incidents', filters] as const,
  evaluations: (schoolId: string, classId: string | null, subjectId: string | null, date: string | null) =>
    ['schools', schoolId, 'behavior', 'evaluations', classId, subjectId, date] as const,
  student: (studentId: string) => ['students', studentId, 'behavior'] as const,
};

/** Every student's P14 record (guardian screen and admin student panels). */
const invalidateStudentRecords = (qc: QueryClient) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'students' && q.queryKey[2] === 'behavior' });

// ───────────────────────────── Regulations ─────────────────────────────

export function useRegulations(schoolId: string) {
  return useQuery({
    queryKey: behaviorKeys.regulations(schoolId),
    queryFn: () => api.get<Regulation[]>(`/api/schools/${schoolId}/regulations`),
    staleTime: 60_000,
  });
}

/** Create (no id) or edit a regulation. */
export function useSaveRegulation(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: RegulationPayload & { id?: string }) =>
      id
        ? api.patch<Regulation>(`/api/schools/${schoolId}/regulations/${id}`, payload)
        : api.post<Regulation>(`/api/schools/${schoolId}/regulations`, payload),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: behaviorKeys.school(schoolId) }),
        invalidateStudentRecords(qc),
      ]);
    },
  });
}

export function useDeleteRegulation(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/regulations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: behaviorKeys.regulations(schoolId) }),
  });
}

// ───────────────────────────── Incidents ─────────────────────────────

export function useIncidents(schoolId: string, filters: IncidentFilters, enabled = true) {
  return useQuery({
    queryKey: behaviorKeys.incidents(schoolId, filters),
    queryFn: () => api.get<Incident[]>(`/api/schools/${schoolId}/behavior${qs({ ...filters })}`),
    enabled,
  });
}

/** After recording or deleting: incident lists, regulation counts and student records. */
async function refreshAfterIncident(qc: QueryClient, schoolId: string) {
  await Promise.all([qc.invalidateQueries({ queryKey: behaviorKeys.school(schoolId) }), invalidateStudentRecords(qc)]);
}

export function useRecordIncident(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: IncidentPayload) => api.post<Incident>(`/api/schools/${schoolId}/behavior`, payload),
    onSuccess: () => refreshAfterIncident(qc, schoolId),
  });
}

export function useDeleteIncident(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/behavior/${id}`),
    onSuccess: () => refreshAfterIncident(qc, schoolId),
  });
}

// ───────────────────────────── Evaluations ─────────────────────────────

export function useEvaluations(
  schoolId: string,
  classId: string | null,
  subjectId: string | null,
  date: string | null,
) {
  return useQuery({
    queryKey: behaviorKeys.evaluations(schoolId, classId, subjectId, date),
    queryFn: () =>
      api.get<EvaluationEntry[]>(`/api/schools/${schoolId}/evaluations${qs({ classId, subjectId, date })}`),
    enabled: !!classId && !!subjectId && !!date,
  });
}

export function useSaveEvaluations(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveEvaluationsPayload) =>
      api.put<EvaluationEntry[]>(`/api/schools/${schoolId}/evaluations`, payload),
    onSuccess: async (data, vars) => {
      qc.setQueryData(behaviorKeys.evaluations(schoolId, vars.classSectionId, vars.subjectId, vars.date), data);
      await invalidateStudentRecords(qc);
    },
  });
}

// ───────────────────────────── Student record (P14) ─────────────────────────────

export function useStudentBehavior(studentId: string) {
  return useQuery({
    queryKey: behaviorKeys.student(studentId),
    queryFn: () => api.get<StudentBehavior>(`/api/students/${studentId}/behavior`),
  });
}

/**
 * Guardian screen: loading the record marks the module seen on the server, so refresh the home badges
 * after each fetch made while mounted (not when the data merely came from the cache).
 */
export function useGuardianBehavior(studentId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: behaviorKeys.student(studentId),
    queryFn: () => api.get<StudentBehavior>(`/api/students/${studentId}/behavior`),
    refetchOnMount: 'always',
  });
  const { isSuccess, dataUpdatedAt } = query;
  const lastSynced = useRef(dataUpdatedAt);
  useEffect(() => {
    if (!isSuccess || dataUpdatedAt === lastSynced.current) return;
    lastSynced.current = dataUpdatedAt;
    void qc.invalidateQueries({ queryKey: ['students', studentId, 'summary'] });
  }, [qc, studentId, isSuccess, dataUpdatedAt]);
  return query;
}
