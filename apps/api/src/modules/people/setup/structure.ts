import { Router } from 'express';
import { and, asc, count, desc, eq, inArray, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../../db/client';
import {
  academicYears,
  assessments,
  attendanceSessions,
  classSections,
  evaluations,
  examPeriods,
  feePlans,
  gradeLevels,
  lessons,
  memberships,
  stages,
  students,
  subjects,
  teachingAssignments,
  users,
} from '../../../db/schema';
import { requireRole, schoolOf } from '../../../lib/context';
import { badRequest, conflict, notFound } from '../../../lib/errors';
import { assertClassInSchool, assertSubjectInSchool, currentAcademicYear } from '../../../lib/scope';
import { parse, zDate, zId, zText } from '../../../lib/validate';
import { assertNotInUse, nonEmpty, NOTHING_TO_UPDATE, zSort } from './common';

// ───────────────────────────── Validation ─────────────────────────────

const zName = (max = 100) => zText(max);
const ENDS_AFTER_START = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية';

const yearCreate = z
  .object({ name: zName(50), startsOn: zDate, endsOn: zDate, isCurrent: z.boolean().optional() })
  .refine((v) => v.startsOn < v.endsOn, { message: ENDS_AFTER_START, path: ['endsOn'] });
const yearPatch = z
  .object({
    name: zName(50).optional(),
    startsOn: zDate.optional(),
    endsOn: zDate.optional(),
    isCurrent: z.boolean().optional(),
  })
  .refine(nonEmpty, NOTHING_TO_UPDATE);

const stageCreate = z.object({ name: zName(), sort: zSort.optional() });
const stagePatch = z.object({ name: zName().optional(), sort: zSort.optional() }).refine(nonEmpty, NOTHING_TO_UPDATE);

const gradeCreate = z.object({ stageId: zId, name: zName(), sort: zSort.optional() });
const gradePatch = z
  .object({ stageId: zId.optional(), name: zName().optional(), sort: zSort.optional() })
  .refine(nonEmpty, NOTHING_TO_UPDATE);

const sectionCreate = z.object({ gradeLevelId: zId, name: zName(50), academicYearId: zId.optional() });
const sectionPatch = z.object({ name: zName(50) });

const subjectCreate = z.object({ name: zName(), sort: zSort.optional() });
const subjectPatch = z.object({ name: zName().optional(), sort: zSort.optional() }).refine(nonEmpty, NOTHING_TO_UPDATE);

const assignmentBody = z.object({
  classSectionId: zId,
  subjectId: zId,
  /** null removes the assignment. */
  teacherId: z.union([zId, z.null()], { errorMap: () => ({ message: 'الأستاذ غير صالح' }) }),
});

// ───────────────────────────── Lookups ─────────────────────────────

async function findYear(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.id, id), eq(academicYears.schoolId, schoolId)));
  if (!row) throw notFound('العام الدراسي غير موجود');
  return row;
}

async function findStage(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select()
    .from(stages)
    .where(and(eq(stages.id, id), eq(stages.schoolId, schoolId)));
  if (!row) throw notFound('المرحلة غير موجودة');
  return row;
}

async function findGrade(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select()
    .from(gradeLevels)
    .where(and(eq(gradeLevels.id, id), eq(gradeLevels.schoolId, schoolId)));
  if (!row) throw notFound('الصف غير موجود');
  return row;
}

const toYear = (row: typeof academicYears.$inferSelect, currentId?: string | null) => ({
  id: row.id,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  isCurrent: currentId === undefined ? row.isCurrent : row.id === currentId,
});
const toStage = (row: typeof stages.$inferSelect) => ({ id: row.id, name: row.name, sort: row.sort });
const toGrade = (row: typeof gradeLevels.$inferSelect) => ({
  id: row.id,
  stageId: row.stageId,
  name: row.name,
  sort: row.sort,
});
const toSubject = (row: typeof subjects.$inferSelect) => ({ id: row.id, name: row.name, sort: row.sort });

const byArabicName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ar');

/**
 * School structure (admin "الفصول والمواد"): /api/schools/:schoolId/setup
 *   GET  /structure                     → years, stage → grade → section tree (current year), subjects, assignments
 *   POST|PATCH|DELETE /academic-years, /stages, /grade-levels, /class-sections, /subjects
 *   PUT  /assignments {classSectionId, subjectId, teacherId|null}
 * Deleting an item that still carries data (students, lessons, attendance, exams, fees…) is refused with 409.
 */
