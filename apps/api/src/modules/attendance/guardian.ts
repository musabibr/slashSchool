import { Router } from 'express';
import { and, desc, eq, gte } from 'drizzle-orm';
import { monthBounds, weekdayOf } from '@slash/shared';
import type { Db } from '../../db/client';
import { absences, attendanceSessions } from '../../db/schema';
import { schoolOf, schoolToday, studentOf } from '../../lib/context';
import { markSeenIfGuardian } from '../../lib/cursors';
import { currentAcademicYear } from '../../lib/scope';

/**
 * P8 — a student's absences: /api/students/:studentId/attendance (guardians and the school's staff).
 *   thisMonth = absences in the current calendar month
 *   total     = absences in the current academic year (also the `days` list, newest first)
 */
export function guardianRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const student = studentOf(req);
    const today = schoolToday(schoolOf(req));
    const month = monthBounds(today);
    const year = await currentAcademicYear(db, student.schoolId);
    const yearStart = year?.startsOn ?? null;
    const since = yearStart && yearStart < month.from ? yearStart : month.from;

    const rows = await db
      .select({ date: attendanceSessions.date, note: absences.note })
      .from(absences)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, absences.sessionId))
      .where(
        and(
          eq(absences.studentId, student.id),
          eq(attendanceSessions.schoolId, student.schoolId),
          yearStart ? gte(attendanceSessions.date, since) : undefined,
        ),
      )
      .orderBy(desc(attendanceSessions.date));

    const days = rows.filter((a) => !yearStart || a.date >= yearStart);
    await markSeenIfGuardian(db, req, 'attendance');
    res.json({
      thisMonth: rows.filter((a) => a.date >= month.from && a.date <= month.to).length,
      total: days.length,
      days: days.map((a) => ({ date: a.date, weekday: weekdayOf(a.date), note: a.note })),
    });
  });

  return r;
}
