import { and, count, eq, gt, sql, type SQLWrapper } from 'drizzle-orm';
import { BADGE_MODULES, type BadgeModule } from '@slash/shared';
import type { Db } from '../../db/client';
import {
  absences,
  announcements,
  behaviorIncidents,
  calendarEvents,
  evaluations,
  lessons,
  payments,
  schools,
  studentFees,
} from '../../db/schema';
import { cursorKey, getCursorMap } from '../../lib/cursors';
import { countNewExams, countNewResults } from '../assessment/badges';
import { announcementsFor, type StudentTarget } from './audience';

export type Badges = Record<BadgeModule, number>;

export const zeroBadges = (): Badges => Object.fromEntries(BADGE_MODULES.map((m) => [m, 0])) as Badges;

/** A scalar `(select count(*) …)` sub-select as a numeric column. */
const countOf = (query: SQLWrapper) => sql<number>`${query}`.mapWith(Number);
const zero = () => sql<number>`0`.mapWith(Number);

/**
 * Unread badge counts for the guardian home (P3). Each module counts items newer than the guardian's
 * "last seen" cursor for it, or — never opened — newer than the moment the guardian was linked to the student.
 * Seven counts come from a single query of scalar sub-selects; exams and results reuse the assessment
 * module's counters.
 */
export async function countBadges(db: Db, userId: string, target: StudentTarget, linkedAt: Date): Promise<Badges> {
  const cursors = await getCursorMap(db, userId, target.studentId);
  const since = (module: BadgeModule) => cursors.get(cursorKey(module)) ?? linkedAt;
  const classId = target.classSectionId;
  const { schoolId, studentId } = target;

  const classLessons = (module: 'lessons' | 'homework') =>
    classId
      ? countOf(
          db
            .select({ n: count() })
            .from(lessons)
            .where(
              and(
                eq(lessons.schoolId, schoolId),
                eq(lessons.classSectionId, classId),
                module === 'homework' ? eq(lessons.hasHomework, true) : undefined,
                gt(lessons.createdAt, since(module)),
              ),
            ),
        )
      : zero();

  const student = { id: studentId, schoolId, classSectionId: classId };
  const [[row], exams, results] = await Promise.all([
    db
      .select({
        lessons: classLessons('lessons'),
        homework: classLessons('homework'),
        attendance: countOf(
          db
            .select({ n: count() })
            .from(absences)
            .where(and(eq(absences.studentId, studentId), gt(absences.createdAt, since('attendance')))),
        ),
        fees: countOf(
          db
            .select({ n: count() })
            .from(payments)
            .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
            .where(
              and(
                eq(studentFees.studentId, studentId),
                eq(payments.schoolId, schoolId),
                gt(payments.createdAt, since('fees')),
              ),
            ),
        ),
        incidents: countOf(
          db
            .select({ n: count() })
            .from(behaviorIncidents)
            .where(and(eq(behaviorIncidents.studentId, studentId), gt(behaviorIncidents.createdAt, since('behavior')))),
        ),
        evaluations: countOf(
          db
            .select({ n: count() })
            .from(evaluations)
            .where(and(eq(evaluations.studentId, studentId), gt(evaluations.createdAt, since('behavior')))),
        ),
        calendar: countOf(
          db
            .select({ n: count() })
            .from(calendarEvents)
            .where(and(eq(calendarEvents.schoolId, schoolId), gt(calendarEvents.createdAt, since('calendar')))),
        ),
        announcements: countOf(
          db
            .select({ n: count() })
            .from(announcements)
            .where(and(announcementsFor(target), gt(announcements.publishedAt, since('announcements')))),
        ),
      })
      .from(schools)
      .where(eq(schools.id, schoolId)),
    // Exams and results follow the assessment module's own definitions (P10–P13).
    countNewExams(db, student, since('exams')),
    countNewResults(db, student, since('results')),
  ]);

  if (!row) return zeroBadges();
  return {
    lessons: row.lessons,
    homework: row.homework,
    attendance: row.attendance,
    fees: row.fees,
    exams,
    results,
    behavior: row.incidents + row.evaluations,
    calendar: row.calendar,
    announcements: row.announcements,
  };
}
