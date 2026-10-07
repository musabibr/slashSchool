import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { countNewExams, countNewResults, seedAssessmentDemo } from '../src/modules/assessment';
import { setupTestApp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.close());

const schoolBase = () => `/api/schools/${t.fx.schoolA.id}`;
const periodsUrl = () => `${schoolBase()}/exam-periods`;
const assessmentsUrl = () => `${schoolBase()}/assessments`;
const studentUrl = (id: string) => `/api/students/${id}`;

const as = (key: keyof TestContext['fx']['users']) => t.loginAs(t.fx.users[key].phone);

interface Sitting {
  id: string;
  classSectionId: string;
  subjectId: string;
  kind: string;
  title: string;
  date: string;
  maxScore: number;
}

async function sittingsOf(periodId: string): Promise<Sitting[]> {
  return t.db
    .select({
      id: s.assessments.id,
      classSectionId: s.assessments.classSectionId,
      subjectId: s.assessments.subjectId,
      kind: s.assessments.kind,
      title: s.assessments.title,
      date: s.assessments.date,
      maxScore: s.assessments.maxScore,
    })
    .from(s.assessments)
    .where(eq(s.assessments.examPeriodId, periodId));
}

async function sitting(periodId: string, classSectionId: string, subjectId: string): Promise<Sitting> {
  const found = (await sittingsOf(periodId)).find(
    (x) => x.classSectionId === classSectionId && x.subjectId === subjectId,
  );
  if (!found) throw new Error('sitting not found');
  return found;
}

async function createPeriod(body: { gradeLevelId?: string; kind?: string; name?: string } = {}) {
  const agent = await as('supervisor');
  const res = await agent
    .post(periodsUrl())
    .send({ gradeLevelId: t.fx.grade5.id, kind: 'monthly', name: 'الامتحانات الشهرية', ...body });
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string; kind: string };
}