export function structureRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin'));

  r.get('/structure', async (req, res) => {
    const school = schoolOf(req);
    const [year, yearRows, stageRows, gradeRows, subjectRows] = await Promise.all([
      currentAcademicYear(db, school.id),
      db
        .select()
        .from(academicYears)
        .where(eq(academicYears.schoolId, school.id))
        .orderBy(desc(academicYears.startsOn)),
      db.select().from(stages).where(eq(stages.schoolId, school.id)).orderBy(asc(stages.sort), asc(stages.name)),
      db
        .select()
        .from(gradeLevels)
        .where(eq(gradeLevels.schoolId, school.id))
        .orderBy(asc(gradeLevels.sort), asc(gradeLevels.name)),
      db
        .select()
        .from(subjects)
        .where(eq(subjects.schoolId, school.id))
        .orderBy(asc(subjects.sort), asc(subjects.name)),
    ]);

    const sectionRows = year
      ? await db
          .select()
          .from(classSections)
          .where(and(eq(classSections.schoolId, school.id), eq(classSections.academicYearId, year.id)))
      : [];
    const sectionIds = sectionRows.map((c) => c.id);
    const [countRows, assignmentRows] = sectionIds.length
      ? await Promise.all([
          db
            .select({ classSectionId: students.classSectionId, n: count() })
            .from(students)
            .where(and(inArray(students.classSectionId, sectionIds), eq(students.status, 'active')))
            .groupBy(students.classSectionId),
          db
            .select({
              id: teachingAssignments.id,
              classSectionId: teachingAssignments.classSectionId,
              subjectId: teachingAssignments.subjectId,
              teacherId: teachingAssignments.teacherId,
              teacherName: users.fullName,
            })
            .from(teachingAssignments)
            .innerJoin(users, eq(users.id, teachingAssignments.teacherId))
            .where(
              and(eq(teachingAssignments.schoolId, school.id), inArray(teachingAssignments.classSectionId, sectionIds)),
            ),
        ])
      : [[], []];
    const countBy = new Map(countRows.map((c) => [c.classSectionId, c.n]));

    res.json({
      currentAcademicYearId: year?.id ?? null,
      academicYears: yearRows.map((y) => toYear(y, year?.id ?? null)),
      stages: stageRows.map((st) => ({
        ...toStage(st),
        gradeLevels: gradeRows
          .filter((g) => g.stageId === st.id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            sort: g.sort,
            classSections: sectionRows
              .filter((c) => c.gradeLevelId === g.id)
              .sort(byArabicName)
              .map((c) => ({
                id: c.id,
                name: c.name,
                academicYearId: c.academicYearId,
                studentCount: countBy.get(c.id) ?? 0,
              })),
          })),
      })),
      subjects: subjectRows.map(toSubject),
      assignments: assignmentRows,
    });
  });

  // ───────────── Academic years ─────────────

  r.post('/academic-years', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(yearCreate, req.body);
    const row = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: academicYears.id, name: academicYears.name })
        .from(academicYears)
        .where(eq(academicYears.schoolId, school.id));
      if (existing.some((y) => y.name === body.name)) throw conflict('يوجد عام دراسي بهذا الاسم');
      // The school's first year becomes the current one.
      const isCurrent = body.isCurrent === true || existing.length === 0;
      if (isCurrent) {
        await tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.schoolId, school.id));
      }
      const [created] = await tx
        .insert(academicYears)
        .values({ schoolId: school.id, name: body.name, startsOn: body.startsOn, endsOn: body.endsOn, isCurrent })
        .returning();
      return created;
    });
    res.status(201).json(toYear(row));
  });

  r.patch('/academic-years/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(yearPatch, req.body);
    const existing = await findYear(db, school.id, id);
    const startsOn = body.startsOn ?? existing.startsOn;
    const endsOn = body.endsOn ?? existing.endsOn;
    if (startsOn >= endsOn) throw badRequest('بيانات غير صالحة', [{ path: 'endsOn', message: ENDS_AFTER_START }]);
    if (body.isCurrent === false && existing.isCurrent) {
      throw badRequest('لا يمكن إلغاء العام الحالي، اختر عاماً آخر ليكون العام الحالي');
    }
    if (body.name && body.name !== existing.name) {
      const [dup] = await db
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(and(eq(academicYears.schoolId, school.id), eq(academicYears.name, body.name), ne(academicYears.id, id)));
      if (dup) throw conflict('يوجد عام دراسي بهذا الاسم');
    }
    const row = await db.transaction(async (tx) => {
      if (body.isCurrent === true) {
        await tx
          .update(academicYears)
          .set({ isCurrent: false })
          .where(and(eq(academicYears.schoolId, school.id), ne(academicYears.id, id)));
      }
      const [updated] = await tx
        .update(academicYears)
        .set({ name: body.name, startsOn, endsOn, isCurrent: body.isCurrent })
        .where(eq(academicYears.id, id))
        .returning();
      return updated;
    });
    res.json(toYear(row));
  });

  r.delete('/academic-years/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const year = await findYear(db, school.id, id);
    await assertNotInUse(
      [
        db.select({ id: classSections.id }).from(classSections).where(eq(classSections.academicYearId, id)).limit(1),
        db.select({ id: examPeriods.id }).from(examPeriods).where(eq(examPeriods.academicYearId, id)).limit(1),
        db.select({ id: feePlans.id }).from(feePlans).where(eq(feePlans.academicYearId, id)).limit(1),
      ],
      'لا يمكن حذف العام الدراسي لارتباطه بفصول أو امتحانات أو رسوم دراسية',
    );
    await db.transaction(async (tx) => {
      await tx.delete(academicYears).where(eq(academicYears.id, id));
      if (year.isCurrent) {
        // Keep exactly one current year: the most recent remaining one.
        const [next] = await tx
          .select({ id: academicYears.id })
          .from(academicYears)
          .where(eq(academicYears.schoolId, school.id))
          .orderBy(desc(academicYears.startsOn))
          .limit(1);
        if (next) await tx.update(academicYears).set({ isCurrent: true }).where(eq(academicYears.id, next.id));
      }
    });
    res.json({ ok: true });
  });

  // ───────────── Stages ─────────────

  r.post('/stages', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(stageCreate, req.body);
    const [dup] = await db
      .select({ id: stages.id })
      .from(stages)
      .where(and(eq(stages.schoolId, school.id), eq(stages.name, body.name)));
    if (dup) throw conflict('توجد مرحلة بهذا الاسم');
    let sort = body.sort;
    if (sort === undefined) {
      const [{ top }] = await db
        .select({ top: max(stages.sort) })
        .from(stages)
        .where(eq(stages.schoolId, school.id));
      sort = (top ?? 0) + 1;
    }
    const [row] = await db.insert(stages).values({ schoolId: school.id, name: body.name, sort }).returning();
    res.status(201).json(toStage(row));
  });

  r.patch('/stages/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(stagePatch, req.body);
    await findStage(db, school.id, id);
    if (body.name) {
      const [dup] = await db
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.schoolId, school.id), eq(stages.name, body.name), ne(stages.id, id)));
      if (dup) throw conflict('توجد مرحلة بهذا الاسم');
    }
    const [row] = await db
      .update(stages)
      .set({ name: body.name, sort: body.sort })
      .where(eq(stages.id, id))
      .returning();
    res.json(toStage(row));
  });

  r.delete('/stages/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    await findStage(db, school.id, id);
    await assertNotInUse(
      [db.select({ id: gradeLevels.id }).from(gradeLevels).where(eq(gradeLevels.stageId, id)).limit(1)],
      'لا يمكن حذف المرحلة لوجود صفوف دراسية فيها',
    );
    await db.delete(stages).where(eq(stages.id, id));
    res.json({ ok: true });
  });

  // ───────────── Grade levels ─────────────

  const assertGradeNameFree = async (schoolId: string, stageId: string, name: string, exceptId?: string) => {
    const [dup] = await db
      .select({ id: gradeLevels.id })
      .from(gradeLevels)
      .where(
        and(
          eq(gradeLevels.schoolId, schoolId),
          eq(gradeLevels.stageId, stageId),
          eq(gradeLevels.name, name),
          exceptId ? ne(gradeLevels.id, exceptId) : undefined,
        ),
      );
    if (dup) throw conflict('يوجد صف بهذا الاسم في هذه المرحلة');
  };

  r.post('/grade-levels', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(gradeCreate, req.body);
    await findStage(db, school.id, body.stageId);
    await assertGradeNameFree(school.id, body.stageId, body.name);
    let sort = body.sort;
    if (sort === undefined) {
      const [{ top }] = await db
        .select({ top: max(gradeLevels.sort) })
        .from(gradeLevels)
        .where(eq(gradeLevels.stageId, body.stageId));
      sort = (top ?? 0) + 1;
    }
    const [row] = await db
      .insert(gradeLevels)
      .values({ schoolId: school.id, stageId: body.stageId, name: body.name, sort })
      .returning();
    res.status(201).json(toGrade(row));
  });

  r.patch('/grade-levels/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(gradePatch, req.body);
    const existing = await findGrade(db, school.id, id);
    if (body.stageId) await findStage(db, school.id, body.stageId);
    if (body.name || body.stageId) {
      await assertGradeNameFree(school.id, body.stageId ?? existing.stageId, body.name ?? existing.name, id);
    }
    const [row] = await db
      .update(gradeLevels)
      .set({ stageId: body.stageId, name: body.name, sort: body.sort })
      .where(eq(gradeLevels.id, id))
      .returning();
    res.json(toGrade(row));
  });

  r.delete('/grade-levels/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    await findGrade(db, school.id, id);
    await assertNotInUse(
      [
        db.select({ id: classSections.id }).from(classSections).where(eq(classSections.gradeLevelId, id)).limit(1),
        db.select({ id: students.id }).from(students).where(eq(students.gradeLevelId, id)).limit(1),
        db.select({ id: examPeriods.id }).from(examPeriods).where(eq(examPeriods.gradeLevelId, id)).limit(1),
        db.select({ id: feePlans.id }).from(feePlans).where(eq(feePlans.gradeLevelId, id)).limit(1),
      ],
      'لا يمكن حذف الصف لارتباطه بفصول أو طلاب أو امتحانات أو رسوم دراسية',
    );
    await db.delete(gradeLevels).where(eq(gradeLevels.id, id));
    res.json({ ok: true });
  });

  // ───────────── Class sections ─────────────

  const assertSectionNameFree = async (
    academicYearId: string,
    gradeLevelId: string,
    name: string,
    exceptId?: string,
  ) => {
    const [dup] = await db
      .select({ id: classSections.id })
      .from(classSections)
      .where(
        and(
          eq(classSections.academicYearId, academicYearId),
          eq(classSections.gradeLevelId, gradeLevelId),
          eq(classSections.name, name),
          exceptId ? ne(classSections.id, exceptId) : undefined,
        ),
      );
    if (dup) throw conflict('يوجد فصل بهذا الاسم في هذا الصف');
  };

  r.post('/class-sections', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(sectionCreate, req.body);
    await findGrade(db, school.id, body.gradeLevelId);
    const year = body.academicYearId
      ? await findYear(db, school.id, body.academicYearId)
      : await currentAcademicYear(db, school.id);
    if (!year) throw badRequest('أضف العام الدراسي أولاً');
    await assertSectionNameFree(year.id, body.gradeLevelId, body.name);
    const [row] = await db
      .insert(classSections)
      .values({ schoolId: school.id, academicYearId: year.id, gradeLevelId: body.gradeLevelId, name: body.name })
      .returning();
    res.status(201).json({
      id: row.id,
      name: row.name,
      gradeLevelId: row.gradeLevelId,
      academicYearId: row.academicYearId,
      studentCount: 0,
    });
  });

  r.patch('/class-sections/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(sectionPatch, req.body);
    const existing = await assertClassInSchool(db, school.id, id);
    await assertSectionNameFree(existing.academicYearId, existing.gradeLevelId, body.name, id);
    const [row] = await db.update(classSections).set({ name: body.name }).where(eq(classSections.id, id)).returning();
    const [{ n }] = await db
      .select({ n: count() })
      .from(students)
      .where(and(eq(students.classSectionId, id), eq(students.status, 'active')));
    res.json({
      id: row.id,
      name: row.name,
      gradeLevelId: row.gradeLevelId,
      academicYearId: row.academicYearId,
      studentCount: n,
    });
  });

  r.delete('/class-sections/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    await assertClassInSchool(db, school.id, id);
    await assertNotInUse(
      [
        db.select({ id: students.id }).from(students).where(eq(students.classSectionId, id)).limit(1),
        db.select({ id: lessons.id }).from(lessons).where(eq(lessons.classSectionId, id)).limit(1),
        db
          .select({ id: attendanceSessions.id })
          .from(attendanceSessions)
          .where(eq(attendanceSessions.classSectionId, id))
          .limit(1),
        db.select({ id: assessments.id }).from(assessments).where(eq(assessments.classSectionId, id)).limit(1),
      ],
      'لا يمكن حذف الفصل لوجود طلاب أو دروس أو غياب أو امتحانات مسجلة فيه',
    );
    // Teaching assignments and timetable slots are configuration and go with the class.
    await db.delete(classSections).where(eq(classSections.id, id));
    res.json({ ok: true });
  });

  // ───────────── Subjects ─────────────

  const assertSubjectNameFree = async (schoolId: string, name: string, exceptId?: string) => {
    const [dup] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(
        and(eq(subjects.schoolId, schoolId), eq(subjects.name, name), exceptId ? ne(subjects.id, exceptId) : undefined),
      );
    if (dup) throw conflict('توجد مادة بهذا الاسم');
  };

  r.post('/subjects', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(subjectCreate, req.body);
    await assertSubjectNameFree(school.id, body.name);
    let sort = body.sort;
    if (sort === undefined) {
      const [{ top }] = await db
        .select({ top: max(subjects.sort) })
        .from(subjects)
        .where(eq(subjects.schoolId, school.id));
      sort = (top ?? 0) + 1;
    }
    const [row] = await db.insert(subjects).values({ schoolId: school.id, name: body.name, sort }).returning();
    res.status(201).json(toSubject(row));
  });

  r.patch('/subjects/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(subjectPatch, req.body);
    await assertSubjectInSchool(db, school.id, id);
    if (body.name) await assertSubjectNameFree(school.id, body.name, id);
    const [row] = await db
      .update(subjects)
      .set({ name: body.name, sort: body.sort })
      .where(eq(subjects.id, id))
      .returning();
    res.json(toSubject(row));
  });

  r.delete('/subjects/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    await assertSubjectInSchool(db, school.id, id);
    await assertNotInUse(
      [
        db.select({ id: lessons.id }).from(lessons).where(eq(lessons.subjectId, id)).limit(1),
        db.select({ id: assessments.id }).from(assessments).where(eq(assessments.subjectId, id)).limit(1),
        db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.subjectId, id)).limit(1),
      ],
      'لا يمكن حذف المادة لوجود دروس أو امتحانات أو تقييمات مسجلة لها',
    );
    await db.delete(subjects).where(eq(subjects.id, id));
    res.json({ ok: true });
  });

  // ───────────── Teaching assignments ─────────────

  r.put('/assignments', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(assignmentBody, req.body);
    await assertClassInSchool(db, school.id, body.classSectionId);
    await assertSubjectInSchool(db, school.id, body.subjectId);

    if (body.teacherId === null) {
      await db
        .delete(teachingAssignments)
        .where(
          and(
            eq(teachingAssignments.classSectionId, body.classSectionId),
            eq(teachingAssignments.subjectId, body.subjectId),
          ),
        );
      res.json({
        id: null,
        classSectionId: body.classSectionId,
        subjectId: body.subjectId,
        teacherId: null,
        teacherName: null,
      });
      return;
    }

    const [teacher] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.userId, body.teacherId),
          eq(memberships.schoolId, school.id),
          inArray(memberships.role, ['teacher', 'supervisor']),
        ),
      )
      .limit(1);
    if (!teacher) throw badRequest('الأستاذ المختار ليس من أساتذة المدرسة');

    const [row] = await db
      .insert(teachingAssignments)
      .values({
        schoolId: school.id,
        classSectionId: body.classSectionId,
        subjectId: body.subjectId,
        teacherId: teacher.id,
      })
      .onConflictDoUpdate({
        target: [teachingAssignments.classSectionId, teachingAssignments.subjectId],
        set: { teacherId: teacher.id },
      })
      .returning();
    res.json({
      id: row.id,
      classSectionId: row.classSectionId,
      subjectId: row.subjectId,
      teacherId: row.teacherId,
      teacherName: teacher.fullName,
    });
  });

  return r;
}
