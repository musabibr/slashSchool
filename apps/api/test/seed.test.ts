import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { addDays, computeFeeAccount, todayIn, weekdayOf } from '@slash/shared';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { connectPglite, type Db, type DbHandle } from '../src/db/client';
import * as s from '../src/db/schema';
import { buildDemoRows, seedDemo } from '../src/seed/demo';
import { DEMO_ACCOUNTS, DEMO_ACTIVATION, DEMO_LINK_CODE, DEMO_PIN, DEMO_SCHOOLS } from '../src/seed/demo-accounts';
import { resetDatabase } from '../src/seed/reset';

/** A Wednesday in the 2025/2026 academic year. */
const TODAY = '2025-11-12';
const ACCOUNT = Object.fromEntries(DEMO_ACCOUNTS.map((a) => [a.role, a])) as Record<
  (typeof DEMO_ACCOUNTS)[number]['role'],
  (typeof DEMO_ACCOUNTS)[number]
>;

let handle: DbHandle;
let db: Db;
let app: Express;
let seedMs = 0;

beforeAll(async () => {
  handle = await connectPglite(null);
  await handle.migrate();
  db = handle.db;
  const started = performance.now();
  await seedDemo(db, { today: TODAY });
  seedMs = performance.now() - started;
  const config: Config = { ...loadConfig({ NODE_ENV: 'test' }), webDistDir: '/nonexistent', demoMode: true };
  app = createApp({ db, config });
});
afterAll(() => handle.close());

async function login(phone: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, pin: DEMO_PIN });
  expect(res.status, `login ${phone}`).toBe(200);
  return agent;
}

async function count(table: Parameters<Db['$count']>[0], where?: SQL): Promise<number> {
  return db.$count(table, where);
}

async function rawRows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

async function schoolByCode(code: string) {
  const [school] = await db.select().from(s.schools).where(eq(s.schools.code, code));
  return school;
}

/** One of the demo guardian's children, by first name. */
async function child(firstName: 'مصعب' | 'إسماعيل' | 'محمد') {
  const [row] = await db
    .select({ student: s.students })
    .from(s.studentGuardians)
    .innerJoin(s.users, eq(s.users.id, s.studentGuardians.userId))
    .innerJoin(s.students, eq(s.students.id, s.studentGuardians.studentId))
    .where(and(eq(s.users.phone, ACCOUNT.guardian.phone), eq(s.students.firstName, firstName)));
  return row.student;
}

async function feeAccount(studentId: string, today: string) {
  const [fee] = await db.select().from(s.studentFees).where(eq(s.studentFees.studentId, studentId));
  const installments = await db
    .select()
    .from(s.planInstallments)
    .where(eq(s.planInstallments.feePlanId, fee.feePlanId));
  const payments = await db.select().from(s.payments).where(eq(s.payments.studentFeeId, fee.id));
  return computeFeeAccount({ installments, discount: fee.discount, payments, today });
}

async function absenceDates(studentId: string) {
  const rows = await db
    .select({ date: s.attendanceSessions.date })
    .from(s.absences)
    .innerJoin(s.attendanceSessions, eq(s.attendanceSessions.id, s.absences.sessionId))
    .where(eq(s.absences.studentId, studentId));
  return rows.map((r) => r.date);
}

