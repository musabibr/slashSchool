import { Router, type Request } from 'express';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { computeResultSheet, type ResultSheet } from '@slash/shared';
import type { Db } from '../../db/client';
import {
  academicYears,
  assessments,
  classSections,
  examPeriods,
  gradeLevels,
  scores,
  subjects,
  teachingAssignments,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { hasRole, requireRole, schoolOf, userOf } from '../../lib/context';
import { badRequest, conflict, notFound } from '../../lib/errors';
import {
  assertCanAccessClass,
  assertCanTeach,
  assertStudentsInClass,
  classStudents,
  currentAcademicYear,
} from '../../lib/scope';
import { parse, zId } from '../../lib/validate';
import {
  assessmentsQuery,
  createPeriodSchema,
  createQuizSchema,
  periodResultsQuery,
  periodsQuery,
  publishSchema,
  saveScoresSchema,
  timetableSchema,
  updatePeriodSchema,
  updateQuizSchema,
} from './schemas';
import {
  countScores,
  findAssessment,
  findPeriod,
  getAssessmentDto,
  getPeriodDto,
  gradeClasses,
  highestScore,
  listPeriodDtos,
  loadScoreSheet,
  periodTimetableRows,
  queryAssessments,
  scoreMap,
  taughtBy,
  toAssessmentDtos,
  type ExamPeriodDto,
} from './service';

const adminOrSupervisor = requireRole('admin', 'supervisor');

/** GET /exam-periods/:id/results — one student's line in the staff results table. */
export interface StaffResultLine extends Omit<ResultSheet, 'rows'> {
  id: string;
  code: string;
  fullName: string;
  classSectionId: string;
  classLabel: string;
  scores: Array<{ subjectId: string; score: number | null; maxScore: number }>;
}

export interface StaffPeriodResults {
  period: ExamPeriodDto;
  classes: Array<{ id: string; label: string }>;
  subjects: Array<{ subjectId: string; subjectName: string; maxScore: number }>;
  students: StaffResultLine[];
}

/**
 * Exam periods and their timetables (S11 / S12): /api/schools/:schoolId/exam-periods.
 *   GET    /?gradeLevelId        → periods of the current academic year (any staff)
 *   POST   /                     → 201 period (admins/supervisors)
 *   PATCH  /:id                  → period (admins/supervisors)
 *   DELETE /:id                  → { ok } — 409 once scores exist (admins/supervisors)
 *   GET    /:id/timetable        → { period, rows } (any staff)
 *   PUT    /:id/timetable {rows} → one assessment per class section × subject (admins/supervisors)
 *   POST   /:id/publish          → show / hide results to guardians (admins/supervisors)
 *   GET    /:id/results?classId  → students × subjects with totals (admins/supervisors; teachers: their classes)
 */
export function examPeriodsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(periodsQuery, req.query);
    const year = await currentAcademicYear(db, school.id);
    if (!year) {
      res.json([]);
      return;
    }
    res.json(
      await listPeriodDtos(
        db,
        and(
          eq(examPeriods.schoolId, school.id),
          eq(examPeriods.academicYearId, year.id),
          q.gradeLevelId ? eq(examPeriods.gradeLevelId, q.gradeLevelId) : undefined,
        ),
      ),
    );
  });

  r.post('/', adminOrSupervisor, async (req, res) => {
    const school = schoolOf(req);
    const body = parse(createPeriodSchema, req.body);
    const [grade] = await db
      .select({ id: gradeLevels.id })
      .from(gradeLevels)
      .where(and(eq(gradeLevels.id, body.gradeLevelId), eq(gradeLevels.schoolId, school.id)));
    if (!grade) throw notFound('الصف غير موجود');
    const year = await currentAcademicYear(db, school.id);
    if (!year) throw badRequest('لم يتم إعداد العام الدراسي الحالي');
    const [row] = await db
      .insert(examPeriods)
      .values({
        schoolId: school.id,
        academicYearId: year.id,
        gradeLevelId: grade.id,
        kind: body.kind,
        name: body.name,
        createdBy: userOf(req).id,
      })
      .returning({ id: examPeriods.id });
    res.status(201).json(await getPeriodDto(db, school.id, row.id));
  });

  r.patch('/:periodId', adminOrSupervisor, async (req, res) => {
    const school = schoolOf(req);
    const periodId = parse(zId, req.params.periodId);
    const body = parse(updatePeriodSchema, req.body);
    const period = await findPeriod(db, school.id, periodId);
    await db.transaction(async (tx) => {
      await tx
        .update(examPeriods)
        .set({ name: body.name ?? period.name, kind: body.kind ?? period.kind })
        .where(eq(examPeriods.id, period.id));
      // A period's sittings carry the period kind.
      if (body.kind && body.kind !== period.kind) {
        await tx
          .update(assessments)
          .set({ kind: body.kind, updatedAt: new Date() })
          .where(eq(assessments.examPeriodId, period.id));
      }
    });
    res.json(await getPeriodDto(db, school.id, period.id));
  });

  r.delete('/:periodId', adminOrSupervisor, async (req, res) => {
    const school = schoolOf(req);
    const periodId = parse(zId, req.params.periodId);
    const period = await findPeriod(db, school.id, periodId);
    const ids = (
      await db.select({ id: assessments.id }).from(assessments).where(eq(assessments.examPeriodId, period.id))
    ).map((a) => a.id);
    if ((await countScores(db, ids)) > 0) throw conflict('لا يمكن حذف فترة امتحانات تم رصد درجات فيها');
    await db.delete(examPeriods).where(and(eq(examPeriods.id, period.id), eq(examPeriods.schoolId, school.id)));
    res.json({ ok: true });
  });

  r.get('/:periodId/timetable', async (req, res) => {
    const school = schoolOf(req);
    const periodId = parse(zId, req.params.periodId);
    const period = await getPeriodDto(db, school.id, periodId);
    res.json({ period, rows: await periodTimetableRows(db, period.id) });
  });

  r.put('/:periodId/timetable', adminOrSupervisor, async (req, res) => {
    const school = schoolOf(req);
    const periodId = parse(zId, req.params.periodId);
    const { rows } = parse(timetableSchema, req.body);
    const period = await findPeriod(db, school.id, periodId);

    const [year] = await db.select().from(academicYears).where(eq(academicYears.id, period.academicYearId));
    const outside = rows.flatMap((row, i) =>
      year && (row.date < year.startsOn || row.date > year.endsOn)
        ? [{ path: `rows.${i}.date`, message: 'التاريخ خارج العام الدراسي' }]
        : [],
    );
    if (outside.length) throw badRequest('بيانات غير صالحة', outside);

    const subjectIds = rows.map((row) => row.subjectId);
    const subjectRows = subjectIds.length
      ? await db
          .select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(and(eq(subjects.schoolId, school.id), inArray(subjects.id, subjectIds)))
      : [];
    if (subjectRows.length !== subjectIds.length) throw notFound('المادة غير موجودة');
    const subjectName = new Map(subjectRows.map((s) => [s.id, s.name]));

    const classes = await gradeClasses(db, school.id, period.gradeLevelId, period.academicYearId);
    if (rows.length && !classes.length) throw badRequest('لا توجد فصول لهذا الصف في العام الدراسي');

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({
          id: assessments.id,
          classSectionId: assessments.classSectionId,
          subjectId: assessments.subjectId,
          date: assessments.date,
          maxScore: assessments.maxScore,
          title: assessments.title,
          kind: assessments.kind,
        })
        .from(assessments)
        .where(eq(assessments.examPeriodId, period.id));
      const wanted = new Map(rows.map((row) => [row.subjectId, row]));

      // Subjects taken out of the timetable: only while nobody has a score in them.
      const removed = existing.filter((a) => !wanted.has(a.subjectId));
      if (removed.length) {
        const scored = await tx
          .selectDistinct({ name: subjects.name })
          .from(scores)
          .innerJoin(assessments, eq(assessments.id, scores.assessmentId))
          .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
          .where(
            inArray(
              scores.assessmentId,
              removed.map((a) => a.id),
            ),
          );
        if (scored.length) {
          throw conflict(`لا يمكن حذف مادة تم رصد درجات فيها: ${scored.map((s) => s.name).join('، ')}`);
        }
        await tx.delete(assessments).where(
          inArray(
            assessments.id,
            removed.map((a) => a.id),
          ),
        );
      }

      for (const row of rows) {
        const title = subjectName.get(row.subjectId) ?? '';
        const sittings = existing.filter((a) => a.subjectId === row.subjectId);
        const lowered = sittings.filter((a) => a.maxScore > row.maxScore).map((a) => a.id);
        const top = await highestScore(tx, lowered);
        if (top !== null && top > row.maxScore) {
          throw conflict(`توجد درجات في ${title} أعلى من الدرجة النهائية الجديدة (أعلى درجة ${top})`);
        }
        const changed = sittings
          .filter(
            (a) => a.date !== row.date || a.maxScore !== row.maxScore || a.title !== title || a.kind !== period.kind,
          )
          .map((a) => a.id);
        if (changed.length) {
          await tx
            .update(assessments)
            .set({ date: row.date, maxScore: row.maxScore, title, kind: period.kind, updatedAt: new Date() })
            .where(inArray(assessments.id, changed));
        }
      }

      const have = new Set(existing.map((a) => `${a.classSectionId}:${a.subjectId}`));
      const inserts = classes.flatMap((c) =>
        rows
          .filter((row) => !have.has(`${c.id}:${row.subjectId}`))
          .map((row) => ({
            schoolId: school.id,
            examPeriodId: period.id,
            classSectionId: c.id,
            subjectId: row.subjectId,
            kind: period.kind,
            title: subjectName.get(row.subjectId) ?? '',
            date: row.date,
            maxScore: row.maxScore,
            createdBy: userOf(req).id,
          })),
      );
      if (inserts.length) await tx.insert(assessments).values(inserts);
    });

    res.json({ period: await getPeriodDto(db, school.id, period.id), rows: await periodTimetableRows(db, period.id) });
  });

  r.post('/:periodId/publish', adminOrSupervisor, async (req, res) => {
    const school = schoolOf(req);
    const periodId = parse(zId, req.params.periodId);
    const { published } = parse(publishSchema, req.body);
    const period = await findPeriod(db, school.id, periodId);
    if (published !== !!period.resultsPublishedAt) {
      if (published) {
        const [sitting] = await db
          .select({ id: assessments.id })
          .from(assessments)
          .where(eq(assessments.examPeriodId, period.id))
          .limit(1);
        if (!sitting) throw badRequest('أضف جدول الامتحانات قبل نشر النتائج');
      }
      const resultsPublishedAt = published ? new Date() : null;
      await db.transaction(async (tx) => {
        await tx.update(examPeriods).set({ resultsPublishedAt }).where(eq(examPeriods.id, period.id));
        await audit(tx, {
          schoolId: school.id,
          actorId: userOf(req).id,
          entity: 'exam_period',
          entityId: period.id,
          action: published ? 'publish' : 'unpublish',
          before: { resultsPublishedAt: period.resultsPublishedAt?.toISOString() ?? null },
          after: { resultsPublishedAt: resultsPublishedAt?.toISOString() ?? null },
        });
      });
    }
    res.json(await getPeriodDto(db, school.id, period.id));
  });

  r.get('/:periodId/results', async (req, res) => {
    const school = schoolOf(req);
    const periodId = parse(zId, req.params.periodId);
    const q = parse(periodResultsQuery, req.query);
    const period = await getPeriodDto(db, school.id, periodId);
    let classes = await gradeClasses(db, school.id, period.gradeLevelId, period.academicYearId);
    if (q.classId) {
      await assertCanAccessClass(db, req, q.classId);
      classes = classes.filter((c) => c.id === q.classId);
      if (!classes.length) throw badRequest('الفصل لا ينتمي لصف فترة الامتحانات');
    } else if (!hasRole(req, 'admin', 'supervisor')) {
      const mine = await db
        .selectDistinct({ classSectionId: teachingAssignments.classSectionId })
        .from(teachingAssignments)
        .where(eq(teachingAssignments.teacherId, userOf(req).id));
      const allowed = new Set(mine.map((m) => m.classSectionId));
      classes = classes.filter((c) => allowed.has(c.id));
    }
    res.json(await periodResults(db, school.gradeBands, period, classes));
  });

  return r;
}