async function createQuiz(body: Record<string, unknown> = {}) {
  const agent = await as('teacher');
  const res = await agent.post(assessmentsUrl()).send({
    classSectionId: t.fx.class5a.id,
    subjectId: t.fx.math.id,
    title: 'اختبار الكسور',
    date: '2025-10-12',
    maxScore: 30,
    details: 'صفحة 15 إلى 30',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function auditRows(entity: string, entityId: string) {
  return t.db
    .select()
    .from(s.auditLogs)
    .where(and(eq(s.auditLogs.entity, entity), eq(s.auditLogs.entityId, entityId)));
}

// ───────────────────────────── Exam periods & timetables (S12) ─────────────────────────────

describe('exam periods (S12)', () => {
  it('lets a supervisor create a period for a grade level of the current year', async () => {
    const agent = await as('supervisor');
    const res = await agent
      .post(periodsUrl())
      .send({ gradeLevelId: t.fx.grade5.id, kind: 'monthly', name: '  الامتحانات الشهرية - نوفمبر ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'الامتحانات الشهرية - نوفمبر',
      kind: 'monthly',
      gradeLevelId: t.fx.grade5.id,
      gradeLevelName: 'الصف الخامس',
      academicYearId: t.fx.yearA.id,
      resultsPublishedAt: null,
      subjectCount: 0,
      firstDate: null,
      lastDate: null,
      hasScores: false,
    });
  });

  it('validates the period', async () => {
    const agent = await as('admin');
    const bad = await agent.post(periodsUrl()).send({ gradeLevelId: t.fx.grade5.id, kind: 'yearly', name: '' });
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['kind', 'name']);
    const [gradeB] = await t.db.select().from(s.gradeLevels).where(eq(s.gradeLevels.schoolId, t.fx.schoolB.id));
    const foreign = await agent.post(periodsUrl()).send({ gradeLevelId: gradeB.id, kind: 'term', name: 'x' });
    expect(foreign.status).toBe(404);
  });

  it('is managed by admins and supervisors only', async () => {
    const body = { gradeLevelId: t.fx.grade5.id, kind: 'weekly', name: 'أسبوعي' };
    expect((await (await as('teacher')).post(periodsUrl()).send(body)).status).toBe(403);
    expect((await (await as('guardian')).post(periodsUrl()).send(body)).status).toBe(403);
    expect((await (await as('guardian')).get(periodsUrl())).status).toBe(403);
    expect((await (await as('adminB')).get(periodsUrl())).status).toBe(403);
    expect((await (await as('adminB')).post(periodsUrl()).send(body)).status).toBe(403);
  });

  it('builds the timetable: one sitting per class section × subject', async () => {
    const period = await createPeriod({ name: 'شهري - ديسمبر' });
    const agent = await as('supervisor');
    const res = await agent.put(`${periodsUrl()}/${period.id}/timetable`).send({
      rows: [
        { subjectId: t.fx.arabic.id, date: '2025-12-08', maxScore: 50 },
        { subjectId: t.fx.math.id, date: '2025-12-07', maxScore: 40 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      { subjectId: t.fx.math.id, subjectName: 'الرياضيات', date: '2025-12-07', maxScore: 40 },
      { subjectId: t.fx.arabic.id, subjectName: 'اللغة العربية', date: '2025-12-08', maxScore: 50 },
    ]);
    expect(res.body.period).toMatchObject({ subjectCount: 2, firstDate: '2025-12-07', lastDate: '2025-12-08' });

    const all = await sittingsOf(period.id);
    expect(all).toHaveLength(4); // 5-أ and 5-ب × 2 subjects; 6-أ is another grade
    expect(new Set(all.map((a) => a.classSectionId))).toEqual(new Set([t.fx.class5a.id, t.fx.class5b.id]));
    expect(all.every((a) => a.kind === 'monthly')).toBe(true);
    expect((await sitting(period.id, t.fx.class5b.id, t.fx.math.id)).title).toBe('الرياضيات');

    // Any staff member can read periods and timetables.
    const teacher = await as('teacher');
    const list = await teacher.get(`${periodsUrl()}?gradeLevelId=${t.fx.grade5.id}`);
    expect(list.status).toBe(200);
    expect(list.body.find((p: { id: string }) => p.id === period.id)).toMatchObject({ subjectCount: 2 });
    const other = await teacher.get(`${periodsUrl()}?gradeLevelId=${t.fx.grade6.id}`);
    expect(other.body).toEqual([]);
    const tt = await teacher.get(`${periodsUrl()}/${period.id}/timetable`);
    expect(tt.status).toBe(200);
    expect(tt.body.rows).toHaveLength(2);
    expect(tt.body.period.id).toBe(period.id);
    // …but not change them.
    const put = await teacher.put(`${periodsUrl()}/${period.id}/timetable`).send({ rows: [] });
    expect(put.status).toBe(403);
  });

  it('validates timetable rows', async () => {
    const period = await createPeriod();
    const agent = await as('admin');
    const url = `${periodsUrl()}/${period.id}/timetable`;
    const dup = await agent.put(url).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2025-12-07', maxScore: 40 },
        { subjectId: t.fx.math.id, date: '2025-12-08', maxScore: 40 },
      ],
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details[0]).toMatchObject({ path: 'rows.1.subjectId', message: 'المادة مكررة' });

    const range = await agent.put(url).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2025-12-7', maxScore: 0 },
        { subjectId: t.fx.arabic.id, date: '2025-12-08', maxScore: 1001 },
      ],
    });
    expect(range.status).toBe(400);
    expect(range.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'rows.0.date',
      'rows.0.maxScore',
      'rows.1.maxScore',
    ]);

    const outside = await agent.put(url).send({ rows: [{ subjectId: t.fx.math.id, date: '2026-08-01', maxScore: 50 }] });
    expect(outside.status).toBe(400);
    expect(outside.body.error.details[0].path).toBe('rows.0.date');

    const foreign = await agent.put(url).send({ rows: [{ subjectId: t.fx.mathB.id, date: '2025-12-07', maxScore: 50 }] });
    expect(foreign.status).toBe(404);
    expect(await sittingsOf(period.id)).toHaveLength(0);

    const missing = await agent.put(`${periodsUrl()}/${crypto.randomUUID()}/timetable`).send({ rows: [] });
    expect(missing.status).toBe(404);
  });

  it('updates, adds and removes subjects; protects entered scores', async () => {
    const period = await createPeriod({ name: 'شهري - يناير' });
    const agent = await as('supervisor');
    const url = `${periodsUrl()}/${period.id}/timetable`;
    await agent.put(url).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2026-01-11', maxScore: 50 },
        { subjectId: t.fx.arabic.id, date: '2026-01-12', maxScore: 50 },
      ],
    });
    const mathA = await sitting(period.id, t.fx.class5a.id, t.fx.math.id);

    // Move math, drop arabic (no scores yet), add science.
    const res = await agent.put(url).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2026-01-14', maxScore: 60 },
        { subjectId: t.fx.science.id, date: '2026-01-13', maxScore: 30 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      { subjectId: t.fx.science.id, subjectName: 'العلوم', date: '2026-01-13', maxScore: 30 },
      { subjectId: t.fx.math.id, subjectName: 'الرياضيات', date: '2026-01-14', maxScore: 60 },
    ]);
    const after = await sittingsOf(period.id);
    expect(after).toHaveLength(4);
    expect(after.some((a) => a.subjectId === t.fx.arabic.id)).toBe(false);
    expect(await sitting(period.id, t.fx.class5a.id, t.fx.math.id)).toMatchObject({
      id: mathA.id, // same row, updated in place
      date: '2026-01-14',
      maxScore: 60,
    });

    // Enter a math score, then try to remove math / lower its max below the score / delete the period.
    const scored = await agent
      .put(`${assessmentsUrl()}/${mathA.id}/scores`)
      .send({ scores: [{ studentId: t.fx.students.s1.id, score: 55 }] });
    expect(scored.status).toBe(200);
    const remove = await agent.put(url).send({ rows: [{ subjectId: t.fx.science.id, date: '2026-01-13', maxScore: 30 }] });
    expect(remove.status).toBe(409);
    const lower = await agent.put(url).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2026-01-14', maxScore: 50 },
        { subjectId: t.fx.science.id, date: '2026-01-13', maxScore: 30 },
      ],
    });
    expect(lower.status).toBe(409);
    expect(await sittingsOf(period.id)).toHaveLength(4); // nothing changed
    const del = await agent.delete(`${periodsUrl()}/${period.id}`);
    expect(del.status).toBe(409);
    const list = await agent.get(periodsUrl());
    expect(list.body.find((p: { id: string }) => p.id === period.id).hasScores).toBe(true);
  });

  it('renames a period and carries a new kind to its sittings', async () => {
    const period = await createPeriod({ kind: 'weekly', name: 'أسبوعي' });
    const agent = await as('admin');
    await agent
      .put(`${periodsUrl()}/${period.id}/timetable`)
      .send({ rows: [{ subjectId: t.fx.math.id, date: '2026-02-01', maxScore: 20 }] });
    const res = await agent.patch(`${periodsUrl()}/${period.id}`).send({ name: 'امتحانات الفترة الثانية', kind: 'term' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'امتحانات الفترة الثانية', kind: 'term' });
    expect((await sittingsOf(period.id)).every((a) => a.kind === 'term')).toBe(true);

    const bad = await agent.patch(`${periodsUrl()}/${period.id}`).send({ kind: 'quiz' });
    expect(bad.status).toBe(400);
    expect((await (await as('teacher')).patch(`${periodsUrl()}/${period.id}`).send({ name: 'x' })).status).toBe(403);
    expect((await (await as('adminB')).patch(`${periodsUrl()}/${period.id}`).send({ name: 'x' })).status).toBe(403);
  });

  it('deletes a period without scores', async () => {
    const period = await createPeriod({ name: 'للحذف' });
    const agent = await as('supervisor');
    await agent
      .put(`${periodsUrl()}/${period.id}/timetable`)
      .send({ rows: [{ subjectId: t.fx.math.id, date: '2026-02-02', maxScore: 20 }] });
    expect((await (await as('teacher')).delete(`${periodsUrl()}/${period.id}`)).status).toBe(403);
    const res = await agent.delete(`${periodsUrl()}/${period.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await sittingsOf(period.id)).toHaveLength(0);
    expect((await agent.get(`${periodsUrl()}/${period.id}/timetable`)).status).toBe(404);
  });

  it('publishes and hides results, with an audit trail', async () => {
    const empty = await createPeriod({ name: 'بدون جدول' });
    const agent = await as('admin');
    const noTimetable = await agent.post(`${periodsUrl()}/${empty.id}/publish`).send({ published: true });
    expect(noTimetable.status).toBe(400);
    const invalid = await agent.post(`${periodsUrl()}/${empty.id}/publish`).send({ published: 'yes' });
    expect(invalid.status).toBe(400);

    const period = await createPeriod({ name: 'للنشر' });
    await agent
      .put(`${periodsUrl()}/${period.id}/timetable`)
      .send({ rows: [{ subjectId: t.fx.math.id, date: '2026-02-03', maxScore: 20 }] });
    expect((await (await as('teacher')).post(`${periodsUrl()}/${period.id}/publish`).send({ published: true })).status).toBe(
      403,
    );
    const on = await agent.post(`${periodsUrl()}/${period.id}/publish`).send({ published: true });
    expect(on.status).toBe(200);
    expect(typeof on.body.resultsPublishedAt).toBe('string');
    const again = await agent.post(`${periodsUrl()}/${period.id}/publish`).send({ published: true });
    expect(again.body.resultsPublishedAt).toBe(on.body.resultsPublishedAt);
    const off = await agent.post(`${periodsUrl()}/${period.id}/publish`).send({ published: false });
    expect(off.body.resultsPublishedAt).toBeNull();
    const logs = await auditRows('exam_period', period.id);
    expect(logs.map((l) => l.action).sort()).toEqual(['publish', 'unpublish']);
  });
});

// ───────────────────────────── Staff results view ─────────────────────────────

describe('period results (staff)', () => {
  let periodId: string;

  beforeAll(async () => {
    const period = await createPeriod({ name: 'نتائج - فبراير' });
    periodId = period.id;
    const agent = await as('supervisor');
    await agent.put(`${periodsUrl()}/${periodId}/timetable`).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2026-02-08', maxScore: 50 },
        { subjectId: t.fx.arabic.id, date: '2026-02-09', maxScore: 50 },
      ],
    });
    const math = await sitting(periodId, t.fx.class5a.id, t.fx.math.id);
    const arabic = await sitting(periodId, t.fx.class5a.id, t.fx.arabic.id);
    await agent.put(`${assessmentsUrl()}/${math.id}/scores`).send({
      scores: [
        { studentId: t.fx.students.s1.id, score: 45 },
        { studentId: t.fx.students.s2.id, score: 20 },
      ],
    });
    await agent.put(`${assessmentsUrl()}/${arabic.id}/scores`).send({
      scores: [{ studentId: t.fx.students.s1.id, score: 47 }],
    });
  });

  it('shows students × subjects with computed totals', async () => {
    const agent = await as('admin');
    const res = await agent.get(`${periodsUrl()}/${periodId}/results?classId=${t.fx.class5a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.classes).toEqual([{ id: t.fx.class5a.id, label: 'الصف الخامس - أ' }]);
    expect(res.body.subjects.map((x: { subjectName: string }) => x.subjectName)).toEqual(['الرياضيات', 'اللغة العربية']);
    expect(res.body.students).toHaveLength(3);
    const s1 = res.body.students.find((x: { id: string }) => x.id === t.fx.students.s1.id);
    expect(s1).toMatchObject({ total: 92, max: 100, percentage: 92, grade: 'ممتاز', incomplete: false });
    const s2 = res.body.students.find((x: { id: string }) => x.id === t.fx.students.s2.id);
    expect(s2).toMatchObject({ total: 20, max: 50, percentage: 40, grade: 'ضعيف', incomplete: true });
    const s3 = res.body.students.find((x: { id: string }) => x.id === t.fx.students.s3.id);
    expect(s3).toMatchObject({ total: 0, max: 0, grade: '', incomplete: true });

    const all = await agent.get(`${periodsUrl()}/${periodId}/results`);
    expect(all.body.classes).toHaveLength(2);
    expect(all.body.students).toHaveLength(4);
  });

  it('limits teachers to their classes', async () => {
    const teacher2 = await as('teacher2'); // arabic in 5-أ only
    const own = await teacher2.get(`${periodsUrl()}/${periodId}/results`);
    expect(own.status).toBe(200);
    expect(own.body.classes.map((c: { id: string }) => c.id)).toEqual([t.fx.class5a.id]);
    const other = await teacher2.get(`${periodsUrl()}/${periodId}/results?classId=${t.fx.class5b.id}`);
    expect(other.status).toBe(403);
    const wrongGrade = await (await as('admin')).get(`${periodsUrl()}/${periodId}/results?classId=${t.fx.class6a.id}`);
    expect(wrongGrade.status).toBe(400);
    expect((await (await as('guardian')).get(`${periodsUrl()}/${periodId}/results`)).status).toBe(403);
  });
});

