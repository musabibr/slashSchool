import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Gender, Relation, StudentStatus, UserStatus } from '@slash/shared';
import { api, qs } from '../../../api/client';

// ───────────────────────────── Types (mirror apps/api/src/modules/people/students) ─────────────────────────────

/** GET /students — a row of the D2 table. */
export interface StudentListItem {
  id: string;
  code: string;
  fullName: string;
  gender: Gender;
  classSectionId: string | null;
  classLabel: string | null;
  gradeLevelName: string | null;
  status: StudentStatus;
  registeredAt: string;
  guardianCount: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface StudentGuardian {
  userId: string;
  fullName: string;
  phone: string;
  status: UserStatus;
  lastLoginAt: string | null;
  relation: Relation;
  isPrimary: boolean;
  occupation: string | null;
  workplace: string | null;
  locality: string | null;
  residence: string | null;
  whatsapp: string | null;
  canIssueCode: boolean;
}

/** GET /students/:id (D4). */
export interface StudentProfile {
  id: string;
  code: string;
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  greatGrandfatherName: string | null;
  fullName: string;
  gender: Gender;
  birthDate: string | null;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
  stageId: string | null;
  stageName: string | null;
  classSectionId: string | null;
  classLabel: string | null;
  status: StudentStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  motherName: string | null;
  motherPhone: string | null;
  motherWhatsapp: string | null;
  registeredAt: string;
  notes: string | null;
  createdAt: string;
  hasLinkCode: boolean;
  guardians: StudentGuardian[];
}

/** A guardian account in the admission / add-guardian response. */
export interface IssuedGuardian {
  userId: string;
  fullName: string;
  phone: string;
  whatsapp: string | null;
  relation: Relation;
  status: UserStatus;
  activationCode: string | null;
  otherSchool: boolean;
}

export interface AdmissionPayload {
  student: {
    firstName: string;
    fatherName: string;
    grandfatherName: string;
    greatGrandfatherName: string | null;
    gender: Gender | null;
    birthDate: string | null;
    gradeLevelId: string | null;
    classSectionId: string | null;
    registeredAt?: string;
  };
  mother: { name: string | null; phone: string | null; whatsapp: string | null };
  guardian: {
    firstName: string;
    fatherName: string;
    grandfatherName: string;
    greatGrandfatherName: string | null;
    phone: string;
    whatsapp: string | null;
    relation: Relation;
    occupation: string | null;
    workplace: string | null;
    locality: string | null;
    residence: string | null;
  };
  motherAccount: boolean;
}

export interface AdmissionResult {
  student: { id: string; code: string; fullName: string };
  guardians: IssuedGuardian[];
}

export interface StudentPatch {
  firstName?: string;
  fatherName?: string;
  grandfatherName?: string;
  greatGrandfatherName?: string | null;
  gender?: Gender;
  birthDate?: string | null;
  gradeLevelId?: string;
  classSectionId?: string | null;
  registeredAt?: string;
  notes?: string | null;
  motherName?: string | null;
  motherPhone?: string | null;
  motherWhatsapp?: string | null;
}

export interface GuardianLinkPatch {
  relation?: Relation;
  isPrimary?: boolean;
  whatsapp?: string | null;
  occupation?: string | null;
  workplace?: string | null;
  locality?: string | null;
  residence?: string | null;
}

export interface AddGuardianPayload {
  fullName: string;
  phone: string;
  relation: Relation;
  whatsapp: string | null;
  occupation: string | null;
  workplace: string | null;
  locality: string | null;
  residence: string | null;
}

/** One CSV row as the API expects it (POST /students/import). */
export interface ImportRow {
  studentFirstName: string;
  studentFatherName: string;
  studentGrandfatherName: string;
  studentGreatGrandfatherName?: string;
  gender: string;
  gradeLevel: string;
  classSection?: string;
  birthDate?: string;
  guardianName: string;
  guardianPhone: string;
  relation?: string;
  motherName?: string;
  motherPhone?: string;
}

export interface ImportCode {
  guardianName: string;
  phone: string;
  code: string;
  students: string[];
}

export interface ImportResult {
  valid: boolean;
  rowCount: number;
  errors: Array<{ row: number; messages: string[] }>;
  created?: number;
  codes?: ImportCode[];
}

/** GET /guardians */
export interface GuardianListItem {
  userId: string;
  fullName: string;
  phone: string;
  whatsapp: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  canIssueCode: boolean;
  children: Array<{
    studentId: string;
    fullName: string;
    classLabel: string | null;
    status: StudentStatus;
    relation: Relation;
  }>;
}

/** GET /setup/structure (school structure: stage → grade level → class sections of the current year). */
export interface SchoolStructure {
  stages: Array<{
    id: string;
    name: string;
    gradeLevels: Array<{ id: string; name: string; classSections: Array<{ id: string; name: string }> }>;
  }>;
}

// ───────────────────────────── Keys ─────────────────────────────

export interface StudentFilters {
  q: string;
  classId: string | null;
  gradeLevelId: string | null;
  status: StudentStatus | null;
  limit: number;
  offset: number;
}

export interface GuardianFilters {
  q: string;
  status: UserStatus | null;
  limit: number;
  offset: number;
}

export const studentKeys = {
  all: (schoolId: string) => ['schools', schoolId, 'students'] as const,
  list: (schoolId: string, f: StudentFilters) => ['schools', schoolId, 'students', 'list', f] as const,
  detail: (schoolId: string, id: string) => ['schools', schoolId, 'students', 'detail', id] as const,
  structure: (schoolId: string) => ['schools', schoolId, 'students', 'structure'] as const,
};

export const guardianKeys = {
  all: (schoolId: string) => ['schools', schoolId, 'guardians'] as const,
  list: (schoolId: string, f: GuardianFilters) => ['schools', schoolId, 'guardians', 'list', f] as const,
};

const base = (schoolId: string) => `/api/schools/${schoolId}`;

// ───────────────────────────── Queries ─────────────────────────────

export function useStudentList(schoolId: string, f: StudentFilters) {
  return useQuery({
    queryKey: studentKeys.list(schoolId, f),
    queryFn: () =>
      api.get<Paged<StudentListItem>>(
        `${base(schoolId)}/students${qs({
          q: f.q.trim(),
          classId: f.classId,
          gradeLevelId: f.gradeLevelId,
          status: f.status,
          limit: f.limit,
          offset: f.offset,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useStudentProfile(schoolId: string, studentId: string | undefined) {
  return useQuery({
    queryKey: studentKeys.detail(schoolId, studentId ?? ''),
    queryFn: () => api.get<StudentProfile>(`${base(schoolId)}/students/${studentId}`),
    enabled: !!studentId,
  });
}

/** The school structure for the D3 pickers (GET /setup/structure: the current year's tree). */
export function useSchoolStructure(schoolId: string) {
  return useQuery({
    queryKey: studentKeys.structure(schoolId),
    queryFn: () => api.get<SchoolStructure>(`${base(schoolId)}/setup/structure`),
  });
}

export function useGuardianList(schoolId: string, f: GuardianFilters) {
  return useQuery({
    queryKey: guardianKeys.list(schoolId, f),
    queryFn: () =>
      api.get<Paged<GuardianListItem>>(
        `${base(schoolId)}/guardians${qs({ q: f.q.trim(), status: f.status, limit: f.limit, offset: f.offset })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

// ───────────────────────────── Mutations ─────────────────────────────

/** After any change: student lists/profiles, guardians, and class rosters used by other screens. */
function useInvalidatePeople(schoolId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: studentKeys.all(schoolId) }),
      qc.invalidateQueries({ queryKey: guardianKeys.all(schoolId) }),
      qc.invalidateQueries({ queryKey: ['schools', schoolId, 'class-students'] }),
    ]);
}

export function useAdmitStudent(schoolId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: (payload: AdmissionPayload) => api.post<AdmissionResult>(`${base(schoolId)}/students`, payload),
    onSuccess: () => invalidate(),
  });
}

