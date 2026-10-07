import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { addDays, BADGE_MODULES, todayIn, type BadgeModule } from '@slash/shared';
import { createApp } from '../src/app';
import { connectPglite } from '../src/db/client';
import * as s from '../src/db/schema';
import { seedCommsDemo } from '../src/modules/comms';
import { DEMO_ACCOUNTS, DEMO_PIN } from '../src/seed/demo-accounts';
import { seedDemo } from '../src/seed/demo';
import { setupTestApp, type TestContext } from './helpers';

type Agent = Awaited<ReturnType<TestContext['loginAs']>>;

let t: TestContext;
let today: string;
let admin: Agent;
let supervisor: Agent;
let teacher: Agent;
let guardian: Agent;
let guardian2: Agent;
let adminB: Agent;

beforeAll(async () => {
  t = await setupTestApp();
  today = todayIn(t.fx.schoolA.timezone);
  [admin, supervisor, teacher, guardian, guardian2, adminB] = await Promise.all(
    [
      t.fx.users.admin,
      t.fx.users.supervisor,
      t.fx.users.teacher,
      t.fx.users.guardian,
      t.fx.users.guardian2,
      t.fx.users.adminB,
    ].map((u) => t.loginAs(u.phone)),
  );
});
afterAll(() => t.close());

const annUrl = (schoolId = t.fx.schoolA.id) => `/api/schools/${schoolId}/announcements`;
const calUrl = (schoolId = t.fx.schoolA.id) => `/api/schools/${schoolId}/calendar`;
const studentUrl = (studentId: string, path: string) => `/api/students/${studentId}/${path}`;
const paths = (res: request.Response) => (res.body.error.details as Array<{ path: string }>).map((d) => d.path);

const S1_NAME = 'مصعب إبراهيم عبدالله';

