import { Router } from 'express';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { absences, attendanceSessions, students, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { requireRole, schoolOf, schoolToday, userOf } from '../../lib/context';
import { badRequest } from '../../lib/errors';
import {
  assertClassInSchool,
  assertStudentsInClass,
  classStudents,
  currentAcademicYear,
  listSchoolClasses,
} from '../../lib/scope';
import { parse, zDate, zId, zOptDate } from '../../lib/validate';
import { loadClassAttendance, sessionAbsences } from './service';

const MAX_SESSIONS = 400;

const classDateParams = z.object({ classId: zId, date: zDate });

const sessionsQuery = z
  .object({ classId: zId, from: zOptDate, to: zOptDate })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'تاريخ البداية بعد تاريخ النهاية', path: ['to'] });

const saveBody = z.object({
  absentStudentIds: z
    .array(zId, { required_error: 'قائمة الغائبين مطلوبة' })
    .max(500, { message: 'عدد كبير من الطلاب' }),
  notes: z.record(zId, z.string().trim().max(500, { message: 'الملاحظة أطول من المسموح' })).optional(),
});

/**
 * Staff attendance (S8–S10, admin "تسجيل الغياب"): /api/schools/:schoolId/attendance.
 * Absence is recorded by supervisors and admins only.
 */
