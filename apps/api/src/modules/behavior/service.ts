import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { joinName, type EvaluationRating } from '@slash/shared';
import type { Db } from '../../db/client';
import {
  behaviorIncidents,
  classSections,
  evaluations,
  gradeLevels,
  regulations,
  students,
  users,
} from '../../db/schema';
import { notFound } from '../../lib/errors';

/** GET/POST /api/schools/:schoolId/behavior — one incident as staff see it (S15, admin pages). */
export interface IncidentDto {
  id: string;
  studentId: string;
  studentName: string;
  /** The student's current class, "الصف الخامس - ب". */
  classLabel: string | null;
  regulationId: string;
  regulationTitle: string;
  date: string;
  details: string | null;
  penalty: string | null;
  recordedByName: string | null;
  createdAt: string;
}

/** GET /api/schools/:schoolId/regulations */
export interface RegulationDto {
  id: string;
  code: string | null;
  title: string;
  defaultPenalty: string | null;
  incidentCount: number;
}

/** GET/PUT /api/schools/:schoolId/evaluations */
export interface EvaluationEntryDto {
  studentId: string;
  rating: EvaluationRating;
  comment: string | null;
}

/** Incidents matching `where`, newest first, joined with the student, class, regulation and recorder. */
export async function queryIncidents(db: Db, where: SQL | undefined, limit: number): Promise<IncidentDto[]> {
  const rows = await db
    .select({
      id: behaviorIncidents.id,
      studentId: behaviorIncidents.studentId,
      firstName: students.firstName,
      fatherName: students.fatherName,
      grandfatherName: students.grandfatherName,
      gradeName: gradeLevels.name,
      sectionName: classSections.name,
      regulationId: behaviorIncidents.regulationId,
      regulationTitle: regulations.title,
      date: behaviorIncidents.date,
      details: behaviorIncidents.details,
      penalty: behaviorIncidents.penalty,
      recordedByName: users.fullName,
      createdAt: behaviorIncidents.createdAt,
    })
    .from(behaviorIncidents)
    .innerJoin(students, eq(students.id, behaviorIncidents.studentId))
    .innerJoin(regulations, eq(regulations.id, behaviorIncidents.regulationId))
    .leftJoin(classSections, eq(classSections.id, students.classSectionId))
    .leftJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .leftJoin(users, eq(users.id, behaviorIncidents.recordedBy))
    .where(where)
    .orderBy(desc(behaviorIncidents.date), desc(behaviorIncidents.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: joinName(r.firstName, r.fatherName, r.grandfatherName),
    classLabel: r.gradeName && r.sectionName ? `${r.gradeName} - ${r.sectionName}` : null,
    regulationId: r.regulationId,
    regulationTitle: r.regulationTitle,
    date: r.date,
    details: r.details,
    penalty: r.penalty,
    recordedByName: r.recordedByName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getIncident(db: Db, schoolId: string, id: string): Promise<IncidentDto> {
  const [row] = await queryIncidents(
    db,
    and(eq(behaviorIncidents.id, id), eq(behaviorIncidents.schoolId, schoolId)),
    1,
  );
  if (!row) throw notFound('المخالفة غير موجودة');
  return row;
}

/** Throws 404 unless the regulation belongs to the school. */
export async function findRegulationInSchool(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select()
    .from(regulations)
    .where(and(eq(regulations.id, id), eq(regulations.schoolId, schoolId)));
  if (!row) throw notFound('اللائحة غير موجودة');
  return row;
}

/** Throws 404 unless the student belongs to the school. */
export async function findStudentInSchool(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select({ id: students.id, classSectionId: students.classSectionId })
    .from(students)
    .where(and(eq(students.id, id), eq(students.schoolId, schoolId)));
  if (!row) throw notFound('الطالب غير موجود');
  return row;
}

/** Number of incidents recorded under each of the given regulations. */
export async function incidentCounts(db: Db, regulationIds: string[]): Promise<Map<string, number>> {
  if (!regulationIds.length) return new Map();
  const rows = await db
    .select({ regulationId: behaviorIncidents.regulationId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(behaviorIncidents)
    .where(inArray(behaviorIncidents.regulationId, regulationIds))
    .groupBy(behaviorIncidents.regulationId);
  return new Map(rows.map((r) => [r.regulationId, r.n]));
}

/** Catalog order: by code (numeric-aware, regulations without a code last), then title. */
export function compareRegulations(
  a: { code: string | null; title: string },
  b: { code: string | null; title: string },
): number {
  if (a.code && b.code) {
    const byCode = a.code.localeCompare(b.code, 'ar', { numeric: true });
    if (byCode) return byCode;
  } else if (a.code || b.code) {
    return a.code ? -1 : 1;
  }
  return a.title.localeCompare(b.title, 'ar');
}

/** Saved evaluations of the class's current students for one subject and day. */
export async function classEvaluations(
  db: Db,
  schoolId: string,
  classSectionId: string,
  subjectId: string,
  date: string,
): Promise<EvaluationEntryDto[]> {
  return db
    .select({ studentId: evaluations.studentId, rating: evaluations.rating, comment: evaluations.comment })
    .from(evaluations)
    .innerJoin(students, eq(students.id, evaluations.studentId))
    .where(
      and(
        eq(evaluations.schoolId, schoolId),
        eq(students.classSectionId, classSectionId),
        eq(evaluations.subjectId, subjectId),
        eq(evaluations.date, date),
      ),
    )
    .orderBy(evaluations.studentId);
}
