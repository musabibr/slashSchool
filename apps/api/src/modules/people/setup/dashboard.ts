import { Router } from 'express';
import { and, asc, count, countDistinct, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { computeFeeAccount, type CalendarKind, type Gender } from '@slash/shared';
import type { Db } from '../../../db/client';
import {
  absences,
  announcements,
  attendanceSessions,
  calendarEvents,
  classSections,
  feePlans,
  gradeLevels,
  memberships,
  payments,
  planInstallments,
  stages,
  studentFees,
  studentGuardians,
  students,
} from '../../../db/schema';
import { requireRole, schoolOf, schoolToday } from '../../../lib/context';
import { currentAcademicYear, listSchoolClasses } from '../../../lib/scope';

export interface Dashboard {
  counts: { students: number; supervisors: number; teachers: number; guardians: number };
  gender: Record<Gender, number>;
  byStage: Array<{ stageName: string; count: number }>;
  today: { date: string; classes: number; recorded: number; absent: number };
  upcomingEvents: Array<{ id: string; title: string; kind: CalendarKind; startsOn: string; endsOn: string }>;
  recentAnnouncements: Array<{ id: string; title: string; publishedAt: string }>;
  fees: { expected: number; collected: number; overdue: number };
}

const UPCOMING_EVENTS = 5;
const RECENT_ANNOUNCEMENTS = 3;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

const activeStudent = (schoolId: string) => and(eq(students.schoolId, schoolId), eq(students.status, 'active'));

async function staffCounts(db: Db, schoolId: string) {
  const rows = await db
    .select({ role: memberships.role, n: countDistinct(memberships.userId) })
    .from(memberships)
    .where(and(eq(memberships.schoolId, schoolId), inArray(memberships.role, ['teacher', 'supervisor'])))
    .groupBy(memberships.role);
  const by = new Map(rows.map((r) => [r.role, r.n]));
  return { supervisors: by.get('supervisor') ?? 0, teachers: by.get('teacher') ?? 0 };
}

/** Active students per stage, by their class's grade level (or the admitted level until placed). */
async function studentsByStage(db: Db, schoolId: string) {
  const gradeId = sql<string | null>`coalesce(${classSections.gradeLevelId}, ${students.gradeLevelId})`;
  const [perGrade, stageRows, gradeRows] = await Promise.all([
    db
      .select({ gradeLevelId: gradeId, n: count() })
      .from(students)
      .leftJoin(classSections, eq(classSections.id, students.classSectionId))
      .where(activeStudent(schoolId))
      .groupBy(gradeId),
    db
      .select({ id: stages.id, name: stages.name })
      .from(stages)
      .where(eq(stages.schoolId, schoolId))
      .orderBy(asc(stages.sort), asc(stages.name)),
    db
      .select({ id: gradeLevels.id, stageId: gradeLevels.stageId })
      .from(gradeLevels)
      .where(eq(gradeLevels.schoolId, schoolId)),
  ]);
  const stageOfGrade = new Map(gradeRows.map((g) => [g.id, g.stageId]));
  const perStage = new Map<string, number>();
  for (const row of perGrade) {
    const stageId = row.gradeLevelId ? stageOfGrade.get(row.gradeLevelId) : undefined;
    if (stageId) perStage.set(stageId, (perStage.get(stageId) ?? 0) + row.n);
  }
  return stageRows.map((st) => ({ stageName: st.name, count: perStage.get(st.id) ?? 0 }));
}

async function todayAttendance(db: Db, schoolId: string, date: string) {
  const classes = await listSchoolClasses(db, schoolId);
  if (!classes.length) return { date, classes: 0, recorded: 0, absent: 0 };
  const [row] = await db
    .select({ recorded: countDistinct(attendanceSessions.id), absent: count(absences.studentId) })
    .from(attendanceSessions)
    .leftJoin(absences, eq(absences.sessionId, attendanceSessions.id))
    .where(
      and(
        eq(attendanceSessions.schoolId, schoolId),
        eq(attendanceSessions.date, date),
        inArray(
          attendanceSessions.classSectionId,
          classes.map((c) => c.id),
        ),
      ),
    );
  return { date, classes: classes.length, recorded: row?.recorded ?? 0, absent: row?.absent ?? 0 };
}

/** Current-year fees of active students: expected (net of discounts), collected, and overdue. */
async function feeTotals(db: Db, schoolId: string, today: string) {
  const year = await currentAcademicYear(db, schoolId);
  const totals = { expected: 0, collected: 0, overdue: 0 };
  if (!year) return totals;
  const accounts = await db
    .select({ id: studentFees.id, feePlanId: studentFees.feePlanId, discount: studentFees.discount })
    .from(studentFees)
    .innerJoin(feePlans, eq(feePlans.id, studentFees.feePlanId))
    .innerJoin(students, eq(students.id, studentFees.studentId))
    .where(and(eq(studentFees.schoolId, schoolId), eq(feePlans.academicYearId, year.id), activeStudent(schoolId)));
  if (!accounts.length) return totals;
  const planIds = [...new Set(accounts.map((a) => a.feePlanId))];
  const [installments, paid] = await Promise.all([
    db.select().from(planInstallments).where(inArray(planInstallments.feePlanId, planIds)),
    db
      .select({ studentFeeId: payments.studentFeeId, amount: payments.amount, paidAt: payments.paidAt })
      .from(payments)
      .where(
        and(
          eq(payments.schoolId, schoolId),
          inArray(
            payments.studentFeeId,
            accounts.map((a) => a.id),
          ),
        ),
      ),
  ]);
  const installmentsBy = groupBy(installments, (i) => i.feePlanId);
  const paymentsBy = groupBy(paid, (p) => p.studentFeeId);
  for (const a of accounts) {
    const account = computeFeeAccount({
      installments: installmentsBy.get(a.feePlanId) ?? [],
      discount: a.discount,
      payments: paymentsBy.get(a.id) ?? [],
      today,
    });
    totals.expected += account.net;
    totals.collected += account.paid;
    totals.overdue += account.overdue;
  }
  return totals;
}

/** Director home (D1): GET /api/schools/:schoolId/dashboard */
export function dashboardRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin'));

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const today = schoolToday(school);
    const [studentCount, staff, guardianCount, genderRows, byStage, attendance, events, news, fees] =
      await Promise.all([
        db.select({ n: count() }).from(students).where(activeStudent(school.id)),
        staffCounts(db, school.id),
        db
          .select({ n: countDistinct(studentGuardians.userId) })
          .from(studentGuardians)
          .innerJoin(students, eq(students.id, studentGuardians.studentId))
          .where(and(eq(studentGuardians.schoolId, school.id), activeStudent(school.id))),
        db
          .select({ gender: students.gender, n: count() })
          .from(students)
          .where(activeStudent(school.id))
          .groupBy(students.gender),
        studentsByStage(db, school.id),
        todayAttendance(db, school.id, today),
        db
          .select({
            id: calendarEvents.id,
            title: calendarEvents.title,
            kind: calendarEvents.kind,
            startsOn: calendarEvents.startsOn,
            endsOn: calendarEvents.endsOn,
          })
          .from(calendarEvents)
          .where(and(eq(calendarEvents.schoolId, school.id), gte(calendarEvents.endsOn, today)))
          .orderBy(asc(calendarEvents.startsOn), asc(calendarEvents.title))
          .limit(UPCOMING_EVENTS),
        db
          .select({ id: announcements.id, title: announcements.title, publishedAt: announcements.publishedAt })
          .from(announcements)
          .where(and(eq(announcements.schoolId, school.id), lte(announcements.publishedAt, new Date())))
          .orderBy(desc(announcements.publishedAt))
          .limit(RECENT_ANNOUNCEMENTS),
        feeTotals(db, school.id, today),
      ]);

    const gender = new Map(genderRows.map((g) => [g.gender, g.n]));
    const body: Dashboard = {
      counts: {
        students: studentCount[0]?.n ?? 0,
        supervisors: staff.supervisors,
        teachers: staff.teachers,
        guardians: guardianCount[0]?.n ?? 0,
      },
      gender: { male: gender.get('male') ?? 0, female: gender.get('female') ?? 0 },
      byStage,
      today: attendance,
      upcomingEvents: events,
      recentAnnouncements: news.map((a) => ({ id: a.id, title: a.title, publishedAt: a.publishedAt.toISOString() })),
      fees,
    };
    res.json(body);
  });

  return r;
}