// ───────────────────────────── Quiz announcements (S13) ─────────────────────────────

describe('quiz announcements (S13)', () => {
  it('lets a teacher announce a quiz in their own class + subject', async () => {
    const agent = await as('teacher');
    const res = await agent.post(assessmentsUrl()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.math.id,
      title: ' اختبار الضرب ',
      date: '2025-10-19',
      maxScore: 30,
      details: '',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'quiz',
      title: 'اختبار الضرب',
      date: '2025-10-19',
      maxScore: 30,
      details: null,
      classSectionId: t.fx.class5a.id,
      classLabel: 'الصف الخامس - أ',
      subjectId: t.fx.math.id,
      subjectName: 'الرياضيات',
      examPeriodId: null,
      examPeriodName: null,
      scoredCount: 0,
      studentCount: 3,
    });
  });

  it('denies classes and subjects outside the assignment', async () => {
    const teacher = await as('teacher');
    const base = { title: 'x', date: '2025-10-19', maxScore: 10 };
    const otherClass = await teacher
      .post(assessmentsUrl())
      .send({ ...base, classSectionId: t.fx.class5b.id, subjectId: t.fx.math.id });
    expect(otherClass.status).toBe(403);
    const otherSubject = await teacher
      .post(assessmentsUrl())
      .send({ ...base, classSectionId: t.fx.class5a.id, subjectId: t.fx.arabic.id });
    expect(otherSubject.status).toBe(403);
    const guardian = await (await as('guardian'))
      .post(assessmentsUrl())
      .send({ ...base, classSectionId: t.fx.class5a.id, subjectId: t.fx.math.id });
    expect(guardian.status).toBe(403);
    const foreign = await (await as('adminB'))
      .post(`/api/schools/${t.fx.schoolB.id}/assessments`)
      .send({ ...base, classSectionId: t.fx.class5a.id, subjectId: t.fx.math.id });
    expect(foreign.status).toBe(404);
  });

  it('validates the quiz', async () => {
    const agent = await as('teacher');
    const res = await agent.post(assessmentsUrl()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.math.id,
      title: '  ',
      date: '2025-13-01',
      maxScore: 2.5,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['date', 'maxScore', 'title']);
    const badId = await agent.post(assessmentsUrl()).send({ classSectionId: 'nope', subjectId: t.fx.math.id });
    expect(badId.status).toBe(400);
  });

  it('lists quizzes and sittings within the user scope, newest first', async () => {
    await createQuiz({ title: 'قديم', date: '2025-09-01' });
    const teacher2 = await as('teacher2');
    const arabicQuiz = await teacher2.post(assessmentsUrl()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.arabic.id,
      title: 'إملاء',
      date: '2025-11-30',
      maxScore: 20,
    });
    expect(arabicQuiz.status).toBe(201);

    const teacher = await as('teacher');
    const mine = await teacher.get(`${assessmentsUrl()}?kind=quiz`);
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThan(0);
    expect(mine.body.every((a: { kind: string }) => a.kind === 'quiz')).toBe(true);
    // teacher: math 5-أ and arabic 5-ب only
    expect(
      mine.body.every(
        (a: { classSectionId: string; subjectId: string }) =>
          (a.classSectionId === t.fx.class5a.id && a.subjectId === t.fx.math.id) ||
          (a.classSectionId === t.fx.class5b.id && a.subjectId === t.fx.arabic.id),
      ),
    ).toBe(true);
    expect(mine.body.some((a: { id: string }) => a.id === arabicQuiz.body.id)).toBe(false);
    const dates = mine.body.map((a: { date: string }) => a.date);
    expect([...dates].sort().reverse()).toEqual(dates);

    // The grade-entry picker: quizzes and exam sittings of one class + subject.
    const pair = await teacher.get(`${assessmentsUrl()}?classId=${t.fx.class5a.id}&subjectId=${t.fx.math.id}`);
    expect(pair.body.some((a: { kind: string }) => a.kind === 'quiz')).toBe(true);
    expect(pair.body.some((a: { kind: string; examPeriodName: string | null }) => a.kind !== 'quiz' && a.examPeriodName)).toBe(
      true,
    );

    const admin = await (await as('admin')).get(`${assessmentsUrl()}?kind=quiz&classId=${t.fx.class5a.id}`);
    expect(admin.body.some((a: { id: string }) => a.id === arabicQuiz.body.id)).toBe(true);

    expect((await teacher.get(`${assessmentsUrl()}?kind=exam`)).status).toBe(400);
    expect((await (await as('guardian')).get(assessmentsUrl())).status).toBe(403);
    expect((await (await as('adminB')).get(assessmentsUrl())).status).toBe(403);
  });

  it('reads and edits a quiz in scope only', async () => {
    const quiz = await createQuiz({ title: 'للتعديل' });
    const teacher = await as('teacher');
    const one = await teacher.get(`${assessmentsUrl()}/${quiz.id}`);
    expect(one.status).toBe(200);
    expect(one.body.title).toBe('للتعديل');

    const res = await teacher
      .patch(`${assessmentsUrl()}/${quiz.id}`)
      .send({ title: 'اختبار القسمة', date: '2025-10-26', maxScore: 25, details: 'الوحدة الثالثة' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'اختبار القسمة', date: '2025-10-26', maxScore: 25, details: 'الوحدة الثالثة' });
    const cleared = await teacher.patch(`${assessmentsUrl()}/${quiz.id}`).send({ details: null });
    expect(cleared.body.details).toBeNull();
    expect(cleared.body.title).toBe('اختبار القسمة');

    const teacher2 = await as('teacher2');
    expect((await teacher2.get(`${assessmentsUrl()}/${quiz.id}`)).status).toBe(403);
    expect((await teacher2.patch(`${assessmentsUrl()}/${quiz.id}`).send({ title: 'x' })).status).toBe(403);
    expect((await teacher.patch(`${assessmentsUrl()}/${quiz.id}`).send({ maxScore: 0 })).status).toBe(400);
    // Moving it to a class the teacher does not teach.
    const move = await teacher.patch(`${assessmentsUrl()}/${quiz.id}`).send({ classSectionId: t.fx.class6a.id });
    expect(move.status).toBe(403);
    expect((await (await as('adminB')).get(`${assessmentsUrl()}/${quiz.id}`)).status).toBe(403);
    expect(
      (await (await as('adminB')).get(`/api/schools/${t.fx.schoolB.id}/assessments/${quiz.id}`)).status,
    ).toBe(404);
  });

  it('protects scores when editing or deleting a quiz', async () => {
    const quiz = await createQuiz({ title: 'محمي', maxScore: 30 });
    const teacher = await as('teacher');
    await teacher
      .put(`${assessmentsUrl()}/${quiz.id}/scores`)
      .send({ scores: [{ studentId: t.fx.students.s1.id, score: 28 }] });

    const lower = await teacher.patch(`${assessmentsUrl()}/${quiz.id}`).send({ maxScore: 20 });
    expect(lower.status).toBe(409);
    const ok = await teacher.patch(`${assessmentsUrl()}/${quiz.id}`).send({ maxScore: 28 });
    expect(ok.status).toBe(200);
    const admin = await as('admin');
    const move = await admin.patch(`${assessmentsUrl()}/${quiz.id}`).send({ classSectionId: t.fx.class5b.id });
    expect(move.status).toBe(409);
    expect((await teacher.delete(`${assessmentsUrl()}/${quiz.id}`)).status).toBe(409);

    // Removing the score allows the delete.
    await teacher
      .put(`${assessmentsUrl()}/${quiz.id}/scores`)
      .send({ scores: [{ studentId: t.fx.students.s1.id, score: null }] });
    expect((await (await as('teacher2')).delete(`${assessmentsUrl()}/${quiz.id}`)).status).toBe(403);
    const del = await teacher.delete(`${assessmentsUrl()}/${quiz.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
    expect((await teacher.get(`${assessmentsUrl()}/${quiz.id}`)).status).toBe(404);
  });

  it('edits exam sittings only through the timetable', async () => {
    const period = await createPeriod({ name: 'جلسات' });
    const admin = await as('admin');
    await admin
      .put(`${periodsUrl()}/${period.id}/timetable`)
      .send({ rows: [{ subjectId: t.fx.math.id, date: '2026-03-01', maxScore: 50 }] });
    const row = await sitting(period.id, t.fx.class5a.id, t.fx.math.id);
    expect((await admin.patch(`${assessmentsUrl()}/${row.id}`).send({ title: 'x' })).status).toBe(400);
    expect((await admin.delete(`${assessmentsUrl()}/${row.id}`)).status).toBe(400);
  });
});

// ───────────────────────────── Grade entry (S14 / T7) ─────────────────────────────

describe('grade entry (S14 / T7)', () => {
  let quizId: string;
  beforeAll(async () => {
    quizId = (await createQuiz({ title: 'رصد', maxScore: 30 })).id;
  });

  it('returns the class roster with empty scores', async () => {
    const res = await (await as('teacher')).get(`${assessmentsUrl()}/${quizId}/scores`);
    expect(res.status).toBe(200);
    expect(res.body.assessment).toMatchObject({ id: quizId, maxScore: 30, scoredCount: 0, studentCount: 3 });
    expect(res.body.students).toHaveLength(3);
    expect(res.body.students.every((x: { score: number | null }) => x.score === null)).toBe(true);
    expect(res.body.students[0]).toHaveProperty('code');
  });

  it('saves scores, removes with null, and audits each change once', async () => {
    const teacher = await as('teacher');
    const url = `${assessmentsUrl()}/${quizId}/scores`;
    const res = await teacher.put(url).send({
      scores: [
        { studentId: t.fx.students.s1.id, score: 25 },
        { studentId: t.fx.students.s2.id, score: 18.456 },
        { studentId: t.fx.students.s3.id, score: null },
      ],
    });
    expect(res.status).toBe(200);
    const byId = new Map(res.body.students.map((x: { id: string; score: number | null }) => [x.id, x.score]));
    expect(byId.get(t.fx.students.s1.id)).toBe(25);
    expect(byId.get(t.fx.students.s2.id)).toBe(18.46);
    expect(byId.get(t.fx.students.s3.id)).toBeNull();
    expect(res.body.assessment.scoredCount).toBe(2);

    let logs = await auditRows('assessment_scores', quizId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'create', actorId: t.fx.users.teacher.id });
    expect(logs[0].after).toEqual({ [t.fx.students.s1.id]: 25, [t.fx.students.s2.id]: 18.46 });

    // Same save again: nothing changes, no new audit row.
    await teacher.put(url).send({ scores: [{ studentId: t.fx.students.s1.id, score: 25 }] });
    expect(await auditRows('assessment_scores', quizId)).toHaveLength(1);

    const edit = await (await as('supervisor')).put(url).send({
      scores: [
        { studentId: t.fx.students.s1.id, score: 27 },
        { studentId: t.fx.students.s2.id, score: null },
      ],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.assessment.scoredCount).toBe(1);
    logs = await auditRows('assessment_scores', quizId);
    expect(logs).toHaveLength(2);
    const update = logs.find((l) => l.action === 'update')!;
    expect(update.before).toEqual({ [t.fx.students.s1.id]: 25, [t.fx.students.s2.id]: 18.46 });
    expect(update.after).toEqual({ [t.fx.students.s1.id]: 27, [t.fx.students.s2.id]: null });
    const [stored] = await t.db
      .select()
      .from(s.scores)
      .where(and(eq(s.scores.assessmentId, quizId), eq(s.scores.studentId, t.fx.students.s1.id)));
    expect(stored).toMatchObject({ score: 27, enteredBy: t.fx.users.supervisor.id });
  });

  it('validates scores against the max and the class', async () => {
    const teacher = await as('teacher');
    const url = `${assessmentsUrl()}/${quizId}/scores`;
    const high = await teacher.put(url).send({
      scores: [
        { studentId: t.fx.students.s1.id, score: 10 },
        { studentId: t.fx.students.s2.id, score: 31 },
      ],
    });
    expect(high.status).toBe(400);
    expect(high.body.error.details).toEqual([{ path: 'scores.1.score', message: 'الدرجة يجب ألا تتجاوز 30' }]);
    const negative = await teacher.put(url).send({ scores: [{ studentId: t.fx.students.s1.id, score: -1 }] });
    expect(negative.status).toBe(400);
    expect(negative.body.error.details[0].path).toBe('scores.0.score');
    const text = await teacher.put(url).send({ scores: [{ studentId: t.fx.students.s1.id, score: '12' }] });
    expect(text.status).toBe(400);
    const dup = await teacher.put(url).send({
      scores: [
        { studentId: t.fx.students.s1.id, score: 1 },
        { studentId: t.fx.students.s1.id, score: 2 },
      ],
    });
    expect(dup.status).toBe(400);
    const otherClass = await teacher.put(url).send({ scores: [{ studentId: t.fx.students.s5.id, score: 5 }] });
    expect(otherClass.status).toBe(400);
    const otherSchool = await teacher.put(url).send({ scores: [{ studentId: t.fx.students.s4.id, score: 5 }] });
    expect(otherSchool.status).toBe(400);
    expect((await teacher.put(url).send({})).status).toBe(400);
    // Nothing was written by the rejected saves.
    const sheet = await teacher.get(url);
    expect(sheet.body.students.find((x: { id: string }) => x.id === t.fx.students.s1.id).score).toBe(27);
  });

  it('denies grade entry outside the assignment', async () => {
    const url = `${assessmentsUrl()}/${quizId}/scores`;
    const body = { scores: [{ studentId: t.fx.students.s1.id, score: 1 }] };
    expect((await (await as('teacher2')).get(url)).status).toBe(403);
    expect((await (await as('teacher2')).put(url).send(body)).status).toBe(403);
    expect((await (await as('guardian')).get(url)).status).toBe(403);
    expect((await (await as('guardian')).put(url).send(body)).status).toBe(403);
    expect((await (await as('adminB')).put(url).send(body)).status).toBe(403);
    expect(
      (await (await as('adminB')).put(`/api/schools/${t.fx.schoolB.id}/assessments/${quizId}/scores`).send(body)).status,
    ).toBe(404);
  });
});

// ───────────────────────────── Guardian (P10–P13) ─────────────────────────────

describe('guardian exams and results (P10–P13)', () => {
  let studentId: string;
  let periodId: string;
  let gradedQuizId: string;
  let pendingQuizId: string;

  beforeAll(async () => {
    // A dedicated grade-6 period and quizzes so earlier tests do not interfere.
    const [s6] = await t.db
      .insert(s.students)
      .values({
        schoolId: t.fx.schoolA.id,
        classSectionId: t.fx.class6a.id,
        gradeLevelId: t.fx.grade6.id,
        code: 'S-60',
        firstName: 'هبة',
        fatherName: 'إبراهيم',
        grandfatherName: 'عبدالله',
        gender: 'female',
        registeredAt: '2025-07-01',
      })
      .returning();
    await t.db.insert(s.studentGuardians).values({
      schoolId: t.fx.schoolA.id,
      studentId: s6.id,
      userId: t.fx.users.guardian2.id,
      relation: 'mother',
      isPrimary: true,
    });
    const admin = await as('admin');
    const period = await admin
      .post(periodsUrl())
      .send({ gradeLevelId: t.fx.grade6.id, kind: 'term', name: 'امتحانات الفترة الأولى' });
    periodId = period.body.id;
    await admin.put(`${periodsUrl()}/${periodId}/timetable`).send({
      rows: [
        { subjectId: t.fx.math.id, date: '2025-11-02', maxScore: 100 },
        { subjectId: t.fx.arabic.id, date: '2025-11-03', maxScore: 100 },
        { subjectId: t.fx.science.id, date: '2025-11-04', maxScore: 30 },
      ],
    });
    const score = async (subjectId: string, value: number) => {
      const row = await sitting(periodId, t.fx.class6a.id, subjectId);
      await admin.put(`${assessmentsUrl()}/${row.id}/scores`).send({ scores: [{ studentId: s6.id, score: value }] });
    };
    await score(t.fx.math.id, 60);
    await score(t.fx.arabic.id, 80);

    const quiz = (title: string, date: string) =>
      admin.post(assessmentsUrl()).send({
        classSectionId: t.fx.class6a.id,
        subjectId: t.fx.math.id,
        title,
        date,
        maxScore: 30,
        details: 'سورة النور 1-50',
      });
    gradedQuizId = (await quiz('اختبار مادة الرياضيات', '2025-10-05')).body.id;
    pendingQuizId = (await quiz('اختبار قادم', '2025-10-20')).body.id;
    await admin
      .put(`${assessmentsUrl()}/${gradedQuizId}/scores`)
      .send({ scores: [{ studentId: s6.id, score: 15 }] });
    studentId = s6.id;
  });

  it('lists quiz announcements (newest first, score once graded) and exam timetables', async () => {
    const guardian2 = await as('guardian2');
    const res = await guardian2.get(`${studentUrl(studentId)}/exams`);
    expect(res.status).toBe(200);
    expect(res.body.quizzes.map((q: { id: string }) => q.id)).toEqual([pendingQuizId, gradedQuizId]);
    expect(res.body.quizzes[1]).toEqual({
      id: gradedQuizId,
      subjectName: 'الرياضيات',
      title: 'اختبار مادة الرياضيات',
      date: '2025-10-05',
      details: 'سورة النور 1-50',
      maxScore: 30,
      score: 15,
    });
    expect(res.body.quizzes[0].score).toBeNull();
    expect(res.body.timetables).toEqual([
      {
        periodId,
        name: 'امتحانات الفترة الأولى',
        kind: 'term',
        rows: [
          { subjectName: 'الرياضيات', date: '2025-11-02', weekday: 0 },
          { subjectName: 'اللغة العربية', date: '2025-11-03', weekday: 1 },
          { subjectName: 'العلوم', date: '2025-11-04', weekday: 2 },
        ],
      },
    ]);
    const [cursor] = await t.db
      .select()
      .from(s.readCursors)
      .where(
        and(
          eq(s.readCursors.userId, t.fx.users.guardian2.id),
          eq(s.readCursors.studentId, studentId),
          eq(s.readCursors.module, 'exams'),
        ),
      );
    expect(cursor).toBeDefined();
  });

  it('hides unpublished period results from guardians but shows graded quizzes', async () => {
    const guardian2 = await as('guardian2');
    const res = await guardian2.get(`${studentUrl(studentId)}/results`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        type: 'quiz',
        id: gradedQuizId,
        title: 'اختبار مادة الرياضيات',
        subjectName: 'الرياضيات',
        date: '2025-10-05',
        score: 15,
        maxScore: 30,
      },
    ]);
    expect((await guardian2.get(`${studentUrl(studentId)}/results/${periodId}`)).status).toBe(404);

    // Staff (admin student profile) see the unpublished period, flagged, and its sheet.
    const admin = await as('admin');
    const staff = await admin.get(`${studentUrl(studentId)}/results`);
    expect(staff.body[0]).toMatchObject({ type: 'period', id: periodId, date: '2025-11-04', published: false });
    expect((await admin.get(`${studentUrl(studentId)}/results/${periodId}`)).status).toBe(200);
    // Staff viewing must not clear the guardian's badge.
    const cursors = await t.db
      .select()
      .from(s.readCursors)
      .where(and(eq(s.readCursors.studentId, studentId), eq(s.readCursors.userId, t.fx.users.admin.id)));
    expect(cursors).toHaveLength(0);
  });

  it('shows the published result sheet with totals, percentage and grade', async () => {
    await (await as('admin')).post(`${periodsUrl()}/${periodId}/publish`).send({ published: true });
    const guardian2 = await as('guardian2');
    const list = await guardian2.get(`${studentUrl(studentId)}/results`);
    expect(list.body.map((r: { type: string }) => r.type)).toEqual(['period', 'quiz']);
    expect(list.body[0]).toMatchObject({ id: periodId, name: 'امتحانات الفترة الأولى', kind: 'term', published: true });
    expect(typeof list.body[0].publishedAt).toBe('string');

    const res = await guardian2.get(`${studentUrl(studentId)}/results/${periodId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      period: { id: periodId, name: 'امتحانات الفترة الأولى', kind: 'term' },
      rows: [
        { subjectName: 'الرياضيات', score: 60, maxScore: 100 },
        { subjectName: 'اللغة العربية', score: 80, maxScore: 100 },
        { subjectName: 'العلوم', score: null, maxScore: 30 },
      ],
      total: 140,
      max: 200,
      percentage: 70,
      grade: 'جيد',
      incomplete: true,
    });
  });

  it('uses the school grade bands', async () => {
    await t.db
      .update(s.schools)
      .set({
        gradeBands: [
          { min: 65, label: 'جيد جداً' },
          { min: 0, label: 'راسب' },
        ],
      })
      .where(eq(s.schools.id, t.fx.schoolA.id));
    const res = await (await as('guardian2')).get(`${studentUrl(studentId)}/results/${periodId}`);
    expect(res.body.grade).toBe('جيد جداً');
    await t.db.update(s.schools).set({ gradeBands: null }).where(eq(s.schools.id, t.fx.schoolA.id));
  });

  it("denies another student's guardian and unknown periods", async () => {
    const guardian = await as('guardian'); // parent of s1 and s4, not of this student
    expect((await guardian.get(`${studentUrl(studentId)}/exams`)).status).toBe(403);
    expect((await guardian.get(`${studentUrl(studentId)}/results`)).status).toBe(403);
    expect((await guardian.get(`${studentUrl(studentId)}/results/${periodId}`)).status).toBe(403);
    // s1 (5-أ) has no sitting in this grade-6 period.
    expect((await guardian.get(`${studentUrl(t.fx.students.s1.id)}/results/${periodId}`)).status).toBe(404);
    // A school-B student cannot open a school-A period.
    expect((await guardian.get(`${studentUrl(t.fx.students.s4.id)}/results/${periodId}`)).status).toBe(404);
    expect((await guardian.get(`${studentUrl(t.fx.students.s1.id)}/results/not-a-uuid`)).status).toBe(400);
    expect((await (await as('adminB')).get(`${studentUrl(studentId)}/results`)).status).toBe(403);
    // Teachers who do not teach the class cannot open the student.
    expect((await (await as('teacher')).get(`${studentUrl(studentId)}/results`)).status).toBe(403);
  });

  it('marks results as seen for guardians', async () => {
    await (await as('guardian2')).get(`${studentUrl(studentId)}/results`);
    const [cursor] = await t.db
      .select()
      .from(s.readCursors)
      .where(
        and(
          eq(s.readCursors.userId, t.fx.users.guardian2.id),
          eq(s.readCursors.studentId, studentId),
          eq(s.readCursors.module, 'results'),
        ),
      );
    expect(cursor).toBeDefined();
  });

  it('counts new exams and results for the home badges', async () => {
    const [student] = await t.db.select().from(s.students).where(eq(s.students.id, studentId));
    const longAgo = new Date(0);
    expect(await countNewExams(t.db, student, longAgo)).toBe(3); // 2 quizzes + 1 period
    expect(await countNewResults(t.db, student, longAgo)).toBe(2); // 1 graded quiz + 1 published period
    const now = new Date(Date.now() + 1000);
    expect(await countNewExams(t.db, student, now)).toBe(0);
    expect(await countNewResults(t.db, student, now)).toBe(0);
  });

  it('returns empty lists for a student not placed in a class', async () => {
    await t.db.update(s.students).set({ classSectionId: null }).where(eq(s.students.id, t.fx.students.s2.id));
    const guardian2 = await as('guardian2');
    const res = await guardian2.get(`${studentUrl(t.fx.students.s2.id)}/exams`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quizzes: [], timetables: [] });
    // Scores entered while in 5-أ still show in the results list.
    const results = await guardian2.get(`${studentUrl(t.fx.students.s2.id)}/results`);
    expect(results.status).toBe(200);
    await t.db
      .update(s.students)
      .set({ classSectionId: t.fx.class5a.id })
      .where(eq(s.students.id, t.fx.students.s2.id));
  });
});