export function staffRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin', 'supervisor'));

  /** Today's overview: which classes of the current year have attendance recorded. */
  r.get('/today', async (req, res) => {
    const school = schoolOf(req);
    const today = schoolToday(school);
    const classes = await listSchoolClasses(db, school.id);
    if (!classes.length) {
      res.json({ date: today, classes: [] });
      return;
    }
    const ids = classes.map((c) => c.id);
    const [studentCounts, sessions] = await Promise.all([
      db
        .select({ classSectionId: students.classSectionId, n: count() })
        .from(students)
        .where(and(inArray(students.classSectionId, ids), eq(students.status, 'active')))
        .groupBy(students.classSectionId),
      db
        .select({ classSectionId: attendanceSessions.classSectionId, absentCount: count(absences.studentId) })
        .from(attendanceSessions)
        .leftJoin(absences, eq(absences.sessionId, attendanceSessions.id))
        .where(
          and(
            eq(attendanceSessions.schoolId, school.id),
            eq(attendanceSessions.date, today),
            inArray(attendanceSessions.classSectionId, ids),
          ),
        )
        .groupBy(attendanceSessions.classSectionId),
    ]);
    const countBy = new Map(studentCounts.map((c) => [c.classSectionId, c.n]));
    const sessionBy = new Map(sessions.map((s) => [s.classSectionId, s.absentCount]));
    res.json({
      date: today,
      classes: classes.map((c) => ({
        classId: c.id,
        label: c.label,
        studentCount: countBy.get(c.id) ?? 0,
        recorded: sessionBy.has(c.id),
        absentCount: sessionBy.get(c.id) ?? 0,
      })),
    });
  });

  /** Recorded sessions of one class, newest first (S10 "تعديل الغياب السابق"). */
  r.get('/sessions', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(sessionsQuery, req.query);
    await assertClassInSchool(db, school.id, q.classId);
    const rows = await db
      .select({
        date: attendanceSessions.date,
        updatedAt: attendanceSessions.updatedAt,
        recordedByName: users.fullName,
        absentCount: count(absences.studentId),
      })
      .from(attendanceSessions)
      .leftJoin(absences, eq(absences.sessionId, attendanceSessions.id))
      .leftJoin(users, eq(users.id, attendanceSessions.recordedBy))
      .where(
        and(
          eq(attendanceSessions.schoolId, school.id),
          eq(attendanceSessions.classSectionId, q.classId),
          q.from ? gte(attendanceSessions.date, q.from) : undefined,
          q.to ? lte(attendanceSessions.date, q.to) : undefined,
        ),
      )
      .groupBy(attendanceSessions.id, users.id)
      .orderBy(desc(attendanceSessions.date))
      .limit(MAX_SESSIONS);
    res.json(
      rows.map((s) => ({
        date: s.date,
        absentCount: s.absentCount,
        recordedByName: s.recordedByName ?? null,
        updatedAt: s.updatedAt.toISOString(),
      })),
    );
  });

  /** The checklist for one class on one day (recorded or not). */
  r.get('/:classId/:date', async (req, res) => {
    const school = schoolOf(req);
    const { classId, date } = parse(classDateParams, req.params);
    await assertClassInSchool(db, school.id, classId);
    res.json(await loadClassAttendance(db, classId, date));
  });

  /**
   * Idempotent upsert of the class+date session: the absent set becomes exactly `absentStudentIds`
   * (for the class's active students). An empty list records "everyone present".
   */
  r.put('/:classId/:date', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const { classId, date } = parse(classDateParams, req.params);
    const body = parse(saveBody, req.body);
    const cls = await assertClassInSchool(db, school.id, classId);

    if (date > schoolToday(school)) throw badRequest('لا يمكن تسجيل الغياب لتاريخ لاحق لليوم');
    const year = await currentAcademicYear(db, school.id);
    if (!year) throw badRequest('لم يتم إعداد العام الدراسي الحالي');
    if (cls.academicYearId !== year.id) throw badRequest('الفصل لا ينتمي للعام الدراسي الحالي');
    if (date < year.startsOn) throw badRequest('التاريخ قبل بداية العام الدراسي الحالي');

    const absentIds = [...new Set(body.absentStudentIds)];
    await assertStudentsInClass(db, classId, absentIds);
    const roster = new Set((await classStudents(db, classId)).map((s) => s.id));
    if (absentIds.some((id) => !roster.has(id))) throw badRequest('لا يمكن تسجيل غياب طالب غير منتظم');
    const wanted = new Map(absentIds.map((id) => [id, body.notes?.[id] || null]));

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: attendanceSessions.id })
        .from(attendanceSessions)
        .where(and(eq(attendanceSessions.classSectionId, classId), eq(attendanceSessions.date, date)));
      const previous = existing ? await sessionAbsences(tx, existing.id) : [];
      const prevNotes = new Map(previous.map((a) => [a.studentId, a.note]));

      // Only the class's current active roster is managed here; absences of students who have
      // since left the class stay on record.
      const toDelete = previous
        .filter((a) => roster.has(a.studentId) && !wanted.has(a.studentId))
        .map((a) => a.studentId);
      const toInsert = absentIds.filter((id) => !prevNotes.has(id));
      const toUpdate = absentIds.filter((id) => prevNotes.has(id) && (prevNotes.get(id) ?? null) !== wanted.get(id));
      if (existing && !toDelete.length && !toInsert.length && !toUpdate.length) return; // nothing changed

      const [session] = await tx
        .insert(attendanceSessions)
        .values({ schoolId: school.id, classSectionId: classId, date, recordedBy: user.id })
        .onConflictDoUpdate({
          target: [attendanceSessions.classSectionId, attendanceSessions.date],
          set: { recordedBy: user.id, updatedAt: sql`now()` },
        })
        .returning({ id: attendanceSessions.id });

      if (toDelete.length) {
        await tx.delete(absences).where(and(eq(absences.sessionId, session.id), inArray(absences.studentId, toDelete)));
      }
      if (toInsert.length) {
        await tx
          .insert(absences)
          .values(
            toInsert.map((studentId) => ({ sessionId: session.id, studentId, note: wanted.get(studentId) ?? null })),
          )
          // A concurrent retry of the same save may have inserted it already.
          .onConflictDoNothing();
      }
      for (const studentId of toUpdate) {
        await tx
          .update(absences)
          .set({ note: wanted.get(studentId) ?? null })
          .where(and(eq(absences.sessionId, session.id), eq(absences.studentId, studentId)));
      }

      const after = [...previous.map((a) => a.studentId).filter((id) => !toDelete.includes(id)), ...toInsert];
      await audit(tx, {
        schoolId: school.id,
        actorId: user.id,
        entity: 'attendance_session',
        entityId: session.id,
        action: existing ? 'update' : 'create',
        before: existing ? { date, absentStudentIds: previous.map((a) => a.studentId).sort() } : null,
        after: { date, absentStudentIds: after.sort() },
      });
    });

    res.json(await loadClassAttendance(db, classId, date));
  });

  return r;
}
