import type { Request } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { joinName } from '@slash/shared';
import type { Db } from '../db/client';
import {
  academicYears,
  classSections,
  gradeLevels,
  stages,
  students,
  subjects,
  teachingAssignments,
} from '../db/schema';
import { badRequest, forbidden, notFound } from './errors';
import { hasRole, schoolOf, userOf } from './context';

export interface ScopeSubject {
  id: string;
  name: string;
}

export interface ScopeClass {
  id: string;
  /** "الخامس - ب" */
  label: string;
  name: string;
  gradeLevelId: string;
  gradeLevelName: string;
  stageName: string;
  academicYearId: string;
  /** Subjects the current user may act on in this class. */
  subjects: ScopeSubject[];
}

export interface ClassStudent {
  id: string;
  code: string;
  fullName: string;
  gender: string;
  status: string;
}

/** The school's current academic year (flagged `is_current`, else the most recent). */
export async function currentAcademicYear(db: Db, schoolId: string) {
  const rows = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.schoolId, schoolId))
    .orderBy(desc(academicYears.isCurrent), desc(academicYears.startsOn))
    .limit(1);
  return rows[0] ?? null;
}

/** All class sections of the current year with labels, ordered stage → grade → section. */
export async function listSchoolClasses(db: Db, schoolId: string) {
  const year = await currentAcademicYear(db, schoolId);
  if (!year) return [];
  const rows = await db
    .select({
      id: classSections.id,
      name: classSections.name,
      gradeLevelId: gradeLevels.id,
      gradeLevelName: gradeLevels.name,
      stageName: stages.name,
      academicYearId: classSections.academicYearId,
    })
    .from(classSections)
    .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .innerJoin(stages, eq(stages.id, gradeLevels.stageId))
    .where(and(eq(classSections.schoolId, schoolId), eq(classSections.academicYearId, year.id)))
    .orderBy(asc(stages.sort), asc(gradeLevels.sort), asc(classSections.name));
  return rows.map((r) => ({ ...r, label: `${r.gradeLevelName} - ${r.name}` }));
}

/**
 * Classes (and subjects per class) the current staff user can act on.
 * Admins/supervisors: every class of the current year; subjects = those assigned in the class, or all school subjects
 * if the class has no assignments yet. Teachers: only their assigned (class, subject) pairs.
 */
export async function listScopeClasses(db: Db, req: Request): Promise<ScopeClass[]> {
  const school = schoolOf(req);
  const user = userOf(req);
  const classes = await listSchoolClasses(db, school.id);
  if (!classes.length) return [];
  const classIds = classes.map((c) => c.id);
  const assignments = await db
    .select({
      classSectionId: teachingAssignments.classSectionId,
      teacherId: teachingAssignments.teacherId,
      subjectId: subjects.id,
      subjectName: subjects.name,
      sort: subjects.sort,
    })
    .from(teachingAssignments)
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .where(inArray(teachingAssignments.classSectionId, classIds))
    .orderBy(asc(subjects.sort), asc(subjects.name));

  if (hasRole(req, 'admin', 'supervisor')) {
    const allSubjects = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.schoolId, school.id))
      .orderBy(asc(subjects.sort), asc(subjects.name));
    return classes.map((c) => {
      const own = assignments.filter((a) => a.classSectionId === c.id).map((a) => ({ id: a.subjectId, name: a.subjectName }));
      return { ...c, subjects: own.length ? own : allSubjects };
    });
  }
  const mine = assignments.filter((a) => a.teacherId === user.id);
  return classes
    .filter((c) => mine.some((a) => a.classSectionId === c.id))
    .map((c) => ({
      ...c,
      subjects: mine.filter((a) => a.classSectionId === c.id).map((a) => ({ id: a.subjectId, name: a.subjectName })),
    }));
}

/** Throws 404 unless the class section belongs to the school. */
export async function assertClassInSchool(db: Db, schoolId: string, classSectionId: string) {
  const [row] = await db
    .select()
    .from(classSections)
    .where(and(eq(classSections.id, classSectionId), eq(classSections.schoolId, schoolId)));
  if (!row) throw notFound('الفصل غير موجود');
  return row;
}

export async function assertSubjectInSchool(db: Db, schoolId: string, subjectId: string) {
  const [row] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.schoolId, schoolId)));
  if (!row) throw notFound('المادة غير موجودة');
  return row;
}

/**
 * Admins and supervisors may act on any class/subject of their school;
 * teachers only on (class, subject) pairs they are assigned to.
 */
export async function assertCanTeach(db: Db, req: Request, classSectionId: string, subjectId: string) {
  const school = schoolOf(req);
  await assertClassInSchool(db, school.id, classSectionId);
  await assertSubjectInSchool(db, school.id, subjectId);
  if (hasRole(req, 'admin', 'supervisor')) return;
  const [assignment] = await db
    .select({ id: teachingAssignments.id })
    .from(teachingAssignments)
    .where(
      and(
        eq(teachingAssignments.classSectionId, classSectionId),
        eq(teachingAssignments.subjectId, subjectId),
        eq(teachingAssignments.teacherId, userOf(req).id),
      ),
    );
  if (!assignment) throw forbidden('لا يمكنك إدارة هذه المادة لهذا الفصل');
}

/** Teachers: must teach at least one subject in the class. Admins/supervisors: any class of the school. */
export async function assertCanAccessClass(db: Db, req: Request, classSectionId: string) {
  const school = schoolOf(req);
  await assertClassInSchool(db, school.id, classSectionId);
  if (hasRole(req, 'admin', 'supervisor')) return;
  const [assignment] = await db
    .select({ id: teachingAssignments.id })
    .from(teachingAssignments)
    .where(
      and(eq(teachingAssignments.classSectionId, classSectionId), eq(teachingAssignments.teacherId, userOf(req).id)),
    );
  if (!assignment) throw forbidden('لا يمكنك الوصول إلى هذا الفصل');
}

/** Students currently in a class (active only unless asked), sorted by name. */
export async function classStudents(
  db: Db,
  classSectionId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ClassStudent[]> {
  const rows = await db
    .select()
    .from(students)
    .where(
      opts.includeInactive
        ? eq(students.classSectionId, classSectionId)
        : and(eq(students.classSectionId, classSectionId), eq(students.status, 'active')),
    );
  return rows
    .map((s) => ({
      id: s.id,
      code: s.code,
      fullName: joinName(s.firstName, s.fatherName, s.grandfatherName),
      gender: s.gender,
      status: s.status,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
}

/** Throws 400 unless every id is a student currently in the class. */
export async function assertStudentsInClass(db: Db, classSectionId: string, studentIds: string[]) {
  if (!studentIds.length) return;
  const unique = [...new Set(studentIds)];
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.classSectionId, classSectionId), inArray(students.id, unique)));
  if (rows.length !== unique.length) throw badRequest('بعض الطلاب لا ينتمون لهذا الفصل');
}