// ───────────────────────────── Demo data ─────────────────────────────

describe('demo data', () => {
  let demo: TestContext;
  beforeAll(async () => {
    demo = await setupTestApp();
    await seedAssessmentDemo(demo.db, { today: '2026-03-15' });
  });
  afterAll(() => demo.close());

  it('prefills periods, quizzes and scores the guardian can browse', async () => {
    const guardian = await demo.loginAs(demo.fx.users.guardian.phone);
    const exams = await guardian.get(`${studentUrl(demo.fx.students.s1.id)}/exams`);
    expect(exams.status).toBe(200);
    expect(exams.body.timetables.map((p: { kind: string }) => p.kind).sort()).toEqual(['monthly', 'term', 'weekly']);
    expect(exams.body.quizzes.length).toBeGreaterThan(0);
    expect(exams.body.quizzes.some((q: { score: number | null }) => q.score !== null)).toBe(true);
    expect(exams.body.quizzes.some((q: { score: number | null }) => q.score === null)).toBe(true);

    const results = await guardian.get(`${studentUrl(demo.fx.students.s1.id)}/results`);
    const periods = results.body.filter((r: { type: string }) => r.type === 'period');
    expect(periods).toHaveLength(1); // only the published monthly exams
    expect(periods[0].kind).toBe('monthly');
    const sheet = await guardian.get(`${studentUrl(demo.fx.students.s1.id)}/results/${periods[0].id}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.incomplete).toBe(false);
    expect(sheet.body.grade).not.toBe('');

    // School B gets its own data too.
    const b = await guardian.get(`${studentUrl(demo.fx.students.s4.id)}/exams`);
    expect(b.body.timetables.length).toBe(3);

    // Staff can publish the graded weekly exam.
    const admin = await demo.loginAs(demo.fx.users.admin.phone);
    const list = await admin.get(`/api/schools/${demo.fx.schoolA.id}/exam-periods?gradeLevelId=${demo.fx.grade5.id}`);
    const weekly = list.body.find((p: { kind: string }) => p.kind === 'weekly');
    expect(weekly).toMatchObject({ resultsPublishedAt: null, hasScores: true });
  });
});