describe('demo logins', () => {
  it('seeds quickly', () => {
    expect(seedMs).toBeLessThan(15_000);
  });

  it('every demo account logs in with the demo PIN', async () => {
    for (const account of DEMO_ACCOUNTS) await login(account.phone);
  });

  it('the guardian sees three children across both schools, with their classes', async () => {
    const agent = await login(ACCOUNT.guardian.phone);
    const res = await agent.get('/api/me');
    expect(res.status).toBe(200);
    const children = res.body.children as Array<{ fullName: string; classLabel: string; school: { id: string } }>;
    expect(children).toHaveLength(3);
    expect(new Set(children.map((c) => c.school.id)).size).toBe(2);
    expect(Object.fromEntries(children.map((c) => [c.fullName, c.classLabel]))).toEqual({
      'مصعب إبراهيم عبدالله': 'الصف الخامس - ب',
      'إسماعيل إبراهيم عبدالله': 'الصف السادس - أ',
      'محمد إبراهيم عبدالله': 'الصف الأول الثانوي - أ',
    });
    expect(res.body.schools).toEqual([]);
  });

  it('the supervisor and the admin work in both schools; the teacher in the middle school only', async () => {
    const roles = async (phone: string) => {
      const res = await (await login(phone)).get('/api/me');
      return (res.body.schools as Array<{ code: string; roles: string[] }>)
        .map((x) => `${x.code}:${x.roles.join('+')}`)
        .sort();
    };
    const { middle, secondary } = DEMO_SCHOOLS;
    expect(await roles(ACCOUNT.supervisor.phone)).toEqual([
      `${middle.code}:supervisor`,
      `${secondary.code}:supervisor`,
    ]);
    expect(await roles(ACCOUNT.admin.phone)).toEqual([`${middle.code}:admin`, `${secondary.code}:admin`]);
    expect(await roles(ACCOUNT.teacher.phone)).toEqual([`${middle.code}:teacher`]);
  });

  it('the demo teacher teaches math in 5-أ and 5-ب and science in 6-أ', async () => {
    const school = await schoolByCode(DEMO_SCHOOLS.middle.code);
    const agent = await login(ACCOUNT.teacher.phone);
    const res = await agent.get(`/api/schools/${school.id}/lookups/scope`);
    expect(res.status).toBe(200);
    const scope = (res.body.classes as Array<{ label: string; subjects: Array<{ name: string }> }>).map(
      (c) => `${c.label}: ${c.subjects.map((x) => x.name).join('، ')}`,
    );
    expect(scope).toEqual(['الصف الخامس - أ: الرياضيات', 'الصف الخامس - ب: الرياضيات', 'الصف السادس - أ: العلوم']);
    const week = await agent.get(`/api/schools/${school.id}/timetable/mine`);
    expect(week.status).toBe(200);
    expect(week.body).toHaveLength(6 + 6 + 4);
  });

  it('the activation code previews the pending guardian and sets a PIN', async () => {
    const agent = request.agent(app);
    const preview = await agent.post('/api/auth/activate').send({ code: DEMO_ACTIVATION.code });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ fullName: DEMO_ACTIVATION.fullName, alreadyActive: false });
    const set = await agent.post('/api/auth/set-pin').send({ code: DEMO_ACTIVATION.code, pin: '4321' });
    expect(set.status).toBe(200);
    const me = await agent.get('/api/me');
    expect(me.body.children).toHaveLength(1);
    expect(me.body.children[0]).toMatchObject({
      classLabel: 'الصف الخامس - أ',
      school: { name: DEMO_SCHOOLS.middle.name },
    });
  });

  it('the link code adds a fourth child (a secondary-school student) to the demo guardian', async () => {
    const agent = await login(ACCOUNT.guardian.phone);
    const res = await agent.post('/api/me/children/link').send({ code: DEMO_LINK_CODE });
    expect(res.status).toBe(201);
    const me = await agent.get('/api/me');
    expect(me.body.children).toHaveLength(4);
    const linked = (me.body.children as Array<{ id: string; school: { name: string }; classLabel: string }>).find(
      (c) => c.id === res.body.studentId,
    );
    expect(linked).toMatchObject({
      school: { name: DEMO_SCHOOLS.secondary.name },
      classLabel: 'الصف الثاني الثانوي - أ',
    });
  });
});

