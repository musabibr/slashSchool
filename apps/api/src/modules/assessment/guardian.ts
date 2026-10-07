import { Router } from 'express';
import { and, asc, desc, eq, isNotNull, max, or } from 'drizzle-orm';
import { computeResultSheet, weekdayOf, type ExamPeriodKind, type ResultSheet } from '@slash/shared';
import type { Db } from '../../db/client';
import { assessments, examPeriods, scores, subjects } from '../../db/schema';
import { schoolOf, studentOf, type StudentCtx } from '../../lib/context';
import { markSeenIfGuardian } from '../../lib/cursors';
import { notFound } from '../../lib/errors';
import { currentAcademicYear } from '../../lib/scope';
import { parse, zId } from '../../lib/validate';

/** Upper bound for one guardian list (a class has far fewer quizzes a year). */
const LIST_LIMIT = 300;

/** P11 — a quiz announcement of the student's class. */
export interface GuardianQuizDto {
  id: string;
  subjectName: string;
  title: string;
  date: string;
  details: string | null;
  maxScore: number;
  /** null until graded. */
  score: number | null;
}

/** "جدول الإمتحانات" — one exam period's sittings for the student's class. */
export interface GuardianExamTimetableDto {
  periodId: string;
  name: string;
  kind: ExamPeriodKind;
  rows: Array<{ subjectName: string; date: string; weekday: number }>;
}

/** P12 — the results list mixes exam periods and graded quizzes. */
export type GuardianResultItem =
  | {
      type: 'period';
      id: string;
      name: string;
      kind: ExamPeriodKind;
      /** Date of the period's last sitting. */
      date: string;
      publishedAt: string | null;
      /** Always true for guardians; staff also see unpublished periods. */
      published: boolean;
    }
  | { type: 'quiz'; id: string; title: string; subjectName: string; date: string; score: number; maxScore: number };

/** P13 — one result sheet. */
export interface GuardianResultSheetDto extends Omit<ResultSheet, 'rows'> {
  period: { id: string; name: string; kind: ExamPeriodKind; publishedAt: string | null };
  rows: Array<{ subjectId: string; subjectName: string; score: number | null; maxScore: number }>;
}

/**
 * Sittings that concern the student: those of the current class, plus any the student has a score in
 * (e.g. from a class they have since left).
 */
function concernsStudent(student: StudentCtx) {
  return or(
    student.classSectionId ? eq(assessments.classSectionId, student.classSectionId) : undefined,
    isNotNull(scores.studentId),
  );
}

const scoreJoin = (studentId: string) => and(eq(scores.assessmentId, assessments.id), eq(scores.studentId, studentId));

/**
 * Guardian exams & results (P10–P13), mounted at /api/students/:studentId (guardians and the school's staff).
 *   GET /exams              → { quizzes, timetables }
 *   GET /results            → periods (published only, for guardians) and graded quizzes, newest first
 *   GET /results/:periodId  → one result sheet (404 for guardians until published)
 */