/** Students × subjects of the given classes for one period, each student with computed totals. */
async function periodResults(
  db: Db,
  bands: Parameters<typeof computeResultSheet>[1],
  period: ExamPeriodDto,
  classes: Array<{ id: string; label: string }>,
): Promise<StaffPeriodResults> {
  const classIds = classes.map((c) => c.id);
  if (!classIds.length) return { period, classes, subjects: [], students: [] };
  const sittings = await db
    .select({
      id: assessments.id,
      classSectionId: assessments.classSectionId,
      subjectId: assessments.subjectId,
      subjectName: subjects.name,
      maxScore: assessments.maxScore,
    })
    .from(assessments)
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .where(and(eq(assessments.examPeriodId, period.id), inArray(assessments.classSectionId, classIds)))
    .orderBy(asc(subjects.sort), asc(subjects.name));
  const scoreRows = sittings.length
    ? await db
        .select({ assessmentId: scores.assessmentId, studentId: scores.studentId, score: scores.score })
        .from(scores)
        .where(
          inArray(
            scores.assessmentId,
            sittings.map((s) => s.id),
          ),
        )
    : [];
  const scoreOf = new Map(scoreRows.map((s) => [`${s.assessmentId}:${s.studentId}`, s.score]));

  const subjectList = new Map<string, { subjectId: string; subjectName: string; maxScore: number }>();
  for (const s of sittings) {
    if (!subjectList.has(s.subjectId)) {
      subjectList.set(s.subjectId, { subjectId: s.subjectId, subjectName: s.subjectName, maxScore: s.maxScore });
    }
  }

  const students: StaffResultLine[] = [];
  for (const cls of classes) {
    const classSittings = sittings.filter((s) => s.classSectionId === cls.id);
    for (const student of await classStudents(db, cls.id)) {
      const rows = classSittings.map((s) => ({
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        score: scoreOf.get(`${s.id}:${student.id}`) ?? null,
        maxScore: s.maxScore,
      }));
      const { rows: _rows, ...sheet } = computeResultSheet(rows, bands);
      students.push({
        id: student.id,
        code: student.code,
        fullName: student.fullName,
        classSectionId: cls.id,
        classLabel: cls.label,
        scores: rows.map((row) => ({ subjectId: row.subjectId, score: row.score, maxScore: row.maxScore })),
        ...sheet,
      });
    }
  }
  return { period, classes, subjects: [...subjectList.values()], students };
}