describe('staff: announcements', () => {
  it('admin sends to the whole school, a grade, a class and one guardian (201 + audience labels)', async () => {
    const school = await admin
      .post(annUrl())
      .send({ title: ' عطلة ', body: 'لا دراسة يوم الخميس', audienceType: 'school', audienceId: t.fx.class5a.id });
    expect(school.status).toBe(201);
    expect(school.body).toMatchObject({
      title: 'عطلة',
      body: 'لا دراسة يوم الخميس',
      audienceType: 'school',
      audienceId: null,
      audienceLabel: 'إعلان لجميع الطلاب',
      createdByName: 'مدير أ',
    });
    expect(typeof school.body.id).toBe('string');
    expect(new Date(school.body.publishedAt).toString()).not.toBe('Invalid Date');

    const cases = [
      { audienceType: 'grade_level', audienceId: t.fx.grade5.id, label: 'إعلان لطلاب الصف الخامس' },
      { audienceType: 'class_section', audienceId: t.fx.class5b.id, label: 'إعلان لطلاب الصف الخامس - ب' },
      { audienceType: 'student', audienceId: t.fx.students.s1.id, label: `إعلان خاص لـ ولي أمر الطالب ${S1_NAME}` },
    ];
    for (const c of cases) {
      const res = await admin
        .post(annUrl())
        .send({ title: 'تنبيه', body: 'نص', audienceType: c.audienceType, audienceId: c.audienceId });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        audienceType: c.audienceType,
        audienceId: c.audienceId,
        audienceLabel: c.label,
      });
    }
  });

  it('validates input with per-field messages', async () => {
    const empty = await admin.post(annUrl()).send({});
    expect(empty.status).toBe(400);
    expect(paths(empty)).toEqual(expect.arrayContaining(['title', 'body', 'audienceType']));

    const noTarget = await admin.post(annUrl()).send({ title: 'أ', body: 'ب', audienceType: 'grade_level' });
    expect(noTarget.status).toBe(400);
    expect(paths(noTarget)).toEqual(['audienceId']);

    const badType = await admin.post(annUrl()).send({ title: 'أ', body: 'ب', audienceType: 'everyone' });
    expect(badType.status).toBe(400);
    expect(paths(badType)).toEqual(['audienceType']);

    const badId = await admin
      .post(annUrl())
      .send({ title: 'أ', body: 'ب', audienceType: 'student', audienceId: 'not-a-uuid' });
    expect(badId.status).toBe(400);

    const blank = await admin.post(annUrl()).send({ title: '  ', body: 'ب', audienceType: 'school' });
    expect(blank.status).toBe(400);
    expect(paths(blank)).toEqual(['title']);
  });

  it('the target must belong to this school and match the audience type', async () => {
    const send = (audienceType: string, audienceId: string) =>
      admin.post(annUrl()).send({ title: 'أ', body: 'ب', audienceType, audienceId });
    expect((await send('class_section', t.fx.classB.id)).status).toBe(404);
    expect((await send('student', t.fx.students.s4.id)).status).toBe(404);
    // A class id sent as a grade level, a grade level id sent as a student.
    expect((await send('grade_level', t.fx.class5a.id)).status).toBe(404);
    expect((await send('student', t.fx.grade5.id)).status).toBe(404);
    expect((await send('class_section', crypto.randomUUID())).status).toBe(404);
  });

  it('lists sent announcements newest first, with filters and paging (admin, supervisor)', async () => {
    const res = await supervisor.get(annUrl());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    const times = res.body.map((a: { publishedAt: string }) => a.publishedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(res.body[0]).toMatchObject({ audienceType: 'student', createdByName: 'مدير أ' });

    const grades = await admin.get(`${annUrl()}?audienceType=grade_level`);
    expect(grades.body.map((a: { audienceLabel: string }) => a.audienceLabel)).toEqual(['إعلان لطلاب الصف الخامس']);
    const forStudent = await admin.get(`${annUrl()}?audienceId=${t.fx.students.s1.id}`);
    expect(forStudent.body).toHaveLength(1);

    const page = await admin.get(`${annUrl()}?limit=2&offset=1`);
    expect(page.body.map((a: { id: string }) => a.id)).toEqual(res.body.slice(1, 3).map((a: { id: string }) => a.id));

    expect((await admin.get(`${annUrl()}?audienceType=all`)).status).toBe(400);
    expect((await admin.get(`${annUrl()}?limit=500`)).status).toBe(400);
  });

  it('only the admin sends and deletes; teachers, guardians and other schools are denied', async () => {
    const body = { title: 'أ', body: 'ب', audienceType: 'school' };
    expect((await supervisor.post(annUrl()).send(body)).status).toBe(403);
    expect((await teacher.post(annUrl()).send(body)).status).toBe(403);
    expect((await teacher.get(annUrl())).status).toBe(403);
    expect((await guardian.get(annUrl())).status).toBe(403);
    expect((await guardian.post(annUrl()).send(body)).status).toBe(403);
    expect((await adminB.get(annUrl())).status).toBe(403);
    expect((await adminB.post(annUrl()).send(body)).status).toBe(403);
    expect((await t.anon().get(annUrl())).status).toBe(401);
  });

  it('deletes an announcement of this school only', async () => {
    const created = await admin.post(annUrl()).send({ title: 'للحذف', body: 'ب', audienceType: 'school' });
    const other = await adminB
      .post(annUrl(t.fx.schoolB.id))
      .send({ title: 'مدرسة ب', body: 'ب', audienceType: 'school' });
    expect(other.status).toBe(201);

    expect((await supervisor.delete(`${annUrl()}/${created.body.id}`)).status).toBe(403);
    expect((await adminB.delete(`${annUrl()}/${created.body.id}`)).status).toBe(403);
    expect((await admin.delete(`${annUrl()}/${other.body.id}`)).status).toBe(404);
    expect((await admin.delete(`${annUrl()}/nope`)).status).toBe(400);

    const res = await admin.delete(`${annUrl()}/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await admin.delete(`${annUrl()}/${created.body.id}`)).status).toBe(404);
    const [log] = await t.db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entity, 'announcement'), eq(s.auditLogs.entityId, created.body.id)));
    expect(log).toMatchObject({ action: 'delete', actorId: t.fx.users.admin.id });
  });

  it("lists a student's guardian contacts for WhatsApp (admin only)", async () => {
    await t.db
      .update(s.studentGuardians)
      .set({ whatsapp: '0911222333' })
      .where(eq(s.studentGuardians.studentId, t.fx.students.s1.id));
    await t.db
      .update(s.students)
      .set({ motherName: 'آمنة أحمد', motherPhone: '0912000111' })
      .where(eq(s.students.id, t.fx.students.s1.id));

    const res = await admin.get(`${annUrl()}/contacts/${t.fx.students.s1.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        fullName: 'ولي أمر',
        phone: t.fx.users.guardian.phone,
        relation: 'father',
        whatsapp: '0911222333',
        isPrimary: true,
        activated: true,
      },
      {
        fullName: 'آمنة أحمد',
        phone: '0912000111',
        relation: 'mother',
        whatsapp: null,
        isPrimary: false,
        activated: false,
      },
    ]);

    const none = await admin.get(`${annUrl()}/contacts/${t.fx.students.s3.id}`);
    expect(none.body).toEqual([]);
    expect((await admin.get(`${annUrl()}/contacts/${t.fx.students.s4.id}`)).status).toBe(404);
    expect((await supervisor.get(`${annUrl()}/contacts/${t.fx.students.s1.id}`)).status).toBe(403);
    expect((await teacher.get(`${annUrl()}/contacts/${t.fx.students.s1.id}`)).status).toBe(403);
    expect((await guardian.get(`${annUrl()}/contacts/${t.fx.students.s1.id}`)).status).toBe(403);
    expect((await adminB.get(`${annUrl()}/contacts/${t.fx.students.s1.id}`)).status).toBe(403);
  });
});