export function guardianExamsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/exams', async (req, res) => {
    const student = studentOf(req);
    const classSectionId = student.classSectionId;
    if (!classSectionId) {
      await markSeenIfGuardian(db, req, 'exams');
      res.json({ quizzes: [], timetables: [] });
      return;
    }
    const year = await currentAcademicYear(db, student.schoolId);
    const [quizRows, sittingRows] = await Promise.all([
      db
        .select({
          id: assessments.id,
          subjectName: subjects.name,
          title: assessments.title,
          date: assessments.date,
          details: assessments.details,
          maxScore: assessments.maxScore,
          score: scores.score,
        })
        .from(assessments)
        .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
        .leftJoin(scores, scoreJoin(student.id))
        .where(
          and(
            eq(assessments.schoolId, student.schoolId),
            eq(assessments.classSectionId, classSectionId),
            eq(assessments.kind, 'quiz'),
          ),
        )
        .orderBy(desc(assessments.date), desc(assessments.createdAt), desc(assessments.id))
        .limit(LIST_LIMIT),
      year
        ? db
            .select({
              periodId: examPeriods.id,
              name: examPeriods.name,
              kind: examPeriods.kind,
              subjectName: subjects.name,
              date: assessments.date,
            })
            .from(assessments)
            .innerJoin(examPeriods, eq(examPeriods.id, assessments.examPeriodId))
            .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
            .where(
              and(
                eq(assessments.schoolId, student.schoolId),
                eq(assessments.classSectionId, classSectionId),
                eq(examPeriods.academicYearId, year.id),
              ),
            )
            .orderBy(asc(assessments.date), asc(subjects.sort), asc(subjects.name))
        : Promise.resolve([]),
    ]);

    const periods = new Map<string, GuardianExamTimetableDto>();
    for (const row of sittingRows) {
      const period = periods.get(row.periodId) ?? { periodId: row.periodId, name: row.name, kind: row.kind, rows: [] };
      period.rows.push({ subjectName: row.subjectName, date: row.date, weekday: weekdayOf(row.date) });
      periods.set(row.periodId, period);
    }
    // Newest period first (the one whose exams start last).
    const timetables = [...periods.values()].sort(
      (a, b) => b.rows[0].date.localeCompare(a.rows[0].date) || a.name.localeCompare(b.name, 'ar'),
    );
    const quizzes: GuardianQuizDto[] = quizRows.map((q) => ({ ...q, score: q.score ?? null }));

    await markSeenIfGuardian(db, req, 'exams');
    res.json({ quizzes, timetables });
  });

  r.get('/results', async (req, res) => {
    const student = studentOf(req);
    const guardian = student.access === 'guardian';
    const [periodRows, quizRows] = await Promise.all([
      db
        .select({
          id: examPeriods.id,
          name: examPeriods.name,
          kind: examPeriods.kind,
          publishedAt: examPeriods.resultsPublishedAt,
          createdAt: examPeriods.createdAt,
          date: max(assessments.date),
        })
        .from(assessments)
        .innerJoin(examPeriods, eq(examPeriods.id, assessments.examPeriodId))
        .leftJoin(scores, scoreJoin(student.id))
        .where(
          and(
            eq(assessments.schoolId, student.schoolId),
            concernsStudent(student),
            guardian ? isNotNull(examPeriods.resultsPublishedAt) : undefined,
          ),
        )
        .groupBy(examPeriods.id),
      db
        .select({
          id: assessments.id,
          title: assessments.title,
          subjectName: subjects.name,
          date: assessments.date,
          score: scores.score,
          maxScore: assessments.maxScore,
          createdAt: assessments.createdAt,
        })
        .from(assessments)
        .innerJoin(scores, scoreJoin(student.id))
        .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
        .where(and(eq(assessments.schoolId, student.schoolId), eq(assessments.kind, 'quiz')))
        .orderBy(desc(assessments.date))
        .limit(LIST_LIMIT),
    ]);

    const items: Array<GuardianResultItem & { createdAt: Date }> = [
      ...periodRows.map((p) => ({
        type: 'period' as const,
        id: p.id,
        name: p.name,
        kind: p.kind,
        date: p.date ?? '',
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
        published: !!p.publishedAt,
        createdAt: p.createdAt,
      })),
      ...quizRows.map((q) => ({ type: 'quiz' as const, ...q })),
    ];
    items.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime());

    await markSeenIfGuardian(db, req, 'results');
    res.json(items.map(({ createdAt: _createdAt, ...item }) => item));
  });

  r.get('/results/:periodId', async (req, res) => {
    const student = studentOf(req);
    const periodId = parse(zId, req.params.periodId);
    const [period] = await db
      .select()
      .from(examPeriods)
      .where(and(eq(examPeriods.id, periodId), eq(examPeriods.schoolId, student.schoolId)));
    if (!period || (student.access === 'guardian' && !period.resultsPublishedAt)) {
      throw notFound('النتيجة غير متاحة');
    }

    const sittings = await db
      .select({
        subjectId: assessments.subjectId,
        subjectName: subjects.name,
        score: scores.score,
        maxScore: assessments.maxScore,
      })
      .from(assessments)
      .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
      .leftJoin(scores, scoreJoin(student.id))
      .where(and(eq(assessments.examPeriodId, period.id), concernsStudent(student)))
      .orderBy(asc(subjects.sort), asc(subjects.name));
    if (!sittings.length) throw notFound('النتيجة غير متاحة');

    // One row per subject; a scored sitting wins over an unscored one (e.g. after a class change).
    const bySubject = new Map<string, GuardianResultSheetDto['rows'][number]>();
    for (const s of sittings) {
      const prev = bySubject.get(s.subjectId);
      if (!prev || (prev.score === null && s.score !== null)) {
        bySubject.set(s.subjectId, { ...s, score: s.score ?? null });
      }
    }
    const rows = [...bySubject.values()];
    const { rows: _rows, ...sheet } = computeResultSheet(rows, schoolOf(req).gradeBands);
    const body: GuardianResultSheetDto = {
      period: {
        id: period.id,
        name: period.name,
        kind: period.kind,
        publishedAt: period.resultsPublishedAt ? period.resultsPublishedAt.toISOString() : null,
      },
      rows,
      ...sheet,
    };
    res.json(body);
  });

  return r;
}