/** Edit mode: student + mother fields, then (if changed) the primary guardian's link details. */
export function useUpdateStudent(schoolId: string, studentId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: async ({
      student,
      guardian,
    }: {
      student: StudentPatch;
      guardian?: { userId: string; patch: GuardianLinkPatch };
    }) => {
      let profile = await api.patch<StudentProfile>(`${base(schoolId)}/students/${studentId}`, student);
      if (guardian) {
        profile = await api.patch<StudentProfile>(
          `${base(schoolId)}/students/${studentId}/guardians/${guardian.userId}`,
          guardian.patch,
        );
      }
      return profile;
    },
    onSuccess: () => invalidate(),
  });
}

export function useChangeStudentStatus(schoolId: string, studentId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: (body: { status: StudentStatus; reason: string | null }) =>
      api.patch<StudentProfile>(`${base(schoolId)}/students/${studentId}/status`, body),
    onSuccess: () => invalidate(),
  });
}

export function useIssueLinkCode(schoolId: string, studentId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: () => api.post<{ code: string }>(`${base(schoolId)}/students/${studentId}/link-code`),
    onSuccess: () => invalidate(),
  });
}

export function useAddGuardian(schoolId: string, studentId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: (payload: AddGuardianPayload) =>
      api.post<IssuedGuardian>(`${base(schoolId)}/students/${studentId}/guardians`, payload),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateGuardianLink(schoolId: string, studentId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: GuardianLinkPatch }) =>
      api.patch<StudentProfile>(`${base(schoolId)}/students/${studentId}/guardians/${userId}`, patch),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveGuardian(schoolId: string, studentId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: (userId: string) => api.delete(`${base(schoolId)}/students/${studentId}/guardians/${userId}`),
    onSuccess: () => invalidate(),
  });
}

export function useIssueActivationCode(schoolId: string) {
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<{ code: string; expiresAt: string }>(`${base(schoolId)}/guardians/${userId}/activation-code`),
  });
}

export function useImportStudents(schoolId: string) {
  const invalidate = useInvalidatePeople(schoolId);
  return useMutation({
    mutationFn: ({ rows, dryRun }: { rows: ImportRow[]; dryRun: boolean }) =>
      api.post<ImportResult>(`${base(schoolId)}/students/import`, { rows, dryRun }),
    onSuccess: (data, vars) => {
      if (!vars.dryRun && data.created) void invalidate();
    },
  });
}
