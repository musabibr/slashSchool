import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type { ClassStudent, Me, PublicConfig, Scope, StudentSummary } from './types';

/** Current user + contexts; resolves to null when logged out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function usePublicConfig() {
  return useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<PublicConfig>('/api/public/config'),
    staleTime: Infinity,
  });
}

/** Classes × subjects the current staff user can act on, plus school info and today's date. */
export function useScope(schoolId: string | undefined) {
  return useQuery({
    queryKey: ['schools', schoolId, 'scope'],
    queryFn: () => api.get<Scope>(`/api/schools/${schoolId}/lookups/scope`),
    enabled: !!schoolId,
    staleTime: 5 * 60_000,
  });
}

export function useClassStudents(schoolId: string | undefined, classSectionId: string | null | undefined) {
  return useQuery({
    queryKey: ['schools', schoolId, 'class-students', classSectionId],
    queryFn: () => api.get<ClassStudent[]>(`/api/schools/${schoolId}/lookups/classes/${classSectionId}/students`),
    enabled: !!schoolId && !!classSectionId,
    staleTime: 60_000,
  });
}

export function useStudentSummary(studentId: string | undefined) {
  return useQuery({
    queryKey: ['students', studentId, 'summary'],
    queryFn: () => api.get<StudentSummary>(`/api/students/${studentId}/summary`),
    enabled: !!studentId,
  });
}