describe('authorization on the demo data', () => {
  it("the demo guardian cannot open another family's child", async () => {
    const musab = await child('مصعب');
    const [other] = await db
      .select({ id: s.students.id })
      .from(s.students)
      .where(and(eq(s.students.classSectionId, musab.classSectionId ?? ''), sql`${s.students.id} <> ${musab.id}`))
      .limit(1);
    const agent = await login(ACCOUNT.guardian.phone);
    expect((await agent.get(`/api/students/${musab.id}/attendance`)).status).toBe(200);
    expect((await agent.get(`/api/students/${other.id}/attendance`)).status).toBe(403);
  });

  it('guardians cannot call staff routes; the teacher cannot open classes outside the assignment', async () => {
    const school = await schoolByCode(DEMO_SCHOOLS.middle.code);
    const guardian = await login(ACCOUNT.guardian.phone);
    expect((await guardian.get(`/api/schools/${school.id}/lookups/scope`)).status).toBe(403);
    const [grade7] = await db
      .select({ id: s.classSections.id })
      .from(s.classSections)
      .innerJoin(s.gradeLevels, eq(s.gradeLevels.id, s.classSections.gradeLevelId))
      .where(eq(s.gradeLevels.name, 'الصف السابع'));
    const teacher = await login(ACCOUNT.teacher.phone);
    expect((await teacher.get(`/api/schools/${school.id}/lookups/classes/${grade7.id}/students`)).status).toBe(403);
    const secondary = await schoolByCode(DEMO_SCHOOLS.secondary.code);
    expect((await teacher.get(`/api/schools/${secondary.id}/lookups/scope`)).status).toBe(403);
  });

  it('rejects an invalid date', async () => {
    await expect(seedDemo(db, { today: '2025-13-40' })).rejects.toThrow(/invalid today/);
  });
});

describe('structure', () => {
  it('has the sketch schools, classes and subjects with a teacher for every class × subject', async () => {
    const classes = await rawRows<{ school: string; label: string; n: number }>(sql`
      select sc.code as school, g.name || ' - ' || c.name as label, count(st.id)::int as n
      from class_sections c
      join schools sc on sc.id = c.school_id
      join grade_levels g on g.id = c.grade_level_id
      left join students st on st.class_section_id = c.id
      group by sc.code, g.name, c.name, g.sort
      order by sc.code, g.sort, c.name`);
    expect(classes.map((c) => `${c.school} ${c.label}`)).toEqual([
      `${DEMO_SCHOOLS.middle.code} الصف الخامس - أ`,
      `${DEMO_SCHOOLS.middle.code} الصف الخامس - ب`,
      `${DEMO_SCHOOLS.middle.code} الصف السادس - أ`,
      `${DEMO_SCHOOLS.middle.code} الصف السابع - أ`,
      `${DEMO_SCHOOLS.secondary.code} الصف الأول الثانوي - أ`,
      `${DEMO_SCHOOLS.secondary.code} الصف الثاني الثانوي - أ`,
    ]);
    for (const c of classes) {
      expect(c.n).toBeGreaterThanOrEqual(18);
      expect(c.n).toBeLessThanOrEqual(24);
    }
    expect(await count(s.subjects)).toBe(14);
    expect(await count(s.teachingAssignments)).toBe(6 * 7);
  });

  it('students have per-school codes, realistic names and a ~60/40 gender split', async () => {
    const students = await db.select().from(s.students);
    for (const school of await db.select().from(s.schools)) {
      const codes = students.filter((x) => x.schoolId === school.id).map((x) => x.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes).toContain('S-1');
      expect(codes).toContain(`S-${codes.length}`);
    }
    const female = students.filter((x) => x.gender === 'female').length / students.length;
    expect(female).toBeGreaterThan(0.5);
    expect(female).toBeLessThan(0.7);
    expect(students.every((x) => x.fatherName && x.grandfatherName && x.registeredAt <= TODAY)).toBe(true);
    expect(new Set(students.map((x) => x.registeredAt.slice(0, 4))).size).toBeGreaterThan(2);
  });

  it('every other student has a primary guardian with a guardian membership', async () => {
    const orphans = await rawRows<{ n: number }>(sql`
      select count(*)::int as n from students st
      where not exists (select 1 from student_guardians sg where sg.student_id = st.id and sg.is_primary)`);
    expect(orphans[0].n).toBe(0);
    const missing = await rawRows<{ n: number }>(sql`
      select count(*)::int as n from student_guardians sg
      where not exists (
        select 1 from memberships m where m.user_id = sg.user_id and m.school_id = sg.school_id and m.role = 'guardian')`);
    expect(missing[0].n).toBe(0);
    const byStatus = await rawRows<{ status: string; n: number }>(sql`
      select u.status, count(distinct u.id)::int as n from users u
      join memberships m on m.user_id = u.id and m.role = 'guardian'
      group by u.status`);
    const guardians = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
    expect(guardians.active).toBeGreaterThan(5);
    expect(guardians.pending).toBeGreaterThan(guardians.active);
  });

  it('weekly timetables are full and no teacher is in two classes at once', async () => {
    const conflicts = await rawRows<{ n: number }>(sql`
      select count(*)::int as n from (
        select teacher_id, weekday, period from timetable_slots
        where teacher_id is not null
        group by teacher_id, weekday, period having count(*) > 1) x`);
    expect(conflicts[0].n).toBe(0);
    const perClass = await rawRows<{ n: number; days: number; wrong: number }>(sql`
      select count(*)::int as n, count(distinct weekday)::int as days,
        count(*) filter (where not exists (
          select 1 from teaching_assignments ta
          where ta.class_section_id = t.class_section_id and ta.subject_id = t.subject_id
            and ta.teacher_id = t.teacher_id))::int as wrong
      from timetable_slots t group by class_section_id`);
    expect(perClass).toHaveLength(6);
    for (const c of perClass) expect(c).toEqual({ n: 30, days: 5, wrong: 0 });
  });
});