/**
 * Quizzes, exam sittings and grade entry (S13, S14, T7): /api/schools/:schoolId/assessments.
 *   GET    /?classId&subjectId&kind&examPeriodId → current-year assessments, newest first
 *   GET    /:id                                   → one assessment
 *   POST   /                                      → 201 quiz announcement
 *   PATCH  /:id, DELETE /:id                      → quizzes only (exam sittings are edited via the timetable)
 *   GET    /:id/scores                            → the class's students with their score
 *   PUT    /:id/scores {scores}                   → upsert (null removes), audited
 * Admins and supervisors act on the whole school; teachers only on their (class, subject) assignments.
 */
export function assessmentsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  const scopeFilter = (req: Request): SQL | undefined =>
    hasRole(req, 'admin', 'supervisor') ? undefined : taughtBy(db, userOf(req).id);

  /** The assessment, after checking the user may manage its class + subject. */
  const loadManaged = async (req: Request) => {
    const id = parse(zId, req.params.assessmentId);
    const row = await findAssessment(db, schoolOf(req).id, id);
    await assertCanTeach(db, req, row.classSectionId, row.subjectId);
    return row;
  };

  const quizOnly = (kind: string) => {
    if (kind !== 'quiz') throw badRequest('امتحانات الفترات تُعدّل من جدول الامتحانات');
  };

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(assessmentsQuery, req.query);
    const year = await currentAcademicYear(db, school.id);
    if (!year) {
      res.json([]);
      return;
    }
    const rows = await queryAssessments(
      db,
      and(
        eq(assessments.schoolId, school.id),
        eq(classSections.academicYearId, year.id),
        scopeFilter(req),
        q.classId ? eq(assessments.classSectionId, q.classId) : undefined,
        q.subjectId ? eq(assessments.subjectId, q.subjectId) : undefined,
        q.kind ? eq(assessments.kind, q.kind) : undefined,
        q.examPeriodId ? eq(assessments.examPeriodId, q.examPeriodId) : undefined,
      ),
      q.limit,
    );
    res.json(await toAssessmentDtos(db, rows));
  });

  r.get('/:assessmentId', async (req, res) => {
    const row = await loadManaged(req);
    res.json(await getAssessmentDto(db, row.schoolId, row.id));
  });

  r.post('/', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(createQuizSchema, req.body);
    await assertCanTeach(db, req, body.classSectionId, body.subjectId);
    const [row] = await db
      .insert(assessments)
      .values({
        schoolId: school.id,
        classSectionId: body.classSectionId,
        subjectId: body.subjectId,
        kind: 'quiz',
        title: body.title,
        date: body.date,
        maxScore: body.maxScore,
        details: body.details,
        createdBy: userOf(req).id,
      })
      .returning({ id: assessments.id });
    res.status(201).json(await getAssessmentDto(db, school.id, row.id));
  });

  r.patch('/:assessmentId', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(updateQuizSchema, req.body);
    const existing = await loadManaged(req);
    quizOnly(existing.kind);

    const classSectionId = body.classSectionId ?? existing.classSectionId;
    const subjectId = body.subjectId ?? existing.subjectId;
    const moved = classSectionId !== existing.classSectionId || subjectId !== existing.subjectId;
    if (moved) await assertCanTeach(db, req, classSectionId, subjectId);
    const scored = await countScores(db, [existing.id]);
    if (moved && scored > 0) throw conflict('لا يمكن تغيير الفصل أو المادة بعد رصد الدرجات');
    const maxScore = body.maxScore ?? existing.maxScore;
    if (maxScore < existing.maxScore) {
      const top = await highestScore(db, [existing.id]);
      if (top !== null && top > maxScore) {
        throw conflict(`توجد درجات أعلى من الدرجة النهائية الجديدة (أعلى درجة ${top})`);
      }
    }

    await db
      .update(assessments)
      .set({
        classSectionId,
        subjectId,
        title: body.title ?? existing.title,
        date: body.date ?? existing.date,
        maxScore,
        details: body.details !== undefined ? body.details : existing.details,
        updatedAt: new Date(),
      })
      .where(and(eq(assessments.id, existing.id), eq(assessments.schoolId, school.id)));
    res.json(await getAssessmentDto(db, school.id, existing.id));
  });

  r.delete('/:assessmentId', async (req, res) => {
    const school = schoolOf(req);
    const existing = await loadManaged(req);
    quizOnly(existing.kind);
    if ((await countScores(db, [existing.id])) > 0) throw conflict('لا يمكن حذف اختبار تم رصد درجاته');
    await db.delete(assessments).where(and(eq(assessments.id, existing.id), eq(assessments.schoolId, school.id)));
    res.json({ ok: true });
  });

  r.get('/:assessmentId/scores', async (req, res) => {
    const row = await loadManaged(req);
    res.json(await loadScoreSheet(db, row.schoolId, row.id));
  });

  r.put('/:assessmentId/scores', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const body = parse(saveScoresSchema, req.body);
    const assessment = await loadManaged(req);

    const tooHigh = body.scores.flatMap((s, i) =>
      s.score !== null && s.score > assessment.maxScore
        ? [{ path: `scores.${i}.score`, message: `الدرجة يجب ألا تتجاوز ${assessment.maxScore}` }]
        : [],
    );
    if (tooHigh.length) throw badRequest('بيانات غير صالحة', tooHigh);
    await assertStudentsInClass(
      db,
      assessment.classSectionId,
      body.scores.map((s) => s.studentId),
    );

    await db.transaction(async (tx) => {
      const previous = await scoreMap(tx, assessment.id);
      const before: Record<string, number | null> = {};
      const after: Record<string, number | null> = {};
      const toDelete: string[] = [];
      const toUpsert: Array<{ studentId: string; score: number }> = [];
      for (const { studentId, score } of body.scores) {
        const old = previous.get(studentId) ?? null;
        if (old === score) continue;
        before[studentId] = old;
        after[studentId] = score;
        if (score === null) toDelete.push(studentId);
        else toUpsert.push({ studentId, score });
      }
      if (!toDelete.length && !toUpsert.length) return; // nothing changed

      if (toDelete.length) {
        await tx.delete(scores).where(and(eq(scores.assessmentId, assessment.id), inArray(scores.studentId, toDelete)));
      }
      for (const { studentId, score } of toUpsert) {
        await tx
          .insert(scores)
          .values({ assessmentId: assessment.id, studentId, score, enteredBy: user.id, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [scores.assessmentId, scores.studentId],
            set: { score, enteredBy: user.id, updatedAt: new Date() },
          });
      }
      await audit(tx, {
        schoolId: school.id,
        actorId: user.id,
        entity: 'assessment_scores',
        entityId: assessment.id,
        action: previous.size ? 'update' : 'create',
        before,
        after,
      });
    });

    res.json(await loadScoreSheet(db, school.id, assessment.id));
  });

  return r;
}