describe('staff: calendar', () => {
  const ids: Record<string, string> = {};

  it('admin adds events (201); a one-day event may omit endsOn', async () => {
    const holiday = await admin.post(calUrl()).send({
      title: 'عطلة منتصف الفترة',
      kind: 'holiday',
      startsOn: '2025-10-01',
      endsOn: '2025-10-03',
      details: ' تستأنف الدراسة الأحد ',
    });
    expect(holiday.status).toBe(201);
    expect(holiday.body).toEqual({
      id: expect.any(String),
      title: 'عطلة منتصف الفترة',
      kind: 'holiday',
      startsOn: '2025-10-01',
      endsOn: '2025-10-03',
      details: 'تستأنف الدراسة الأحد',
    });
    ids.holiday = holiday.body.id;

    const sports = await admin.post(calUrl()).send({ title: 'اليوم الرياضي', kind: 'event', startsOn: '2025-10-20' });
    expect(sports.status).toBe(201);
    expect(sports.body).toMatchObject({ startsOn: '2025-10-20', endsOn: '2025-10-20', details: null });
    ids.sports = sports.body.id;

    const exams = await admin
      .post(calUrl())
      .send({ title: 'الامتحانات الشهرية', kind: 'exam', startsOn: '2025-10-30', endsOn: '2025-11-02' });
    ids.exams = exams.body.id;
    const meeting = await admin
      .post(calUrl())
      .send({ title: 'اجتماع أولياء الأمور', kind: 'meeting', startsOn: '2025-11-10' });
    ids.meeting = meeting.body.id;
  });

  it('validates kind, dates and the range', async () => {
    const empty = await admin.post(calUrl()).send({});
    expect(empty.status).toBe(400);
    expect(paths(empty)).toEqual(expect.arrayContaining(['title', 'kind', 'startsOn']));

    const reversed = await admin
      .post(calUrl())
      .send({ title: 'أ', kind: 'event', startsOn: '2025-10-05', endsOn: '2025-10-04' });
    expect(reversed.status).toBe(400);
    expect(paths(reversed)).toEqual(['endsOn']);

    const badKind = await admin.post(calUrl()).send({ title: 'أ', kind: 'party', startsOn: '2025-10-05' });
    expect(paths(badKind)).toEqual(['kind']);
    const badDate = await admin.post(calUrl()).send({ title: 'أ', kind: 'event', startsOn: '2025-02-30' });
    expect(paths(badDate)).toEqual(['startsOn']);
    const tooLong = await admin
      .post(calUrl())
      .send({ title: 'أ', kind: 'event', startsOn: '2025-01-01', endsOn: '2026-06-01' });
    expect(tooLong.status).toBe(400);
  });

  it('lists events overlapping a range, by start date (any staff)', async () => {
    const res = await teacher.get(`${calUrl()}?from=2025-10-03&to=2025-10-31`);
    expect(res.status).toBe(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual([ids.holiday, ids.sports, ids.exams]);

    const november = await supervisor.get(`${calUrl()}?from=2025-11-01&to=2025-11-30`);
    expect(november.body.map((e: { id: string }) => e.id)).toEqual([ids.exams, ids.meeting]);

    const all = await admin.get(calUrl());
    expect(all.body).toHaveLength(4);

    const reversed = await admin.get(`${calUrl()}?from=2025-11-01&to=2025-10-01`);
    expect(reversed.status).toBe(400);
    expect((await admin.get(`${calUrl()}?from=yesterday`)).status).toBe(400);
  });

  it('admin edits and deletes events; the merged range is validated', async () => {
    const res = await admin.patch(`${calUrl()}/${ids.sports}`).send({ title: 'يوم رياضي مفتوح', endsOn: '2025-10-21' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'يوم رياضي مفتوح',
      kind: 'event',
      startsOn: '2025-10-20',
      endsOn: '2025-10-21',
    });

    const cleared = await admin.patch(`${calUrl()}/${ids.holiday}`).send({ details: '' });
    expect(cleared.body.details).toBeNull();

    const before = await admin.patch(`${calUrl()}/${ids.sports}`).send({ endsOn: '2025-10-19' });
    expect(before.status).toBe(400);
    expect(paths(before)).toEqual(['endsOn']);
    expect((await admin.patch(`${calUrl()}/${ids.sports}`).send({ kind: 'trip' })).status).toBe(400);
    expect((await admin.patch(`${calUrl()}/${crypto.randomUUID()}`).send({ title: 'أ' })).status).toBe(404);

    const temp = await admin.post(calUrl()).send({ title: 'مؤقت', kind: 'event', startsOn: '2025-12-01' });
    expect((await admin.delete(`${calUrl()}/${temp.body.id}`)).body).toEqual({ ok: true });
    expect((await admin.delete(`${calUrl()}/${temp.body.id}`)).status).toBe(404);
  });

  it('only the admin writes; guardians and other schools are denied', async () => {
    const event = { title: 'أ', kind: 'event', startsOn: '2025-10-05' };
    expect((await supervisor.post(calUrl()).send(event)).status).toBe(403);
    expect((await teacher.post(calUrl()).send(event)).status).toBe(403);
    expect((await teacher.patch(`${calUrl()}/${ids.sports}`).send({ title: 'x' })).status).toBe(403);
    expect((await teacher.delete(`${calUrl()}/${ids.sports}`)).status).toBe(403);
    expect((await guardian.get(calUrl())).status).toBe(403);
    expect((await guardian.post(calUrl()).send(event)).status).toBe(403);
    expect((await adminB.get(calUrl())).status).toBe(403);
    expect((await adminB.patch(`${calUrl()}/${ids.sports}`).send({ title: 'x' })).status).toBe(403);

    const other = await adminB.post(calUrl(t.fx.schoolB.id)).send(event);
    expect(other.status).toBe(201);
    expect((await admin.patch(`${calUrl()}/${other.body.id}`).send({ title: 'x' })).status).toBe(404);
    expect((await admin.delete(`${calUrl()}/${other.body.id}`)).status).toBe(404);
    const listB = await adminB.get(calUrl(t.fx.schoolB.id));
    expect(listB.body.map((e: { id: string }) => e.id)).toEqual([other.body.id]);
  });
});

describe('guardian: home summary and unread badges', () => {
  const summary = async (agent: Agent = guardian, studentId = t.fx.students.s1.id) => {
    const res = await agent.get(studentUrl(studentId, 'summary'));
    expect(res.status).toBe(200);
    return res.body as { badges: Record<BadgeModule, number> } & Record<string, unknown>;
  };

  it('returns the student, school and all nine badges', async () => {
    const body = await summary();
    expect(body).toMatchObject({
      student: {
        id: t.fx.students.s1.id,
        fullName: S1_NAME,
        code: 'S-1',
        classLabel: 'الصف الخامس - أ',
        status: 'active',
      },
      school: { id: t.fx.schoolA.id, name: t.fx.schoolA.name, today },
    });
    expect(Object.keys(body.badges).sort()).toEqual([...BADGE_MODULES].sort());
    // Announcements sent to the school, grade 5 and s1 since the guardian was linked.
    expect(body.badges.announcements).toBe(3);
  });

  it('POST /seen clears a badge; everything seen → all zeros', async () => {
    for (const module of BADGE_MODULES) {
      const res = await guardian.post(studentUrl(t.fx.students.s1.id, 'seen')).send({ module });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
    const body = await summary();
    expect(Object.values(body.badges).every((n) => n === 0)).toBe(true);
  });

  it('validates /seen', async () => {
    const bad = await guardian.post(studentUrl(t.fx.students.s1.id, 'seen')).send({ module: 'transport' });
    expect(bad.status).toBe(400);
    expect(paths(bad)).toEqual(['module']);
    const badScope = await guardian
      .post(studentUrl(t.fx.students.s1.id, 'seen'))
      .send({ module: 'lessons', scope: 'math' });
    expect(badScope.status).toBe(400);
    const subject = await guardian
      .post(studentUrl(t.fx.students.s1.id, 'seen'))
      .send({ module: 'lessons', scope: t.fx.math.id });
    expect(subject.status).toBe(200);
    const [cursor] = await t.db
      .select()
      .from(s.readCursors)
      .where(and(eq(s.readCursors.userId, t.fx.users.guardian.id), eq(s.readCursors.scope, t.fx.math.id)));
    expect(cursor.module).toBe('lessons');
  });

  it('counts what was added since each module was last seen, for this student only', async () => {
    const { fx } = t;
    const A = fx.schoolA.id;
    // Lessons: two in 5-أ (one with homework), one in 5-ب (another class).
    await t.db.insert(s.lessons).values([
      { schoolId: A, classSectionId: fx.class5a.id, subjectId: fx.math.id, date: today, title: 'درس 1' },
      {
        schoolId: A,
        classSectionId: fx.class5a.id,
        subjectId: fx.arabic.id,
        date: today,
        title: 'درس 2',
        hasHomework: true,
        homeworkDetails: 'تمارين',
      },
      { schoolId: A, classSectionId: fx.class5b.id, subjectId: fx.arabic.id, date: today, title: 'درس 5-ب' },
    ]);
    // Absence: s1 and s2 absent on one day.
    const [session] = await t.db
      .insert(s.attendanceSessions)
      .values({ schoolId: A, classSectionId: fx.class5a.id, date: '2025-10-05' })
      .returning();
    await t.db.insert(s.absences).values([
      { sessionId: session.id, studentId: fx.students.s1.id },
      { sessionId: session.id, studentId: fx.students.s2.id },
    ]);
    // Fees: one payment for s1, one for s2.
    const [plan] = await t.db
      .insert(s.feePlans)
      .values({ schoolId: A, academicYearId: fx.yearA.id, name: 'رسوم' })
      .returning();
    const [fee1, fee2] = await t.db
      .insert(s.studentFees)
      .values([
        { schoolId: A, studentId: fx.students.s1.id, feePlanId: plan.id },
        { schoolId: A, studentId: fx.students.s2.id, feePlanId: plan.id },
      ])
      .returning();
    await t.db.insert(s.payments).values([
      { schoolId: A, studentFeeId: fee1.id, amount: 100_000, paidAt: today, method: 'cash' },
      { schoolId: A, studentFeeId: fee2.id, amount: 50_000, paidAt: today, method: 'cash' },
    ]);
    // Exams & results: a graded quiz in 5-أ, a published monthly period with one sitting in 5-أ, a quiz in 6-أ.
    const [quiz] = await t.db
      .insert(s.assessments)
      .values({
        schoolId: A,
        classSectionId: fx.class5a.id,
        subjectId: fx.math.id,
        kind: 'quiz',
        title: 'اختبار',
        date: today,
        maxScore: 30,
      })
      .returning();
    const [period] = await t.db
      .insert(s.examPeriods)
      .values({
        schoolId: A,
        academicYearId: fx.yearA.id,
        gradeLevelId: fx.grade5.id,
        kind: 'monthly',
        name: 'الشهرية',
        resultsPublishedAt: new Date(),
      })
      .returning();
    const [monthly] = await t.db
      .insert(s.assessments)
      .values({
        schoolId: A,
        examPeriodId: period.id,
        classSectionId: fx.class5a.id,
        subjectId: fx.arabic.id,
        kind: 'monthly',
        title: 'العربية',
        date: today,
        maxScore: 50,
      })
      .returning();
    await t.db.insert(s.assessments).values({
      schoolId: A,
      classSectionId: fx.class6a.id,
      subjectId: fx.math.id,
      kind: 'quiz',
      title: 'اختبار 6',
      date: today,
      maxScore: 30,
    });
    await t.db.insert(s.scores).values([
      { assessmentId: quiz.id, studentId: fx.students.s1.id, score: 25 },
      { assessmentId: monthly.id, studentId: fx.students.s1.id, score: 40 },
      { assessmentId: quiz.id, studentId: fx.students.s2.id, score: 20 },
    ]);
    // Behavior: an incident and an evaluation for s1, an incident for s2.
    const [reg] = await t.db.insert(s.regulations).values({ schoolId: A, title: 'التأخر' }).returning();
    await t.db.insert(s.behaviorIncidents).values([
      { schoolId: A, studentId: fx.students.s1.id, regulationId: reg.id, date: today },
      { schoolId: A, studentId: fx.students.s2.id, regulationId: reg.id, date: today },
    ]);
    await t.db.insert(s.evaluations).values({
      schoolId: A,
      studentId: fx.students.s1.id,
      subjectId: fx.math.id,
      date: today,
      rating: 'calm',
    });
    // Calendar: one event in this school, one in school B.
    await admin.post(calUrl()).send({ title: 'حدث', kind: 'event', startsOn: addDays(today, 3) });
    await adminB.post(calUrl(fx.schoolB.id)).send({ title: 'حدث ب', kind: 'event', startsOn: addDays(today, 3) });
    // Announcements: school, grade 5, 5-أ and s1 reach s1; 5-ب, grade 6 and s2 do not.
    const send = (audienceType: string, audienceId?: string) =>
      admin.post(annUrl()).send({ title: `إلى ${audienceType}`, body: 'نص', audienceType, audienceId });
    await send('school');
    await send('grade_level', fx.grade5.id);
    await send('class_section', fx.class5a.id);
    await send('student', fx.students.s1.id);
    await send('class_section', fx.class5b.id);
    await send('grade_level', fx.grade6.id);
    await send('student', fx.students.s2.id);

    const body = await summary();
    expect(body.badges).toEqual({
      lessons: 2,
      homework: 1,
      attendance: 1,
      fees: 1,
      exams: 2,
      results: 2,
      behavior: 2,
      calendar: 1,
      announcements: 4,
    });
  });

  it('GET /announcements lists the targeted ones with labels and clears the badge', async () => {
    const res = await guardian.get(studentUrl(t.fx.students.s1.id, 'announcements'));
    expect(res.status).toBe(200);
    const fresh = res.body.filter((a: { isNew: boolean }) => a.isNew);
    expect(fresh.map((a: { audienceLabel: string }) => a.audienceLabel)).toEqual([
      `إعلان خاص لـ ولي أمر الطالب ${S1_NAME}`,
      'إعلان لطلاب الصف الخامس - أ',
      'إعلان لطلاب الصف الخامس',
      'إعلان لجميع الطلاب',
    ]);
    expect(fresh[0]).toEqual({
      id: expect.any(String),
      title: 'إلى student',
      body: 'نص',
      publishedAt: expect.any(String),
      audienceType: 'student',
      audienceLabel: `إعلان خاص لـ ولي أمر الطالب ${S1_NAME}`,
      isNew: true,
    });
    // Older ones (from the staff tests) are listed too, but not as new; nothing for 5-ب, grade 6 or s2.
    const labels = res.body.map((a: { audienceLabel: string }) => a.audienceLabel);
    expect(labels).not.toContain('إعلان لطلاب الصف الخامس - ب');
    expect(labels).not.toContain('إعلان لطلاب الصف السادس');
    expect(res.body).toHaveLength(7);

    expect((await summary()).badges.announcements).toBe(0);
    const again = await guardian.get(studentUrl(t.fx.students.s1.id, 'announcements'));
    expect(again.body.every((a: { isNew: boolean }) => !a.isNew)).toBe(true);

    const other = await guardian2.get(studentUrl(t.fx.students.s2.id, 'announcements'));
    expect(other.body.map((a: { audienceLabel: string }) => a.audienceLabel)).toContain(
      'إعلان خاص لـ ولي أمر الطالب أحمد إبراهيم عبدالله',
    );
    expect(other.body.map((a: { audienceLabel: string }) => a.audienceLabel)).not.toContain(
      `إعلان خاص لـ ولي أمر الطالب ${S1_NAME}`,
    );
  });

  it('GET /calendar returns the month, the next 30 days, and clears the badge', async () => {
    const soon = await admin.post(calUrl()).send({ title: 'قريباً', kind: 'meeting', startsOn: addDays(today, 10) });
    const later = await admin.post(calUrl()).send({ title: 'لاحقاً', kind: 'holiday', startsOn: addDays(today, 45) });
    expect((await summary()).badges.calendar).toBe(3);

    const october = await guardian.get(`${studentUrl(t.fx.students.s1.id, 'calendar')}?month=2025-10`);
    expect(october.status).toBe(200);
    expect(october.body.month).toBe('2025-10');
    expect(october.body.events.map((e: { title: string }) => e.title)).toEqual([
      'عطلة منتصف الفترة',
      'يوم رياضي مفتوح',
      'الامتحانات الشهرية',
    ]);
    expect(october.body.events[0]).toEqual({
      id: expect.any(String),
      title: 'عطلة منتصف الفترة',
      kind: 'holiday',
      startsOn: '2025-10-01',
      endsOn: '2025-10-03',
      details: null,
    });
    const upcoming = october.body.upcoming.map((e: { id: string }) => e.id);
    expect(upcoming).toContain(soon.body.id);
    expect(upcoming).not.toContain(later.body.id);
    expect((await summary()).badges.calendar).toBe(0);

    const current = await guardian.get(studentUrl(t.fx.students.s1.id, 'calendar'));
    expect(current.body.month).toBe(today.slice(0, 7));
    expect((await guardian.get(`${studentUrl(t.fx.students.s1.id, 'calendar')}?month=2025-13`)).status).toBe(400);
  });

  it('staff viewing a student get zero badges and do not clear the guardian badges', async () => {
    await admin.post(annUrl()).send({ title: 'جديد', body: 'نص', audienceType: 'school' });
    const staff = await summary(admin);
    expect(Object.values(staff.badges).every((n) => n === 0)).toBe(true);
    expect(staff.student).toMatchObject({ id: t.fx.students.s1.id, classLabel: 'الصف الخامس - أ' });
    // A teacher of 5-أ may open the student too.
    expect(Object.values((await summary(teacher)).badges).every((n) => n === 0)).toBe(true);

    const seenByStaff = await admin.get(studentUrl(t.fx.students.s1.id, 'announcements'));
    expect(seenByStaff.body.every((a: { isNew: boolean }) => !a.isNew)).toBe(true);
    expect((await admin.post(studentUrl(t.fx.students.s1.id, 'seen')).send({ module: 'announcements' })).status).toBe(
      200,
    );
    expect((await summary()).badges.announcements).toBe(1);
  });

  it('uses the link date as the baseline when a module was never opened', async () => {
    // guardian2 only opened the announcements for s2: everything else since the link counts.
    const body = await summary(guardian2, t.fx.students.s2.id);
    expect(body.badges).toMatchObject({
      lessons: 2,
      homework: 1,
      attendance: 1,
      fees: 1,
      exams: 2,
      // s2's quiz score + the published monthly period.
      results: 2,
      behavior: 1,
      // The school-wide announcement sent after guardian2 opened the list.
      announcements: 1,
    });

    // Linked after everything was added, never opened anything → nothing is new.
    await t.db.delete(s.readCursors).where(eq(s.readCursors.userId, t.fx.users.guardian2.id));
    await t.db
      .update(s.studentGuardians)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(s.studentGuardians.userId, t.fx.users.guardian2.id));
    const later = await summary(guardian2, t.fx.students.s2.id);
    expect(Object.values(later.badges).every((n) => n === 0)).toBe(true);
  });

  it('denies other guardians, teachers outside the class and other schools', async () => {
    const s1 = t.fx.students.s1.id;
    for (const path of ['summary', 'announcements', 'calendar']) {
      expect((await guardian2.get(studentUrl(s1, path))).status).toBe(403);
      expect((await adminB.get(studentUrl(s1, path))).status).toBe(403);
    }
    expect((await guardian2.post(studentUrl(s1, 'seen')).send({ module: 'lessons' })).status).toBe(403);
    expect((await t.anon().get(studentUrl(s1, 'summary'))).status).toBe(401);

    const [s6] = await t.db
      .insert(s.students)
      .values({
        schoolId: t.fx.schoolA.id,
        classSectionId: t.fx.class6a.id,
        gradeLevelId: t.fx.grade6.id,
        code: 'S-6',
        firstName: 'هبة',
        fatherName: 'علي',
        grandfatherName: 'محمد',
        gender: 'female',
        registeredAt: '2025-07-01',
      })
      .returning();
    expect((await teacher.get(studentUrl(s6.id, 'summary'))).status).toBe(403);
    expect((await supervisor.get(studentUrl(s6.id, 'summary'))).status).toBe(200);

    // The guardian's child in school B is reachable, with school B's data only.
    const b = await summary(guardian, t.fx.students.s4.id);
    expect(b.school).toMatchObject({ id: t.fx.schoolB.id });
    expect(b.badges.calendar).toBe(2);
    const bNews = await guardian.get(studentUrl(t.fx.students.s4.id, 'announcements'));
    expect(bNews.body.map((a: { title: string }) => a.title)).toEqual(['مدرسة ب']);
  });

  it('a student without a class still gets a summary (class-based badges are zero)', async () => {
    await t.db.update(s.students).set({ classSectionId: null }).where(eq(s.students.id, t.fx.students.s3.id));
    await t.db
      .insert(s.studentGuardians)
      .values({
        schoolId: t.fx.schoolA.id,
        studentId: t.fx.students.s3.id,
        userId: t.fx.users.guardian.id,
        relation: 'father',
        createdAt: new Date(0),
      })
      .onConflictDoNothing();
    const body = await summary(guardian, t.fx.students.s3.id);
    expect(body.student).toMatchObject({ classLabel: null, code: 'S-3' });
    expect(body.badges).toMatchObject({ lessons: 0, homework: 0, exams: 0 });
    // Grade 5 (admission level) and school-wide announcements still reach the student.
    const list = await guardian.get(studentUrl(t.fx.students.s3.id, 'announcements'));
    const labels = list.body.map((a: { audienceLabel: string }) => a.audienceLabel);
    expect(labels).toContain('إعلان لطلاب الصف الخامس');
    expect(labels).not.toContain('إعلان لطلاب الصف الخامس - أ');
  });
});

describe('demo data', () => {
  it('seeds announcements and calendar events so the demo guardian opens with unread badges', async () => {
    const handle = await connectPglite(null);
    try {
      await handle.migrate();
      const demoToday = todayIn('Africa/Khartoum');
      await seedDemo(handle.db, { today: demoToday });
      await seedCommsDemo(handle.db, { today: demoToday });
      await seedCommsDemo(handle.db, { today: demoToday }); // idempotent

      const schools = await handle.db.select().from(s.schools);
      for (const school of schools) {
        const anns = await handle.db.select().from(s.announcements).where(eq(s.announcements.schoolId, school.id));
        const events = await handle.db.select().from(s.calendarEvents).where(eq(s.calendarEvents.schoolId, school.id));
        expect(anns).toHaveLength(5);
        expect(new Set(anns.map((a) => a.audienceType))).toEqual(
          new Set(['school', 'grade_level', 'class_section', 'student']),
        );
        expect(events.length).toBeGreaterThanOrEqual(7);
      }

      const app = createApp({ db: handle.db, config: { ...t.config } });
      const agent = request.agent(app);
      const phone = DEMO_ACCOUNTS.find((a) => a.role === 'guardian')!.phone;
      expect((await agent.post('/api/auth/login').send({ phone, pin: DEMO_PIN })).status).toBe(200);
      const me = await agent.get('/api/me');
      const children = me.body.children as Array<{ id: string }>;
      expect(children.length).toBeGreaterThan(0);
      const personal: string[] = [];
      for (const child of children) {
        const res = await agent.get(`/api/students/${child.id}/summary`);
        expect(res.status).toBe(200);
        expect(res.body.badges.announcements).toBeGreaterThan(0);
        expect(res.body.badges.calendar).toBeGreaterThan(0);
        const news = await agent.get(`/api/students/${child.id}/announcements`);
        personal.push(
          ...news.body
            .filter((a: { audienceType: string }) => a.audienceType === 'student')
            .map((a: { id: string }) => a.id),
        );
        const cal = await agent.get(`/api/students/${child.id}/calendar`);
        expect(cal.body.events.length + cal.body.upcoming.length).toBeGreaterThan(0);
      }
      // Each demo school sends one personal message to the demo guardian.
      expect(personal).toHaveLength(schools.length);
    } finally {
      await handle.close();
    }
  });
});