describe('guardian screens have data for each demo child', () => {
  it('recent lessons (with unread badges), homework done and pending', async () => {
    const agent = await login(ACCOUNT.guardian.phone);
    for (const name of ['مصعب', 'إسماعيل', 'محمد'] as const) {
      const student = await child(name);
      const recent = await count(
        s.lessons,
        and(
          eq(s.lessons.classSectionId, student.classSectionId ?? ''),
          inArray(s.lessons.date, [TODAY, addDays(TODAY, -1)]),
        ),
      );
      expect(recent, name).toBeGreaterThanOrEqual(6);
      const tiles = await agent.get(`/api/students/${student.id}/subjects?module=lessons`);
      expect(tiles.status).toBe(200);
      const badges = (tiles.body as Array<{ badge: number }>).map((t) => t.badge);
      expect(badges).toHaveLength(7);
      const unread = badges.reduce((a, b) => a + b, 0);
      expect(unread, name).toBeGreaterThan(0);
      expect(unread, name).toBeLessThanOrEqual(recent);
    }
    const musab = await child('مصعب');
    const done = await count(s.homeworkDone, eq(s.homeworkDone.studentId, musab.id));
    const homework = await count(
      s.lessons,
      and(eq(s.lessons.classSectionId, musab.classSectionId ?? ''), eq(s.lessons.hasHomework, true)),
    );
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(homework);
  });

  it('مصعب: 3 absences this month and 8 this academic year', async () => {
    const dates = await absenceDates((await child('مصعب')).id);
    expect(dates.filter((d) => d >= '2025-11-01' && d <= '2025-11-30')).toHaveLength(3);
    expect(dates.filter((d) => d >= '2025-07-01')).toHaveLength(8);
    expect(dates).toContain('2025-11-11');
  });

  it('مصعب: fees like the sketch (paid 400,000, remaining 200,000), late by 50,000 once due', async () => {
    const musab = await child('مصعب');
    const account = await feeAccount(musab.id, TODAY);
    expect(account).toMatchObject({ total: 600_000, discount: 0, paid: 400_000, remaining: 200_000 });
    expect(account.installments.map((i) => [i.amount, i.paid, i.status])).toEqual([
      [300_000, 300_000, 'paid'],
      [150_000, 100_000, 'partial'],
      [150_000, 0, 'upcoming'],
    ]);
    const later = await feeAccount(musab.id, '2026-02-01');
    expect(later.overdue).toBe(50_000);
    expect(later.installments[1].status).toBe('late');
  });

  it('fees: every student billed; paid, late and unpaid accounts; a few sibling discounts', async () => {
    expect(await count(s.studentFees)).toBe(await count(s.students));
    expect(await count(s.planInstallments)).toBe(5 * 3);
    const students = await db.select({ id: s.students.id }).from(s.students);
    const accounts = await Promise.all(students.map((x) => feeAccount(x.id, TODAY)));
    expect(accounts.filter((a) => a.remaining === 0).length).toBeGreaterThan(10);
    expect(accounts.filter((a) => a.overdue > 0 && a.paid > 0).length).toBeGreaterThan(5);
    expect(accounts.filter((a) => a.paid === 0).length).toBeGreaterThan(5);
    expect(accounts.filter((a) => a.discount > 0).length).toBeGreaterThanOrEqual(3);
    expect(await count(s.payments, gt(s.payments.paidAt, TODAY))).toBe(0);
  });

  it('exams: published term + monthly results, next week’s timetable, graded and announced quizzes', async () => {
    const periods = await db.select().from(s.examPeriods);
    expect(periods).toHaveLength(5 * 3);
    expect(periods.filter((p) => p.resultsPublishedAt)).toHaveLength(10);
    expect(new Set(periods.map((p) => p.name))).toEqual(
      new Set(['امتحانات الفترة الأولى', 'الامتحانات الشهرية - أكتوبر', 'الامتحانات الشهرية - نوفمبر']),
    );
    const upcomingIds = periods.filter((p) => !p.resultsPublishedAt).map((p) => p.id);
    const upcoming = await db.select().from(s.assessments).where(inArray(s.assessments.examPeriodId, upcomingIds));
    expect(upcoming).toHaveLength(6 * 7);
    expect(upcoming.every((a) => a.date > TODAY && a.date <= addDays(TODAY, 14))).toBe(true);
    const unpublishedScores = await rawRows<{ n: number }>(sql`
      select count(*)::int as n from scores sc join assessments a on a.id = sc.assessment_id
      join exam_periods p on p.id = a.exam_period_id where p.results_published_at is null`);
    expect(unpublishedScores[0].n).toBe(0);

    const musab = await child('مصعب');
    const sheet = await rawRows<{ name: string; total: number; max: number; n: number }>(sql`
      select p.name, sum(sc.score)::int as total, sum(a.max_score)::int as max, count(*)::int as n
      from scores sc join assessments a on a.id = sc.assessment_id join exam_periods p on p.id = a.exam_period_id
      where sc.student_id = ${musab.id} group by p.name`);
    // 71.2% (جيد) in the monthly exams after 76.6% (جيد جداً) in the term.
    expect(Object.fromEntries(sheet.map(({ name, ...rest }) => [name, rest]))).toEqual({
      'الامتحانات الشهرية - أكتوبر': { total: 235, max: 330, n: 7 },
      'امتحانات الفترة الأولى': { total: 498, max: 650, n: 7 },
    });

    const quizzes = await db
      .select()
      .from(s.assessments)
      .where(and(eq(s.assessments.kind, 'quiz'), eq(s.assessments.classSectionId, musab.classSectionId ?? '')));
    const past = quizzes.filter((q) => q.date <= TODAY);
    const announced = quizzes.filter((q) => q.date > TODAY);
    expect(past).toHaveLength(3);
    expect(announced.length).toBeGreaterThanOrEqual(2);
    expect(announced.map((q) => q.details)).toContain('سورة النور من الآية 1 إلى 50');
    const [mathQuiz] = await db
      .select({ score: s.scores.score, max: s.assessments.maxScore })
      .from(s.scores)
      .innerJoin(s.assessments, eq(s.assessments.id, s.scores.assessmentId))
      .innerJoin(s.subjects, eq(s.subjects.id, s.assessments.subjectId))
      .where(and(eq(s.scores.studentId, musab.id), eq(s.assessments.kind, 'quiz'), eq(s.subjects.name, 'الرياضيات')));
    expect(mathQuiz).toEqual({ score: 15, max: 30 });
  });

  it('behavior: regulations, مصعب’s two violations (one penalty), evaluations for every child', async () => {
    expect(await count(s.regulations)).toBe(16);
    const musab = await child('مصعب');
    const incidents = await db
      .select({ title: s.regulations.title, penalty: s.behaviorIncidents.penalty })
      .from(s.behaviorIncidents)
      .innerJoin(s.regulations, eq(s.regulations.id, s.behaviorIncidents.regulationId))
      .where(eq(s.behaviorIncidents.studentId, musab.id));
    expect(incidents.map((i) => i.title).sort()).toEqual(['حلاقة غير لائقة', 'مخالفة الزي المدرسي']);
    expect(incidents.filter((i) => i.penalty)).toHaveLength(1);
    expect(await count(s.behaviorIncidents)).toBeGreaterThanOrEqual(15);
    for (const name of ['مصعب', 'إسماعيل', 'محمد'] as const) {
      const id = (await child(name)).id;
      expect(await count(s.behaviorIncidents, eq(s.behaviorIncidents.studentId, id)), name).toBeGreaterThan(0);
      expect(await count(s.evaluations, eq(s.evaluations.studentId, id)), name).toBeGreaterThanOrEqual(3);
    }
  });

  it('announcements of the last two weeks and calendar events around today', async () => {
    const musab = await child('مصعب');
    const toMusab = await db.select().from(s.announcements).where(eq(s.announcements.audienceId, musab.id));
    expect(toMusab.map((a) => a.body)).toEqual(['الرجاء الحضور للمدرسة لمناقشة نتيجة الطالب مصعب إبراهيم']);
    const meeting = await db
      .select()
      .from(s.announcements)
      .where(eq(s.announcements.title, 'غداً إجتماع أولياء الأمور'));
    expect(meeting).toHaveLength(2);
    const grade5 = await rawRows<{ n: number }>(sql`
      select count(*)::int as n from announcements a join grade_levels g on g.id = a.audience_id
      where a.audience_type = 'grade_level' and g.name = 'الصف الخامس'`);
    expect(grade5[0].n).toBe(1);
    const all = await db.select().from(s.announcements);
    const twoWeeksAgo = new Date(`${addDays(TODAY, -15)}T00:00:00Z`);
    expect(all.every((a) => a.publishedAt > twoWeeksAgo && a.publishedAt <= new Date())).toBe(true);

    for (const school of await db.select().from(s.schools)) {
      const events = await db.select().from(s.calendarEvents).where(eq(s.calendarEvents.schoolId, school.id));
      expect(events.length).toBeGreaterThanOrEqual(8);
      expect(events.length).toBeLessThanOrEqual(12);
      expect(events.some((e) => e.endsOn < TODAY)).toBe(true);
      expect(events.some((e) => e.startsOn > TODAY)).toBe(true);
      expect(events.every((e) => e.startsOn >= addDays(TODAY, -62) && e.endsOn <= addDays(TODAY, 62))).toBe(true);
    }
  });
});

