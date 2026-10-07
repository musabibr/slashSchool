import type { BadgeModule, Role } from '@slash/shared';

export interface MeChild {
  id: string;
  code: string;
  fullName: string;
  gender: string;
  status: string;
  classLabel: string | null;
  school: { id: string; name: string };
}

export interface MeSchool {
  id: string;
  name: string;
  code: string;
  roles: Role[];
}

export interface Me {
  user: { id: string; phone: string; fullName: string };
  children: MeChild[];
  schools: MeSchool[];
}

export interface ScopeSubject {
  id: string;
  name: string;
}

export interface ScopeClass {
  id: string;
  label: string;
  name: string;
  gradeLevelId: string;
  gradeLevelName: string;
  stageName: string;
  academicYearId: string;
  subjects: ScopeSubject[];
}

export interface Scope {
  school: {
    id: string;
    name: string;
    code: string;
    timezone: string;
    weekStart: number;
    gradeBands: Array<{ min: number; label: string }>;
    /** School-local date, YYYY-MM-DD */
    today: string;
    roles: Role[];
  };
  academicYear: { id: string; name: string; startsOn: string; endsOn: string } | null;
  classes: ScopeClass[];
  subjects: ScopeSubject[];
  /** Admin/supervisor only (teachers and supervisors of the school). */
  teachers: Array<{ id: string; fullName: string }>;
}

export interface ClassStudent {
  id: string;
  code: string;
  fullName: string;
  gender: string;
  status: string;
}

/** GET /api/students/:studentId/summary — the guardian home (P3). */
export interface StudentSummary {
  student: { id: string; fullName: string; code: string; classLabel: string | null; status: string };
  school: { id: string; name: string; today: string };
  badges: Record<BadgeModule, number>;
}

export interface PublicConfig {
  demoMode: boolean;
  demo: {
    pin: string;
    accounts: Array<{ role: Role; label: string; phone: string; fullName: string }>;
    activation: { code: string; phone: string; fullName: string };
    linkCode: string;
  } | null;
}
