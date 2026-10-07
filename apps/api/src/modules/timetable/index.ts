import { Router } from 'express';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_PERIODS_PER_DAY, periodLabel, WEEKDAY_LABELS } from '@slash/shared';
import type { Db } from '../../db/client';
import { classSections, gradeLevels, memberships, subjects, timetableSlots, users } from '../../db/schema';
import { requireRole, schoolOf, userOf } from '../../lib/context';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { assertCanAccessClass, assertClassInSchool, currentAcademicYear } from '../../lib/scope';
import { parse, zId } from '../../lib/validate';
import type { ModuleDeps, ModuleRouters } from '../types';

/** Weekday from a path/query string: '0' (Sunday) … '6' (Saturday). */
const zWeekday = z
  .string({ invalid_type_error: 'اليوم غير صالح' })
  .regex(/^[0-6]$/, { message: 'اليوم غير صالح' })
  .transform(Number);

const zPeriod = z
  .number({ required_error: 'رقم الحصة مطلوب', invalid_type_error: 'رقم الحصة غير صالح' })
  .int({ message: 'رقم الحصة غير صالح' })
  .min(1, { message: 'رقم الحصة غير صالح' })
  .max(MAX_PERIODS_PER_DAY, { message: `لا يمكن أن يتجاوز عدد الحصص ${MAX_PERIODS_PER_DAY}` });

const dayBody = z.object({
  slots: z
    .array(
      z.object({
        period: zPeriod,
        subjectId: zId,
        teacherId: zId.nullish().transform((v) => v ?? null),
      }),
      { required_error: 'قائمة الحصص مطلوبة' },
    )
    .max(MAX_PERIODS_PER_DAY, { message: `لا يمكن أن يتجاوز عدد الحصص ${MAX_PERIODS_PER_DAY}` })
    .superRefine((slots, ctx) => {
      const seen = new Set<number>();
      slots.forEach((s, i) => {
        if (seen.has(s.period)) ctx.addIssue({ code: 'custom', path: [i, 'period'], message: 'الحصة مكررة' });
        seen.add(s.period);
      });
    }),
});

export interface ClassSlot {
  id: string;
  weekday: number;
  period: number;
  subjectId: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
}

async function loadClassSlots(db: Db, classSectionId: string, weekday?: number): Promise<ClassSlot[]> {
  return db
    .select({
      id: timetableSlots.id,
      weekday: timetableSlots.weekday,
      period: timetableSlots.period,
      subjectId: timetableSlots.subjectId,
      subjectName: subjects.name,
      teacherId: timetableSlots.teacherId,
      teacherName: users.fullName,
    })
    .from(timetableSlots)
    .innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
    .leftJoin(users, eq(users.id, timetableSlots.teacherId))
    .where(
      and(
        eq(timetableSlots.classSectionId, classSectionId),
        weekday === undefined ? undefined : eq(timetableSlots.weekday, weekday),
      ),
    )
    .orderBy(asc(timetableSlots.weekday), asc(timetableSlots.period));
}

/** Days ordered from the school's week start (Sunday by default). */
const dayOrder = (weekday: number, weekStart: number) => (weekday - weekStart + 7) % 7;

/**
 * Weekly class timetables (S16 builder, T8 "جدول الحصص", admin timetables page):
 *   GET /timetable/mine?weekday          → the current user's own periods (any staff)
 *   GET /timetable/class/:classId        → a class's week (admins/supervisors; teachers of that class)
 *   PUT /timetable/class/:classId/:weekday {slots} → replace that day (admins/supervisors)
 */
function timetableRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/mine', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const { weekday } = parse(z.object({ weekday: zWeekday.optional() }), req.query);
    const year = await currentAcademicYear(db, school.id);
    if (!year) {
      res.json([]);
      return;
    }
    const rows = await db
      .select({
        weekday: timetableSlots.weekday,
        period: timetableSlots.period,
        classId: classSections.id,
        sectionName: classSections.name,
        gradeName: gradeLevels.name,
        subjectName: subjects.name,
      })
      .from(timetableSlots)
      .innerJoin(classSections, eq(classSections.id, timetableSlots.classSectionId))
      .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
      .innerJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
      .where(
        and(
          eq(timetableSlots.schoolId, school.id),
          eq(timetableSlots.teacherId, user.id),
          eq(classSections.academicYearId, year.id),
          weekday === undefined ? undefined : eq(timetableSlots.weekday, weekday),
        ),
      );
    const slots = rows
      .map((row) => ({
        weekday: row.weekday,
        period: row.period,
        classId: row.classId,
        classLabel: `${row.gradeName} - ${row.sectionName}`,
        subjectName: row.subjectName,
      }))
      .sort(
        (a, b) =>
          dayOrder(a.weekday, school.weekStart) - dayOrder(b.weekday, school.weekStart) ||
          a.period - b.period ||
          a.classLabel.localeCompare(b.classLabel, 'ar'),
      );
    res.json(slots);
  });

  r.get('/class/:classId', async (req, res) => {
    const classId = parse(zId, req.params.classId);
    const { weekday } = parse(z.object({ weekday: zWeekday.optional() }), req.query);
    await assertCanAccessClass(db, req, classId);
    res.json(await loadClassSlots(db, classId, weekday));
  });

  r.put('/class/:classId/:weekday', requireRole('admin', 'supervisor'), async (req, res) => {
    const school = schoolOf(req);
    const classId = parse(zId, req.params.classId);
    const weekday = parse(zWeekday, req.params.weekday);
    const { slots } = parse(dayBody, req.body);
    const cls = await assertClassInSchool(db, school.id, classId);

    const subjectIds = [...new Set(slots.map((s) => s.subjectId))];
    if (subjectIds.length) {
      const found = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.schoolId, school.id), inArray(subjects.id, subjectIds)));
      if (found.length !== subjectIds.length) throw notFound('المادة غير موجودة');
    }

    const teacherIds = [...new Set(slots.map((s) => s.teacherId).filter((id): id is string => !!id))];
    const teacherNames = new Map<string, string>();
    if (teacherIds.length) {
      const found = await db
        .selectDistinct({ id: users.id, fullName: users.fullName })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.schoolId, school.id),
            inArray(memberships.role, ['teacher', 'supervisor']),
            inArray(memberships.userId, teacherIds),
          ),
        );
      for (const t of found) teacherNames.set(t.id, t.fullName);
      if (teacherNames.size !== teacherIds.length) throw badRequest('الأستاذ المختار ليس من أساتذة المدرسة');

      // A teacher cannot be in two classes (of the same academic year) at the same period.
      const busy = await db
        .select({
          teacherId: timetableSlots.teacherId,
          period: timetableSlots.period,
          sectionName: classSections.name,
          gradeName: gradeLevels.name,
        })
        .from(timetableSlots)
        .innerJoin(classSections, eq(classSections.id, timetableSlots.classSectionId))
        .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
        .where(
          and(
            eq(timetableSlots.schoolId, school.id),
            eq(timetableSlots.weekday, weekday),
            ne(timetableSlots.classSectionId, classId),
            eq(classSections.academicYearId, cls.academicYearId),
            inArray(timetableSlots.teacherId, teacherIds),
          ),
        );
      for (const slot of slots) {
        const clash = busy.find((b) => b.teacherId === slot.teacherId && b.period === slot.period);
        if (clash) {
          throw conflict(
            `تعارض في الجدول: ${teacherNames.get(clash.teacherId ?? '')} لديه ${periodLabel(slot.period)} ` +
              `يوم ${WEEKDAY_LABELS[weekday]} في ${clash.gradeName} - ${clash.sectionName}`,
          );
        }
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(timetableSlots)
        .where(and(eq(timetableSlots.classSectionId, classId), eq(timetableSlots.weekday, weekday)));
      if (slots.length) {
        await tx.insert(timetableSlots).values(
          slots.map((s) => ({
            schoolId: school.id,
            classSectionId: classId,
            weekday,
            period: s.period,
            subjectId: s.subjectId,
            teacherId: s.teacherId,
          })),
        );
      }
    });

    res.json(await loadClassSlots(db, classId, weekday));
  });

  return r;
}

export function register({ school }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/timetable', timetableRouter(db));
}
