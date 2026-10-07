import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarKind, GradeBand } from '@slash/shared';
import { api, qs } from '../../../api/client';

// ───────────────────────────── Types (mirror apps/api/src/modules/people/setup) ─────────────────────────────

export type StaffRole = 'admin' | 'supervisor' | 'teacher';

export interface AcademicYear {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface SectionNode {
  id: string;
  name: string;
  academicYearId: string;
  studentCount: number;
}

export interface GradeNode {
  id: string;
  name: string;
  sort: number;
  classSections: SectionNode[];
}

export interface StageNode {
  id: string;
  name: string;
  sort: number;
  gradeLevels: GradeNode[];
}

export interface Subject {
  id: string;
  name: string;
  sort: number;
}

export interface Assignment {
  id: string;
  classSectionId: string;
  subjectId: string;
  teacherId: string;
  teacherName: string;
}

/** GET /api/schools/:schoolId/setup/structure */
export interface Structure {
  currentAcademicYearId: string | null;
  academicYears: AcademicYear[];
  stages: StageNode[];
  subjects: Subject[];
  assignments: Assignment[];
}

/** GET /api/schools/:schoolId/staff */
export interface StaffMember {
  userId: string;
  fullName: string;
  phone: string;
  status: 'pending' | 'active';
  roles: StaffRole[];
  assignments: Array<{ classLabel: string; subjectName: string }>;
  lastLoginAt: string | null;
}

/** POST /api/schools/:schoolId/staff */
export interface CreatedStaff {
  userId: string;
  fullName: string;
  phone: string;
  status: 'pending' | 'active';
  activationCode: string | null;
  expiresAt: string | null;
}

/** GET /api/schools/:schoolId/settings */
export interface SchoolSettings {
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  weekStart: number;
  gradeBands: GradeBand[];
}

export interface SettingsPatch {
  name?: string;
  phone?: string | null;
  address?: string | null;
  weekStart?: number;
  gradeBands?: GradeBand[];
}

/** GET /api/schools/:schoolId/dashboard */
export interface Dashboard {
  counts: { students: number; supervisors: number; teachers: number; guardians: number };
  gender: { male: number; female: number };
  byStage: Array<{ stageName: string; count: number }>;
  today: { date: string; classes: number; recorded: number; absent: number };
  upcomingEvents: Array<{ id: string; title: string; kind: CalendarKind; startsOn: string; endsOn: string }>;
  recentAnnouncements: Array<{ id: string; title: string; publishedAt: string }>;
  fees: { expected: number; collected: number; overdue: number };
}

// ───────────────────────────── Keys ─────────────────────────────

export const setupKeys = {
  structure: (schoolId: string) => ['schools', schoolId, 'setup', 'structure'] as const,
  staffAll: (schoolId: string) => ['schools', schoolId, 'staff'] as const,
  staff: (schoolId: string, role: StaffRole | 'all') => ['schools', schoolId, 'staff', role] as const,
  settings: (schoolId: string) => ['schools', schoolId, 'settings'] as const,
  dashboard: (schoolId: string) => ['schools', schoolId, 'dashboard'] as const,
};

// ───────────────────────────── Queries ─────────────────────────────

export function useStructure(schoolId: string) {
  return useQuery({
    queryKey: setupKeys.structure(schoolId),
    queryFn: () => api.get<Structure>(`/api/schools/${schoolId}/setup/structure`),
  });
}

/** Staff of the school; `role` narrows to one role ('all' = every staff role). */
export function useStaff(schoolId: string, role: StaffRole | 'all') {
  return useQuery({
    queryKey: setupKeys.staff(schoolId, role),
    queryFn: () =>
      api.get<StaffMember[]>(`/api/schools/${schoolId}/staff${qs({ role: role === 'all' ? undefined : role })}`),
  });
}

export function useSettings(schoolId: string) {
  return useQuery({
    queryKey: setupKeys.settings(schoolId),
    queryFn: () => api.get<SchoolSettings>(`/api/schools/${schoolId}/settings`),
  });
}

export function useDashboard(schoolId: string) {
  return useQuery({
    queryKey: setupKeys.dashboard(schoolId),
    queryFn: () => api.get<Dashboard>(`/api/schools/${schoolId}/dashboard`),
  });
}

// ───────────────────────────── Mutations ─────────────────────────────

/**
 * Structure changes affect the setup tree, every staff picker (useScope), staff assignment lists
 * and the dashboard, so all of them are refreshed.
 */
function useInvalidateStructure(schoolId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['schools', schoolId, 'setup'] }),
      qc.invalidateQueries({ queryKey: ['schools', schoolId, 'scope'] }),
      qc.invalidateQueries({ queryKey: setupKeys.staffAll(schoolId) }),
      qc.invalidateQueries({ queryKey: setupKeys.dashboard(schoolId) }),
    ]);
}

