import { and, asc, count, countDistinct, desc, eq, exists, inArray, max, min, sql, type SQL } from 'drizzle-orm';
import type { AssessmentKind, ExamPeriodKind } from '@slash/shared';
import type { Db } from '../../db/client';
import {
  assessments,
  classSections,
  examPeriods,
  gradeLevels,
  scores,
  students,
  subjects,
  teachingAssignments,
} from '../../db/schema';
import { notFound } from '../../lib/errors';
import { classStudents } from '../../lib/scope';

// ───────────────────────────── DTOs ─────────────────────────────

/** An exam period as staff see it (S12). */
export interface ExamPeriodDto {
  id: string;
  name: string;
  kind: ExamPeriodKind;
  gradeLevelId: string;
  gradeLevelName: string;
  academicYearId: string;
  /** ISO timestamp; null while results are hidden from guardians. */
  resultsPublishedAt: string | null;
  /** Distinct subjects in the period's timetable. */
  subjectCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** At least one score was entered for this period (it can no longer be deleted). */
  hasScores: boolean;
}

/** One assessment (quiz or exam timetable row) as staff see it (S13 / S14). */
export interface AssessmentDto {
  id: string;
  kind: AssessmentKind;
  title: string;
  date: string;
  maxScore: number;
  details: string | null;
  classSectionId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  examPeriodId: string | null;
  examPeriodName: string | null;
  /** Active students of the class with a score. */
  scoredCount: number;
  /** Active students currently in the class. */
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreSheetDto {
  assessment: AssessmentDto;
  students: Array<{ id: string; code: string; fullName: string; score: number | null }>;
}

// ───────────────────────────── Exam periods ─────────────────────────────

/** Exam periods matching `where` with their timetable stats, newest first. */
export async function listPeriodDtos(db: Db, where: SQL | undefined): Promise<ExamPeriodDto[]> {
  const rows = await db
    .select({
      id: examPeriods.id,
      name: examPeriods.name,
      kind: examPeriods.kind,
      gradeLevelId: examPeriods.gradeLevelId,
      gradeLevelName: gradeLevels.name,
      academicYearId: examPeriods.academicYearId,
      resultsPublishedAt: examPeriods.resultsPublishedAt,
      subjectCount: countDistinct(assessments.subjectId),
      firstDate: min(assessments.date),
      lastDate: max(assessments.date),
    })
    .from(examPeriods)
    .innerJoin(gradeLevels, eq(gradeLevels.id, examPeriods.gradeLevelId))
    .leftJoin(assessments, eq(assessments.examPeriodId, examPeriods.id))
    .where(where)
    .groupBy(examPeriods.id, gradeLevels.id)
    .orderBy(desc(examPeriods.createdAt), desc(examPeriods.id));
  if (!rows.length) return [];
  const scored = await db
    .selectDistinct({ id: assessments.examPeriodId })
    .from(scores)
    .innerJoin(assessments, eq(assessments.id, scores.assessmentId))
    .where(
      inArray(
        assessments.examPeriodId,
        rows.map((r) => r.id),
      ),
    );
  const withScores = new Set(scored.map((s) => s.id));
  return rows.map((r) => ({
    ...r,
    resultsPublishedAt: r.resultsPublishedAt ? r.resultsPublishedAt.toISOString() : null,
    hasScores: withScores.has(r.id),
  }));
}

/** The raw exam period row, 404 unless it belongs to the school. */
export async function findPeriod(db: Db, schoolId: string, periodId: string) {
  const [row] = await db
    .select()
    .from(examPeriods)
    .where(and(eq(examPeriods.id, periodId), eq(examPeriods.schoolId, schoolId)));
  if (!row) throw notFound('فترة الامتحانات غير موجودة');
  return row;
}

export async function getPeriodDto(db: Db, schoolId: string, periodId: string): Promise<ExamPeriodDto> {
  const [dto] = await listPeriodDtos(db, and(eq(examPeriods.schoolId, schoolId), eq(examPeriods.id, periodId)));
  if (!dto) throw notFound('فترة الامتحانات غير موجودة');
  return dto;
}

/** Class sections of a grade level in one academic year, with labels. */
export async function gradeClasses(db: Db, schoolId: string, gradeLevelId: string, academicYearId: string) {
  const rows = await db
    .select({ id: classSections.id, name: classSections.name, gradeName: gradeLevels.name })
    .from(classSections)
    .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .where(
      and(
        eq(classSections.schoolId, schoolId),
        eq(classSections.gradeLevelId, gradeLevelId),
        eq(classSections.academicYearId, academicYearId),
      ),
    )
    .orderBy(asc(classSections.name));
  return rows.map((r) => ({ id: r.id, label: `${r.gradeName} - ${r.name}` }));
}

/** One row per subject of a period's timetable (date and max score of its earliest sitting). */
export async function periodTimetableRows(db: Db, periodId: string) {
  const rows = await db
    .select({
      subjectId: assessments.subjectId,
      subjectName: subjects.name,
      sort: subjects.sort,
      date: assessments.date,
      maxScore: assessments.maxScore,
    })
    .from(assessments)
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .where(eq(assessments.examPeriodId, periodId))
    .orderBy(asc(assessments.date), asc(subjects.sort), asc(subjects.name));
  const bySubject = new Map<string, { subjectId: string; subjectName: string; date: string; maxScore: number }>();
  for (const r of rows) {
    if (!bySubject.has(r.subjectId)) {
      bySubject.set(r.subjectId, {
        subjectId: r.subjectId,
        subjectName: r.subjectName,
        date: r.date,
        maxScore: r.maxScore,
      });
    }
  }
  return [...bySubject.values()];
}

// ───────────────────────────── Assessments ─────────────────────────────

const assessmentColumns = {
  id: assessments.id,
  kind: assessments.kind,
  title: assessments.title,
  date: assessments.date,
  maxScore: assessments.maxScore,
  details: assessments.details,
  classSectionId: assessments.classSectionId,
  sectionName: classSections.name,
  gradeName: gradeLevels.name,
  subjectId: assessments.subjectId,
  subjectName: subjects.name,
  examPeriodId: assessments.examPeriodId,
  examPeriodName: examPeriods.name,
  createdAt: assessments.createdAt,
  updatedAt: assessments.updatedAt,
};

export type AssessmentRow = Awaited<ReturnType<typeof queryAssessments>>[number];

/** Assessments matching `where`, newest first, with class/subject/period names. */
export function queryAssessments(db: Db, where: SQL | undefined, limit: number) {
  return db
    .select(assessmentColumns)
    .from(assessments)
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .innerJoin(classSections, eq(classSections.id, assessments.classSectionId))
    .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .leftJoin(examPeriods, eq(examPeriods.id, assessments.examPeriodId))
    .where(where)
    .orderBy(desc(assessments.date), desc(assessments.createdAt), desc(assessments.id))
    .limit(limit);
}

/** Only assessments of (class, subject) pairs the teacher is assigned to. */
export function taughtBy(db: Db, teacherId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(teachingAssignments)
      .where(
        and(
          eq(teachingAssignments.classSectionId, assessments.classSectionId),
          eq(teachingAssignments.subjectId, assessments.subjectId),
          eq(teachingAssignments.teacherId, teacherId),
        ),
      ),
  );
}