describe('staff screens have data', () => {
  it("today's attendance is recorded for most but not all classes", async () => {
    expect(await count(s.attendanceSessions, eq(s.attendanceSessions.date, TODAY))).toBe(4);
    const days = await rawRows<{ n: number }>(sql`select count(distinct date)::int as n from attendance_sessions`);
    expect(days[0].n).toBeGreaterThanOrEqual(20);
    const rate = (await count(s.absences)) / ((await count(s.attendanceSessions)) * 20);
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.07);
  });

  it("lessons today and before, on school days only, posted around the lesson's morning", async () => {
    const lessons = await db.select().from(s.lessons);
    expect(lessons.some((l) => l.date === TODAY)).toBe(true);
    expect(lessons.every((l) => weekdayOf(l.date) <= 4 && l.date <= TODAY)).toBe(true);
    expect(lessons.every((l) => l.createdAt.toISOString().slice(0, 10) === l.date)).toBe(true);
    const withHomework = lessons.filter((l) => l.hasHomework);
    expect(withHomework.length / lessons.length).toBeGreaterThan(0.35);
    expect(withHomework.length / lessons.length).toBeLessThan(0.65);
    expect(withHomework.every((l) => l.homeworkDetails && l.homeworkDueDate && l.homeworkDueDate > l.date)).toBe(true);
    const teacher = await db.select().from(s.users).where(eq(s.users.phone, ACCOUNT.teacher.phone));
    expect(lessons.filter((l) => l.teacherId === teacher[0].id && l.date === TODAY).length).toBeGreaterThan(0);
  });

  it('evaluations and graded quizzes exist for the demo teacher', async () => {
    const [teacher] = await db.select().from(s.users).where(eq(s.users.phone, ACCOUNT.teacher.phone));
    expect(await count(s.evaluations, eq(s.evaluations.teacherId, teacher.id))).toBeGreaterThan(0);
    expect(await count(s.scores, eq(s.scores.enteredBy, teacher.id))).toBeGreaterThan(0);
    expect(
      await count(s.assessments, and(isNull(s.assessments.examPeriodId), isNotNull(s.assessments.details))),
    ).toBeGreaterThan(0);
  });
});