export type StructureEntity = 'academic-years' | 'stages' | 'grade-levels' | 'class-sections' | 'subjects';

/** POST / PATCH / DELETE on one of the structure collections. */
export function useStructureMutation(schoolId: string) {
  const invalidate = useInvalidateStructure(schoolId);
  return useMutation({
    mutationFn: (
      op:
        | { kind: 'create'; entity: StructureEntity; body: object }
        | { kind: 'update'; entity: StructureEntity; id: string; body: object }
        | { kind: 'delete'; entity: StructureEntity; id: string },
    ) => {
      const url = `/api/schools/${schoolId}/setup/${op.entity}`;
      if (op.kind === 'create') return api.post<unknown>(url, op.body);
      if (op.kind === 'update') return api.patch<unknown>(`${url}/${op.id}`, op.body);
      return api.delete<unknown>(`${url}/${op.id}`);
    },
    onSuccess: invalidate,
  });
}

export interface AssignmentInput {
  classSectionId: string;
  subjectId: string;
  teacherId: string | null;
}

export function useSaveAssignment(schoolId: string) {
  const invalidate = useInvalidateStructure(schoolId);
  return useMutation({
    mutationFn: (input: AssignmentInput) => api.put<unknown>(`/api/schools/${schoolId}/setup/assignments`, input),
    onSuccess: invalidate,
  });
}

function useInvalidateStaff(schoolId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: setupKeys.staffAll(schoolId) }),
      // Teacher pickers (timetable builder, scope) and the dashboard counters.
      qc.invalidateQueries({ queryKey: ['schools', schoolId, 'scope'] }),
      qc.invalidateQueries({ queryKey: ['schools', schoolId, 'setup'] }),
      qc.invalidateQueries({ queryKey: setupKeys.dashboard(schoolId) }),
    ]);
}

export function useCreateStaff(schoolId: string) {
  const invalidate = useInvalidateStaff(schoolId);
  return useMutation({
    mutationFn: (input: { fullName: string; phone: string; role: StaffRole }) =>
      api.post<CreatedStaff>(`/api/schools/${schoolId}/staff`, input),
    onSuccess: invalidate,
  });
}

export function useIssueStaffCode(schoolId: string) {
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<{ code: string; expiresAt: string }>(`/api/schools/${schoolId}/staff/${userId}/activation-code`),
  });
}

export function useRemoveStaff(schoolId: string) {
  const invalidate = useInvalidateStaff(schoolId);
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: StaffRole }) =>
      api.delete(`/api/schools/${schoolId}/staff/${userId}${qs({ role })}`),
    onSuccess: invalidate,
  });
}

export function useSaveSettings(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patch<SchoolSettings>(`/api/schools/${schoolId}/settings`, patch),
    onSuccess: (data) => {
      qc.setQueryData(setupKeys.settings(schoolId), data);
      // School name (header, school picker), week start and grade bands are read elsewhere too.
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['me'] }),
        qc.invalidateQueries({ queryKey: ['schools', schoolId, 'scope'] }),
      ]);
    },
  });
}
