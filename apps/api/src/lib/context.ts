import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { DEFAULT_GRADE_BANDS, joinName, STAFF_ROLES, todayIn, type GradeBand, type Role } from '@slash/shared';
import type { Db } from '../db/client';
import { classSections, gradeLevels, memberships, schools, studentGuardians, students, teachingAssignments } from '../db/schema';
import { forbidden, notFound, unauthorized } from './errors';

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string;
}

export interface SchoolCtx {
  id: string;
  name: string;
  code: string;
  timezone: string;
  weekStart: number;
  gradeBands: GradeBand[];
  /** The current user's roles in this school. */
  roles: Role[];
}

export interface StudentCtx {
  id: string;
  schoolId: string;
  code: string;
  fullName: string;
  gender: string;
  status: string;
  classSectionId: string | null;
  gradeLevelId: string | null;
  /** How the current user reaches this student. */
  access: 'guardian' | 'staff';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      school?: SchoolCtx;
      student?: StudentCtx;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};

/** Typed accessors for handlers mounted behind the scope middlewares. */
export function userOf(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
export function schoolOf(req: Request): SchoolCtx {
  if (!req.school) throw new Error('school scope missing');
  return req.school;
}
export function studentOf(req: Request): StudentCtx {
  if (!req.student) throw new Error('student scope missing');
  return req.student;
}

export function schoolToday(school: Pick<SchoolCtx, 'timezone'>): string {
  return todayIn(school.timezone);
}

function toSchoolCtx(row: typeof schools.$inferSelect, roles: Role[]): SchoolCtx {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    timezone: row.timezone,
    weekStart: row.weekStart,
    gradeBands: row.gradeBands && row.gradeBands.length ? row.gradeBands : DEFAULT_GRADE_BANDS,
    roles,
  };
}

/**
 * For `/api/schools/:schoolId/*`: the user must hold a staff role (admin, supervisor, teacher) there.
 * Sets req.school.
 */
export function schoolScope(db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = userOf(req);
    const schoolId = String(req.params.schoolId ?? '');
    if (!UUID_RE.test(schoolId)) throw notFound('المدرسة غير موجودة');
    const rows = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.schoolId, schoolId),
          inArray(memberships.role, [...STAFF_ROLES]),
        ),
      );
    if (!rows.length) throw forbidden();
    const [school] = await db.select().from(schools).where(eq(schools.id, schoolId));
    if (!school) throw notFound('المدرسة غير موجودة');
    req.school = toSchoolCtx(
      school,
      rows.map((r) => r.role),
    );
    next();
  };
}

/** Allow only users holding one of `roles` in the scoped school. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const school = schoolOf(req);
    if (!school.roles.some((r) => roles.includes(r))) throw forbidden();
    next();
  };
}

export function hasRole(req: Request, ...roles: Role[]): boolean {
  return !!req.school?.roles.some((r) => roles.includes(r));
}

/**
 * For `/api/students/:studentId/*`: guardians linked to the student, or staff of the student's school
 * (admins and supervisors: any student; teachers: students in a class they teach). Sets req.student and req.school.
 */
export function studentScope(db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = userOf(req);
    const studentId = String(req.params.studentId ?? '');
    if (!UUID_RE.test(studentId)) throw notFound('الطالب غير موجود');
    const [student] = await db.select().from(students).where(eq(students.id, studentId));
    if (!student) throw notFound('الطالب غير موجود');

    const [link] = await db
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.userId, user.id)));
    const staffRoles = (
      await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.schoolId, student.schoolId),
            inArray(memberships.role, [...STAFF_ROLES]),
          ),
        )
    ).map((r) => r.role);

    let access: StudentCtx['access'] | null = link ? 'guardian' : null;
    if (!access && staffRoles.some((r) => r === 'admin' || r === 'supervisor')) access = 'staff';
    if (!access && staffRoles.includes('teacher') && student.classSectionId) {
      const [teaches] = await db
        .select({ id: teachingAssignments.id })
        .from(teachingAssignments)
        .where(
          and(eq(teachingAssignments.teacherId, user.id), eq(teachingAssignments.classSectionId, student.classSectionId)),
        );
      if (teaches) access = 'staff';
    }
    if (!access) throw forbidden();

    const [school] = await db.select().from(schools).where(eq(schools.id, student.schoolId));
    req.school = toSchoolCtx(school, access === 'guardian' ? ['guardian', ...staffRoles] : staffRoles);
    req.student = {
      id: student.id,
      schoolId: student.schoolId,
      code: student.code,
      fullName: joinName(student.firstName, student.fatherName, student.grandfatherName),
      gender: student.gender,
      status: student.status,
      classSectionId: student.classSectionId,
      gradeLevelId: student.gradeLevelId,
      access,
    };
    next();
  };
}

/** Only the student's guardians may call this route (e.g. ticking homework done). */
export const requireGuardianAccess: RequestHandler = (req, _res, next) => {
  if (studentOf(req).access !== 'guardian') throw forbidden();
  next();
};

/** "الخامس - ب" label for a class section. */
export async function classLabel(db: Db, classSectionId: string | null): Promise<string | null> {
  if (!classSectionId) return null;
  const [row] = await db
    .select({ section: classSections.name, grade: gradeLevels.name })
    .from(classSections)
    .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .where(eq(classSections.id, classSectionId));
  return row ? `${row.grade} - ${row.section}` : null;
}