describe('determinism and robustness', () => {
  it('builds the same rows for the same day', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const a = buildDemoRows({ today: TODAY, now, pinHash: 'x' });
    const b = buildDemoRows({ today: TODAY, now, pinHash: 'x' });
    expect(a).toEqual(b);
    expect(a.lessons.length).toBeGreaterThan(200);
  });

  it('reseeds after a reset', async () => {
    await resetDatabase(db);
    await seedDemo(db, { today: TODAY });
    expect(await count(s.schools)).toBe(2);
    await login(ACCOUNT.guardian.phone);
  });

  it('works when today is a Friday (latest school day = Thursday)', async () => {
    await resetDatabase(db);
    await seedDemo(db, { today: '2025-11-14' });
    const [latest] = await rawRows<{ d: string }>(sql`select max(date)::text as d from lessons`);
    expect(latest.d).toBe('2025-11-13');
    expect(await count(s.attendanceSessions, eq(s.attendanceSessions.date, '2025-11-13'))).toBe(6);
    expect((await feeAccount((await child('مصعب')).id, '2025-11-14')).paid).toBe(400_000);
  });

  it('works at the very start of the academic year', async () => {
    await resetDatabase(db);
    await seedDemo(db, { today: '2025-07-02' });
    const [year] = await db.select().from(s.academicYears).limit(1);
    expect(year).toMatchObject({ name: '2025/2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
    const musab = await child('مصعب');
    expect(await feeAccount(musab.id, '2025-07-02')).toMatchObject({ paid: 400_000, remaining: 200_000 });
    const july = (await absenceDates(musab.id)).filter((d) => d >= '2025-07-01');
    expect(july).toHaveLength(2);
    expect(await count(s.payments, gt(s.payments.paidAt, '2025-07-02'))).toBe(0);
  });

  it('works with the default today (what the server does on first boot)', async () => {
    await resetDatabase(db);
    await seedDemo(db);
    const today = todayIn('Africa/Khartoum');
    const musab = await child('مصعب');
    const agent = await login(ACCOUNT.guardian.phone);
    const absences = await agent.get(`/api/students/${musab.id}/attendance`);
    expect(absences.status).toBe(200);
    // Sunday–Thursday dates so far this month (a two-day break may fall among them).
    const weekdaysSoFar = Array.from({ length: Number(today.slice(8, 10)) }, (_, i) =>
      weekdayOf(`${today.slice(0, 8)}${String(i + 1).padStart(2, '0')}`),
    ).filter((w) => w <= 4).length;
    if (weekdaysSoFar >= 5) expect(absences.body.thisMonth).toBe(3);
    expect(absences.body.thisMonth).toBeLessThanOrEqual(3);
    expect(absences.body.total).toBeGreaterThanOrEqual(absences.body.thisMonth);
    const week = await agent.get(`/api/students/${musab.id}/lessons?range=week`);
    expect(week.status).toBe(200);
    expect(week.body.length).toBeGreaterThan(0);
    expect(await count(s.lessons, gt(s.lessons.date, today))).toBe(0);
    expect(await count(s.lessons, gt(s.lessons.createdAt, new Date()))).toBe(0);
  });
});