/** Adds score progress and class sizes to assessment rows. */
export async function toAssessmentDtos(db: Db, rows: AssessmentRow[]): Promise<AssessmentDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const classIds = [...new Set(rows.map((r) => r.classSectionId))];
  const [scoredRows, sizeRows] = await Promise.all([
    db
      .select({ assessmentId: scores.assessmentId, n: count() })
      .from(scores)
      .innerJoin(assessments, eq(assessments.id, scores.assessmentId))
      .innerJoin(
        students,
        and(
          eq(students.id, scores.studentId),
          eq(students.classSectionId, assessments.classSectionId),
          eq(students.status, 'active'),
        ),
      )
      .where(inArray(scores.assessmentId, ids))
      .groupBy(scores.assessmentId),
    db
      .select({ classSectionId: students.classSectionId, n: count() })
      .from(students)
      .where(and(inArray(students.classSectionId, classIds), eq(students.status, 'active')))
      .groupBy(students.classSectionId),
  ]);
  const scored = new Map(scoredRows.map((r) => [r.assessmentId, r.n]));
  const sizes = new Map(sizeRows.map((r) => [r.classSectionId, r.n]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    date: r.date,
    maxScore: r.maxScore,
    details: r.details,
    classSectionId: r.classSectionId,
    classLabel: `${r.gradeName} - ${r.sectionName}`,
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    examPeriodId: r.examPeriodId,
    examPeriodName: r.examPeriodName,
    scoredCount: scored.get(r.id) ?? 0,
    studentCount: sizes.get(r.classSectionId) ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** One assessment DTO within the school (optionally narrowed, e.g. to a teacher's scope); 404 otherwise. */
export async function getAssessmentDto(db: Db, schoolId: string, id: string, extra?: SQL): Promise<AssessmentDto> {
  const rows = await queryAssessments(db, and(eq(assessments.schoolId, schoolId), eq(assessments.id, id), extra), 1);
  if (!rows.length) throw notFound('الاختبار غير موجود');
  const [dto] = await toAssessmentDtos(db, rows);
  return dto;
}

/** The raw assessment row, 404 unless it belongs to the school. */
export async function findAssessment(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select()
    .from(assessments)
    .where(and(eq(assessments.id, id), eq(assessments.schoolId, schoolId)));
  if (!row) throw notFound('الاختبار غير موجود');
  return row;
}

/** Number of scores entered for any of the assessments. */
export async function countScores(db: Db, assessmentIds: string[]): Promise<number> {
  if (!assessmentIds.length) return 0;
  const [row] = await db.select({ n: count() }).from(scores).where(inArray(scores.assessmentId, assessmentIds));
  return row?.n ?? 0;
}

/** Highest score entered for any of the assessments (null when none). */
export async function highestScore(db: Db, assessmentIds: string[]): Promise<number | null> {
  if (!assessmentIds.length) return null;
  const [row] = await db
    .select({ top: max(scores.score) })
    .from(scores)
    .where(inArray(scores.assessmentId, assessmentIds));
  return row?.top ?? null;
}

/** Students' scores for one assessment, keyed by student id. */
export async function scoreMap(db: Db, assessmentId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ studentId: scores.studentId, score: scores.score })
    .from(scores)
    .where(eq(scores.assessmentId, assessmentId));
  return new Map(rows.map((r) => [r.studentId, r.score]));
}

/** The S14 grade sheet: the class's active students with their score (null when not entered). */
export async function loadScoreSheet(db: Db, schoolId: string, assessmentId: string): Promise<ScoreSheetDto> {
  const assessment = await getAssessmentDto(db, schoolId, assessmentId);
  const [roster, entered] = await Promise.all([
    classStudents(db, assessment.classSectionId),
    scoreMap(db, assessmentId),
  ]);
  return {
    assessment,
    students: roster.map((s) => ({ id: s.id, code: s.code, fullName: s.fullName, score: entered.get(s.id) ?? null })),
  };
}
