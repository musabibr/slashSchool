import { useEffect, useRef } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { AudienceType, CalendarKind, Relation } from '@slash/shared';
import { api, qs } from '../../api/client';

// ───────────────────────────── Types (mirror apps/api/src/modules/comms) ─────────────────────────────

/** GET /api/schools/:schoolId/announcements */
export interface StaffAnnouncement {
  id: string;
  title: string;
  body: string;
  audienceType: AudienceType;
  audienceId: string | null;
  audienceLabel: string;
  createdByName: string | null;
  publishedAt: string;
}

/** GET /api/students/:studentId/announcements (P16) */
export interface GuardianAnnouncement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  audienceType: AudienceType;
  audienceLabel: string;
  isNew: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  kind: CalendarKind;
  startsOn: string;
  endsOn: string;
  details: string | null;
}

/** GET /api/students/:studentId/calendar (P15) */
export interface GuardianCalendar {
  month: string;
  events: CalendarEvent[];
  upcoming: CalendarEvent[];
}

/** GET /api/schools/:schoolId/announcements/contacts/:studentId */
export interface GuardianContact {
  fullName: string;
  phone: string;
  relation: Relation;
  whatsapp: string | null;
  isPrimary: boolean;
  activated: boolean;
}

/** GET /api/schools/:schoolId/students?q= (people module) */
export interface StudentOption {
  id: string;
  code: string;
  fullName: string;
  classLabel: string | null;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  audienceType: AudienceType;
  audienceId: string | null;
}

export interface EventInput {
  title: string;
  kind: CalendarKind;
  startsOn: string;
  endsOn: string;
  details: string | null;
}

// ───────────────────────────── Query keys ─────────────────────────────

export const commsKeys = {
  announcements: (schoolId: string) => ['schools', schoolId, 'announcements'] as const,
  calendar: (schoolId: string) => ['schools', schoolId, 'calendar'] as const,
  guardianAnnouncements: (studentId: string) => ['students', studentId, 'announcements'] as const,
  guardianCalendar: (studentId: string, month: string) => ['students', studentId, 'calendar', month] as const,
  summary: (studentId: string) => ['students', studentId, 'summary'] as const,
};

/** Guardian-side caches of any student for one module (and the home badges), e.g. after the director edits. */
function invalidateStudentCaches(qc: QueryClient, module: 'announcements' | 'calendar') {
  return qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'students' && (q.queryKey[2] === module || q.queryKey[2] === 'summary'),
  });
}

/**
 * The guardian list endpoints mark the module as seen on the server, so refresh the home badges after
 * each fetch made while mounted (not when the data merely came from the cache).
 */
function useRefreshSummaryAfterFetch(studentId: string, query: { isSuccess: boolean; dataUpdatedAt: number }) {
  const qc = useQueryClient();
  const lastSynced = useRef(query.dataUpdatedAt);
  const { isSuccess, dataUpdatedAt } = query;
  useEffect(() => {
    if (!isSuccess || dataUpdatedAt === lastSynced.current) return;
    lastSynced.current = dataUpdatedAt;
    void qc.invalidateQueries({ queryKey: commsKeys.summary(studentId) });
  }, [qc, studentId, isSuccess, dataUpdatedAt]);
}

// ───────────────────────────── Guardian ─────────────────────────────

export function useGuardianAnnouncements(studentId: string) {
  const query = useQuery({
    queryKey: commsKeys.guardianAnnouncements(studentId),
    queryFn: () => api.get<GuardianAnnouncement[]>(`/api/students/${studentId}/announcements`),
    refetchOnMount: 'always',
  });
  useRefreshSummaryAfterFetch(studentId, query);
  return query;
}

export function useGuardianCalendar(studentId: string, month: string) {
  const query = useQuery({
    queryKey: commsKeys.guardianCalendar(studentId, month),
    queryFn: () => api.get<GuardianCalendar>(`/api/students/${studentId}/calendar${qs({ month })}`),
    placeholderData: keepPreviousData,
  });
  useRefreshSummaryAfterFetch(studentId, query);
  return query;
}

// ───────────────────────────── Director: announcements ─────────────────────────────

export function useAnnouncements(schoolId: string, audienceType: AudienceType | null, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: [...commsKeys.announcements(schoolId), 'list', audienceType, pageSize],
    queryFn: ({ pageParam }) =>
      api.get<StaffAnnouncement[]>(
        `/api/schools/${schoolId}/announcements${qs({ audienceType, limit: pageSize, offset: pageParam })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < pageSize ? undefined : pages.length * pageSize),
    placeholderData: keepPreviousData,
  });
}

export function useCreateAnnouncement(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnnouncementInput) =>
      api.post<StaffAnnouncement>(`/api/schools/${schoolId}/announcements`, input),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: commsKeys.announcements(schoolId) }),
        invalidateStudentCaches(qc, 'announcements'),
      ]),
  });
}

export function useDeleteAnnouncement(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/announcements/${id}`),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: commsKeys.announcements(schoolId) }),
        invalidateStudentCaches(qc, 'announcements'),
      ]),
  });
}

export function useGuardianContacts(schoolId: string, studentId: string, enabled = true) {
  return useQuery({
    queryKey: [...commsKeys.announcements(schoolId), 'contacts', studentId],
    queryFn: () => api.get<GuardianContact[]>(`/api/schools/${schoolId}/announcements/contacts/${studentId}`),
    enabled,
  });
}

/** Student picker search (the people module's list endpoint). An empty `q` lists the first students. */
export function useStudentSearch(schoolId: string, q: string) {
  return useQuery({
    queryKey: ['schools', schoolId, 'students', 'search', q],
    queryFn: () =>
      api.get<{ items: StudentOption[]; total: number }>(`/api/schools/${schoolId}/students${qs({ q: q.trim() })}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

// ───────────────────────────── Director: calendar ─────────────────────────────

export function useSchoolCalendar(schoolId: string, range: { from: string; to: string }) {
  return useQuery({
    queryKey: [...commsKeys.calendar(schoolId), range.from, range.to],
    queryFn: () => api.get<CalendarEvent[]>(`/api/schools/${schoolId}/calendar${qs(range)}`),
    placeholderData: keepPreviousData,
  });
}

export function useSaveEvent(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: EventInput }) =>
      id
        ? api.patch<CalendarEvent>(`/api/schools/${schoolId}/calendar/${id}`, input)
        : api.post<CalendarEvent>(`/api/schools/${schoolId}/calendar`, input),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: commsKeys.calendar(schoolId) }),
        invalidateStudentCaches(qc, 'calendar'),
      ]),
  });
}

export function useDeleteEvent(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/calendar/${id}`),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: commsKeys.calendar(schoolId) }),
        invalidateStudentCaches(qc, 'calendar'),
      ]),
  });
}
