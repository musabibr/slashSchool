import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import { joinName, type AudienceType } from '@slash/shared';
import type { Db } from '../../db/client';
import { announcements, classSections, gradeLevels, students } from '../../db/schema';
import type { StudentCtx } from '../../lib/context';
import { notFound } from '../../lib/errors';

/** What an announcement can be aimed at, as seen from one student. */
export interface StudentTarget {
  schoolId: string;
  studentId: string;
  studentName: string;
  classSectionId: string | null;
  /** "الصف الخامس - أ" */
  classLabel: string | null;
  /** The grade level of the student's class (or the admission level when not placed in a class yet). */
  gradeLevelId: string | null;
  gradeLevelName: string | null;
}

/** Resolves the student's class and grade level (one query). */
export async function loadStudentTarget(db: Db, student: StudentCtx): Promise<StudentTarget> {
  const base = {
    schoolId: student.schoolId,
    studentId: student.id,
    studentName: student.fullName,
    classSectionId: null,
    classLabel: null,
    gradeLevelId: null,
    gradeLevelName: null,
  };
  if (student.classSectionId) {
    const [row] = await db
      .select({ section: classSections.name, gradeId: gradeLevels.id, grade: gradeLevels.name })
      .from(classSections)
      .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
      .where(eq(classSections.id, student.classSectionId));
    if (row) {
      return {
        ...base,
        classSectionId: student.classSectionId,
        classLabel: `${row.grade} - ${row.section}`,
        gradeLevelId: row.gradeId,
        gradeLevelName: row.grade,
      };
    }
  }
  if (student.gradeLevelId) {
    const [row] = await db
      .select({ name: gradeLevels.name })
      .from(gradeLevels)
      .where(eq(gradeLevels.id, student.gradeLevelId));
    if (row) return { ...base, gradeLevelId: student.gradeLevelId, gradeLevelName: row.name };
  }
  return base;
}

/** Announcements of the student's school whose audience covers the student. */
export function announcementsFor(target: StudentTarget): SQL | undefined {
  return and(
    eq(announcements.schoolId, target.schoolId),
    or(
      eq(announcements.audienceType, 'school'),
      target.gradeLevelId
        ? and(eq(announcements.audienceType, 'grade_level'), eq(announcements.audienceId, target.gradeLevelId))
        : undefined,
      target.classSectionId
        ? and(eq(announcements.audienceType, 'class_section'), eq(announcements.audienceId, target.classSectionId))
        : undefined,
      and(eq(announcements.audienceType, 'student'), eq(announcements.audienceId, target.studentId)),
    ),
  );
}

/**
 * The line shown above an announcement (P16). `name` is the grade level name, the class label or the
 * student's name; null when the target no longer exists.
 */
export function audienceLabel(type: AudienceType, name: string | null): string {
  switch (type) {
    case 'school':
      return 'إعلان لجميع الطلاب';
    case 'grade_level':
      return name ? `إعلان لطلاب ${name}` : 'إعلان لطلاب صف دراسي';
    case 'class_section':
      return name ? `إعلان لطلاب ${name}` : 'إعلان لطلاب فصل';
    case 'student':
      return name ? `إعلان خاص لـ ولي أمر الطالب ${name}` : 'إعلان خاص لـ ولي أمر طالب';
  }
}

/** Label for an announcement seen from one student (every name is already known). */
export function labelForStudent(target: StudentTarget, type: AudienceType): string {
  switch (type) {
    case 'school':
      return audienceLabel(type, null);
    case 'grade_level':
      return audienceLabel(type, target.gradeLevelName);
    case 'class_section':
      return audienceLabel(type, target.classLabel);
    case 'student':
      return audienceLabel(type, target.studentName);
  }
}

interface AudienceRef {
  audienceType: AudienceType;
  audienceId: string | null;
}

/** Names of the grade levels, classes and students a batch of announcements targets (≤ 3 queries). */
export async function audienceNames(db: Db, schoolId: string, rows: AudienceRef[]) {
  const idsOf = (type: AudienceType) => [
    ...new Set(rows.filter((r) => r.audienceType === type && r.audienceId).map((r) => r.audienceId as string)),
  ];
  const gradeIds = idsOf('grade_level');
  const classIds = idsOf('class_section');
  const studentIds = idsOf('student');
  const [grades, classes, studentRows] = await Promise.all([
    gradeIds.length
      ? db
          .select({ id: gradeLevels.id, name: gradeLevels.name })
          .from(gradeLevels)
          .where(and(eq(gradeLevels.schoolId, schoolId), inArray(gradeLevels.id, gradeIds)))
      : [],
    classIds.length
      ? db
          .select({ id: classSections.id, section: classSections.name, grade: gradeLevels.name })
          .from(classSections)
          .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
          .where(and(eq(classSections.schoolId, schoolId), inArray(classSections.id, classIds)))
      : [],
    studentIds.length
      ? db
          .select({
            id: students.id,
            first: students.firstName,
            father: students.fatherName,
            grandfather: students.grandfatherName,
          })
          .from(students)
          .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)))
      : [],
  ]);
  const names = new Map<string, string>([
    ...grades.map((g) => [`grade_level:${g.id}`, g.name] as const),
    ...classes.map((c) => [`class_section:${c.id}`, `${c.grade} - ${c.section}`] as const),
    ...studentRows.map((s) => [`student:${s.id}`, joinName(s.first, s.father, s.grandfather)] as const),
  ]);
  return (ref: AudienceRef) =>
    audienceLabel(ref.audienceType, names.get(`${ref.audienceType}:${ref.audienceId ?? ''}`) ?? null);
}

/** Throws 404 unless `audienceId` is a grade level / class / student of the school matching `type`. */
export async function assertAudienceInSchool(db: Db, schoolId: string, type: AudienceType, audienceId: string | null) {
  if (type === 'school') return;
  if (!audienceId) throw notFound();
  if (type === 'grade_level') {
    const [row] = await db
      .select({ id: gradeLevels.id })
      .from(gradeLevels)
      .where(and(eq(gradeLevels.id, audienceId), eq(gradeLevels.schoolId, schoolId)));
    if (!row) throw notFound('الصف الدراسي غير موجود');
  } else if (type === 'class_section') {
    const [row] = await db
      .select({ id: classSections.id })
      .from(classSections)
      .where(and(eq(classSections.id, audienceId), eq(classSections.schoolId, schoolId)));
    if (!row) throw notFound('الفصل غير موجود');
  } else {
    const [row] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, audienceId), eq(students.schoolId, schoolId)));
    if (!row) throw notFound('الطالب غير موجود');
  }
}
