import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { addDays, todayIn } from '@slash/shared';
import * as s from '../src/db/schema';
import { setupTestApp, type TestContext } from './helpers';

let t: TestContext;
let today: string;
const PAST = '2025-10-05';

beforeAll(async () => {
  t = await setupTestApp();
  today = todayIn(t.fx.schoolA.timezone);
});
afterAll(() => t.close());

const schoolA = () => `/api/schools/${t.fx.schoolA.id}`;
const schoolB = () => `/api/schools/${t.fx.schoolB.id}`;

async function newRegulation(schoolId: string, title: string, defaultPenalty: string | null = null, code?: string) {
  const [row] = await t.db.insert(s.regulations).values({ schoolId, title, defaultPenalty, code }).returning();
  return row;
}

async function auditRows(entityId: string) {
  return t.db
    .select()
    .from(s.auditLogs)
    .where(and(eq(s.auditLogs.entity, 'behavior_incident'), eq(s.auditLogs.entityId, entityId)));
}

// ───────────────────────────── Regulations ─────────────────────────────

describe('regulations catalog', () => {
  let regId: string;

  it('a supervisor adds a regulation (trimmed, optional fields null)', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent
      .post(`${schoolA()}/regulations`)
      .send({ code: ' 10 ', title: '  التأخر عن الطابور  ', defaultPenalty: 'تنبيه شفهي' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      code: '10',
      title: 'التأخر عن الطابور',
      defaultPenalty: 'تنبيه شفهي',
      incidentCount: 0,
    });
    regId = res.body.id;

    const admin = await t.loginAs(t.fx.users.admin.phone);
    const bare = await admin.post(`${schoolA()}/regulations`).send({ title: 'عدم إحضار الكتب', defaultPenalty: '' });
    expect(bare.status).toBe(201);
    expect(bare.body).toMatchObject({ code: null, defaultPenalty: null });
    const two = await admin.post(`${schoolA()}/regulations`).send({ code: '2', title: 'الزي المدرسي' });
    expect(two.status).toBe(201);
  });

  it('lists the catalog for any staff, ordered by code (numeric) then title', async () => {
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    const res = await teacher.get(`${schoolA()}/regulations`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { title: string }) => r.title)).toEqual([
      'الزي المدرسي',
      'التأخر عن الطابور',
      'عدم إحضار الكتب',
    ]);
  });

  it('validates input', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const missing = await agent.post(`${schoolA()}/regulations`).send({ title: '   ' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('title');
    const tooLong = await agent.post(`${schoolA()}/regulations`).send({ title: 'x', code: 'c'.repeat(31) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.details[0].path).toBe('code');
    const empty = await agent.patch(`${schoolA()}/regulations/${regId}`).send({});
    expect(empty.status).toBe(400);
    const badId = await agent.patch(`${schoolA()}/regulations/not-a-uuid`).send({ title: 'x' });
    expect(badId.status).toBe(400);
  });

  it('rejects a duplicate code or title in the same school (409) but allows them in another school', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const dupCode = await agent.post(`${schoolA()}/regulations`).send({ code: '10', title: 'جديدة' });
    expect(dupCode.status).toBe(409);
    const dupTitle = await agent.post(`${schoolA()}/regulations`).send({ title: 'التأخر عن الطابور' });
    expect(dupTitle.status).toBe(409);

    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    const other = await adminB.post(`${schoolB()}/regulations`).send({ code: '10', title: 'التأخر عن الطابور' });
    expect(other.status).toBe(201);
  });

  it('edits a regulation; null clears an optional field; renaming onto another title is a conflict', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent
      .patch(`${schoolA()}/regulations/${regId}`)
      .send({ title: 'التأخر عن الطابور الصباحي', defaultPenalty: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: regId, code: '10', title: 'التأخر عن الطابور الصباحي', defaultPenalty: null });
    const same = await agent.patch(`${schoolA()}/regulations/${regId}`).send({ code: '10' });
    expect(same.status).toBe(200);
    const clash = await agent.patch(`${schoolA()}/regulations/${regId}`).send({ title: 'الزي المدرسي' });
    expect(clash.status).toBe(409);
    await agent.patch(`${schoolA()}/regulations/${regId}`).send({ defaultPenalty: 'تنبيه شفهي' });
  });

  it('only admins and supervisors manage the catalog', async () => {
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    expect((await teacher.post(`${schoolA()}/regulations`).send({ title: 'x' })).status).toBe(403);
    expect((await teacher.patch(`${schoolA()}/regulations/${regId}`).send({ title: 'x' })).status).toBe(403);
    expect((await teacher.delete(`${schoolA()}/regulations/${regId}`)).status).toBe(403);

    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    expect((await guardian.get(`${schoolA()}/regulations`)).status).toBe(403);
    expect((await guardian.post(`${schoolA()}/regulations`).send({ title: 'x' })).status).toBe(403);
  });

  it("another school's admin cannot read or change the catalog", async () => {
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`${schoolA()}/regulations`)).status).toBe(403);
    expect((await adminB.post(`${schoolA()}/regulations`).send({ title: 'x' })).status).toBe(403);
    // Through their own school, school A's regulation does not exist.
    expect((await adminB.patch(`${schoolB()}/regulations/${regId}`).send({ title: 'x' })).status).toBe(404);
    expect((await adminB.delete(`${schoolB()}/regulations/${regId}`)).status).toBe(404);
    const listB = await adminB.get(`${schoolB()}/regulations`);
    expect(listB.body.map((r: { id: string }) => r.id)).not.toContain(regId);
  });

  it('deletes an unused regulation, and refuses (409) while incidents use it', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const unused = await newRegulation(t.fx.schoolA.id, 'لائحة للحذف');
    const del = await agent.delete(`${schoolA()}/regulations/${unused.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
    expect((await agent.delete(`${schoolA()}/regulations/${unused.id}`)).status).toBe(404);

    const used = await newRegulation(t.fx.schoolA.id, 'لائحة مستخدمة');
    await t.db
      .insert(s.behaviorIncidents)
      .values({ schoolId: t.fx.schoolA.id, studentId: t.fx.students.s3.id, regulationId: used.id, date: PAST });
    const refused = await agent.delete(`${schoolA()}/regulations/${used.id}`);
    expect(refused.status).toBe(409);
    const list = await agent.get(`${schoolA()}/regulations`);
    expect(list.body.find((r: { id: string }) => r.id === used.id).incidentCount).toBe(1);
  });
});

// ───────────────────────────── Incidents ─────────────────────────────

describe('behavior incidents (S15)', () => {
  let reg: typeof s.regulations.$inferSelect;
  let regB: typeof s.regulations.$inferSelect;
  let incidentId: string;

  beforeAll(async () => {
    reg = await newRegulation(t.fx.schoolA.id, 'إثارة الفوضى داخل الفصل', 'إنذار كتابي', '6');
    regB = await newRegulation(t.fx.schoolB.id, 'لائحة المدرسة ب', 'تنبيه');
  });

  it('records an incident: date defaults to today, penalty to the regulation default; audited', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: reg.id, details: '  الحديث أثناء الشرح ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      studentId: t.fx.students.s1.id,
      studentName: 'مصعب إبراهيم عبدالله',
      classLabel: 'الصف الخامس - أ',
      regulationId: reg.id,
      regulationTitle: 'إثارة الفوضى داخل الفصل',
      date: today,
      details: 'الحديث أثناء الشرح',
      penalty: 'إنذار كتابي',
      recordedByName: 'مشرف أ',
      createdAt: expect.any(String),
    });
    incidentId = res.body.id;
    const logs = await auditRows(incidentId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'create', actorId: t.fx.users.supervisor.id, schoolId: t.fx.schoolA.id });
    expect(logs[0].after).toMatchObject({ studentId: t.fx.students.s1.id, penalty: 'إنذار كتابي', date: today });
  });

  it('an explicit penalty overrides the default; an empty one records a violation without penalty', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const custom = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: reg.id, date: PAST, penalty: 'استدعاء ولي الأمر' });
    expect(custom.status).toBe(201);
    expect(custom.body).toMatchObject({ date: PAST, penalty: 'استدعاء ولي الأمر', details: null });
    const none = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s2.id, regulationId: reg.id, date: '2025-09-01', penalty: '' });
    expect(none.status).toBe(201);
    expect(none.body.penalty).toBeNull();
    const s5 = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s5.id, regulationId: reg.id, date: '2025-11-01' });
    expect(s5.status).toBe(201);
    expect(s5.body.classLabel).toBe('الصف الخامس - ب');
  });

  it('validates input and dates', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const missing = await agent.post(`${schoolA()}/behavior`).send({ studentId: t.fx.students.s1.id });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.map((d: { path: string }) => d.path)).toContain('regulationId');
    const badDate = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: reg.id, date: '2025-02-30' });
    expect(badDate.status).toBe(400);
    const future = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: reg.id, date: addDays(today, 1) });
    expect(future.status).toBe(400);
    const longDetails = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: reg.id, details: 'x'.repeat(2001) });
    expect(longDetails.status).toBe(400);
  });

  it('the student and the regulation must belong to the school', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const otherStudent = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s4.id, regulationId: reg.id });
    expect(otherStudent.status).toBe(404);
    const otherReg = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: regB.id });
    expect(otherReg.status).toBe(404);
  });

  it('lists incidents newest first with filters', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const all = await agent.get(`${schoolA()}/behavior`);
    expect(all.status).toBe(200);
    const dates = all.body.map((i: { date: string }) => i.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(all.body.every((i: { studentId: string }) => i.studentId !== t.fx.students.s4.id)).toBe(true);

    const byStudent = await agent.get(`${schoolA()}/behavior?studentId=${t.fx.students.s1.id}`);
    expect(byStudent.body).toHaveLength(2);
    expect(byStudent.body[0].id).toBe(incidentId);

    const byClass = await agent.get(`${schoolA()}/behavior?classId=${t.fx.class5b.id}`);
    expect(byClass.body.map((i: { studentId: string }) => i.studentId)).toEqual([t.fx.students.s5.id]);

    const range = await agent.get(`${schoolA()}/behavior?from=2025-09-01&to=2025-10-31`);
    expect(range.body.map((i: { date: string }) => i.date).sort()).toEqual(['2025-09-01', PAST, PAST].sort());

    const limited = await agent.get(`${schoolA()}/behavior?limit=1&studentId=&classId=`);
    expect(limited.body).toHaveLength(1);

    expect((await agent.get(`${schoolA()}/behavior?limit=0`)).status).toBe(400);
    expect((await agent.get(`${schoolA()}/behavior?from=2025-10-10&to=2025-10-01`)).status).toBe(400);
    expect((await agent.get(`${schoolA()}/behavior?classId=${t.fx.classB.id}`)).status).toBe(404);
    expect((await agent.get(`${schoolA()}/behavior?studentId=${t.fx.students.s4.id}`)).status).toBe(404);
  });

  it('teachers and guardians cannot list, record or delete incidents', async () => {
    for (const phone of [t.fx.users.teacher.phone, t.fx.users.guardian.phone]) {
      const agent = await t.loginAs(phone);
      expect((await agent.get(`${schoolA()}/behavior`)).status).toBe(403);
      const post = await agent
        .post(`${schoolA()}/behavior`)
        .send({ studentId: t.fx.students.s1.id, regulationId: reg.id });
      expect(post.status).toBe(403);
      expect((await agent.delete(`${schoolA()}/behavior/${incidentId}`)).status).toBe(403);
    }
  });

  it("another school's admin cannot reach school A's incidents", async () => {
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`${schoolA()}/behavior`)).status).toBe(403);
    const post = await adminB
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: reg.id });
    expect(post.status).toBe(403);
    // Through their own school: neither the student nor the incident exists there.
    const viaB = await adminB
      .post(`${schoolB()}/behavior`)
      .send({ studentId: t.fx.students.s1.id, regulationId: regB.id });
    expect(viaB.status).toBe(404);
    expect((await adminB.delete(`${schoolB()}/behavior/${incidentId}`)).status).toBe(404);
    const listB = await adminB.get(`${schoolB()}/behavior`);
    expect(listB.status).toBe(200);
    expect(listB.body).toEqual([]);
  });

  it('deletes an incident with an audit entry', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const created = await agent
      .post(`${schoolA()}/behavior`)
      .send({ studentId: t.fx.students.s3.id, regulationId: reg.id, date: PAST });
    const res = await agent.delete(`${schoolA()}/behavior/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const logs = await auditRows(created.body.id);
    expect(logs.map((l) => l.action).sort()).toEqual(['create', 'delete']);
    expect(logs.find((l) => l.action === 'delete')!.before).toMatchObject({ studentId: t.fx.students.s3.id });
    expect((await agent.delete(`${schoolA()}/behavior/${created.body.id}`)).status).toBe(404);
  });
});

// ───────────────────────────── Evaluations ─────────────────────────────

describe('student evaluation (S17 / T9)', () => {
  const url = () => `${schoolA()}/evaluations`;
  const query = (classId: string, subjectId: string, date: string) =>
    `${url()}?classId=${classId}&subjectId=${subjectId}&date=${date}`;

  async function evaluationRows(studentId: string, date: string) {
    return t.db
      .select()
      .from(s.evaluations)
      .where(and(eq(s.evaluations.studentId, studentId), eq(s.evaluations.date, date)));
  }

  it('a teacher rates students of their class/subject', async () => {
    const agent = await t.loginAs(t.fx.users.teacher.phone);
    const res = await agent.put(url()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.math.id,
      date: PAST,
      items: [
        { studentId: t.fx.students.s1.id, rating: 'excellent', comment: ' مشاركة ممتازة ' },
        { studentId: t.fx.students.s2.id, rating: 'calm' },
        { studentId: t.fx.students.s3.id, rating: null },
      ],
    });
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((e: { studentId: string }) => [e.studentId, e]));
    expect(res.body).toHaveLength(2);
    expect(byId.get(t.fx.students.s1.id)).toEqual({
      studentId: t.fx.students.s1.id,
      rating: 'excellent',
      comment: 'مشاركة ممتازة',
    });
    expect(byId.get(t.fx.students.s2.id)).toEqual({ studentId: t.fx.students.s2.id, rating: 'calm', comment: null });

    const get = await agent.get(query(t.fx.class5a.id, t.fx.math.id, PAST));
    expect(get.status).toBe(200);
    expect(get.body).toEqual(res.body);
    const [row] = await evaluationRows(t.fx.students.s1.id, PAST);
    expect(row).toMatchObject({ teacherId: t.fx.users.teacher.id, schoolId: t.fx.schoolA.id, subjectId: t.fx.math.id });

    // Another subject / day is separate.
    expect((await agent.get(query(t.fx.class5a.id, t.fx.math.id, '2025-10-06'))).body).toEqual([]);
  });

  it('upserts: changed rows are updated, unchanged rows keep their evaluator, null deletes', async () => {
    const supervisor = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await supervisor.put(url()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.math.id,
      date: PAST,
      items: [
        { studentId: t.fx.students.s1.id, rating: 'excellent', comment: 'مشاركة ممتازة' },
        { studentId: t.fx.students.s2.id, rating: null },
        { studentId: t.fx.students.s3.id, rating: 'disruptive', comment: 'كثير الحديث' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((e: { studentId: string }) => e.studentId).sort()).toEqual(
      [t.fx.students.s1.id, t.fx.students.s3.id].sort(),
    );
    const [s1] = await evaluationRows(t.fx.students.s1.id, PAST);
    expect(s1.teacherId).toBe(t.fx.users.teacher.id);
    const [s3] = await evaluationRows(t.fx.students.s3.id, PAST);
    expect(s3).toMatchObject({ teacherId: t.fx.users.supervisor.id, rating: 'disruptive', comment: 'كثير الحديث' });
    expect(await evaluationRows(t.fx.students.s2.id, PAST)).toHaveLength(0);

    const changed = await supervisor.put(url()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.math.id,
      date: PAST,
      items: [{ studentId: t.fx.students.s1.id, rating: 'calm', comment: null }],
    });
    expect(changed.status).toBe(200);
    const [after] = await evaluationRows(t.fx.students.s1.id, PAST);
    expect(after).toMatchObject({ rating: 'calm', comment: null, teacherId: t.fx.users.supervisor.id });
    // An empty list is a no-op.
    const empty = await supervisor
      .put(url())
      .send({ classSectionId: t.fx.class5a.id, subjectId: t.fx.math.id, date: PAST, items: [] });
    expect(empty.status).toBe(200);
    expect(empty.body).toHaveLength(2);
  });

  it('validates input', async () => {
    const agent = await t.loginAs(t.fx.users.teacher.phone);
    const base = { classSectionId: t.fx.class5a.id, subjectId: t.fx.math.id, date: PAST };
    const badRating = await agent
      .put(url())
      .send({ ...base, items: [{ studentId: t.fx.students.s1.id, rating: 'good' }] });
    expect(badRating.status).toBe(400);
    expect(badRating.body.error.details[0].path).toBe('items.0.rating');
    const commentOnly = await agent
      .put(url())
      .send({ ...base, items: [{ studentId: t.fx.students.s1.id, rating: null, comment: 'تعليق' }] });
    expect(commentOnly.status).toBe(400);
    expect(commentOnly.body.error.details[0].path).toBe('items.0.comment');
    const dup = await agent.put(url()).send({
      ...base,
      items: [
        { studentId: t.fx.students.s1.id, rating: 'calm' },
        { studentId: t.fx.students.s1.id, rating: 'excellent' },
      ],
    });
    expect(dup.status).toBe(400);
    const noItems = await agent.put(url()).send(base);
    expect(noItems.status).toBe(400);
    const future = await agent.put(url()).send({ ...base, date: addDays(today, 1), items: [] });
    expect(future.status).toBe(400);
    const notInClass = await agent
      .put(url())
      .send({ ...base, items: [{ studentId: t.fx.students.s5.id, rating: 'calm' }] });
    expect(notInClass.status).toBe(400);
    expect((await agent.get(`${url()}?classId=${t.fx.class5a.id}&subjectId=${t.fx.math.id}`)).status).toBe(400);
  });

  it('a teacher outside the assignment is denied', async () => {
    const agent = await t.loginAs(t.fx.users.teacher.phone);
    // teacher teaches arabic in 5-ب, not 5-أ (teacher2's).
    expect((await agent.get(query(t.fx.class5a.id, t.fx.arabic.id, PAST))).status).toBe(403);
    const put = await agent.put(url()).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.arabic.id,
      date: PAST,
      items: [{ studentId: t.fx.students.s1.id, rating: 'calm' }],
    });
    expect(put.status).toBe(403);
    const otherSchoolClass = await agent.get(query(t.fx.classB.id, t.fx.math.id, PAST));
    expect(otherSchoolClass.status).toBe(404);

    const teacher2 = await t.loginAs(t.fx.users.teacher2.phone);
    expect((await teacher2.get(query(t.fx.class5a.id, t.fx.arabic.id, PAST))).status).toBe(200);
    expect((await teacher2.get(query(t.fx.class5a.id, t.fx.math.id, PAST))).status).toBe(403);
  });

  it("guardians and another school's admin are denied", async () => {
    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    expect((await guardian.get(query(t.fx.class5a.id, t.fx.math.id, PAST))).status).toBe(403);
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(query(t.fx.class5a.id, t.fx.math.id, PAST))).status).toBe(403);
    const viaB = await adminB.put(`${schoolB()}/evaluations`).send({
      classSectionId: t.fx.class5a.id,
      subjectId: t.fx.math.id,
      date: PAST,
      items: [{ studentId: t.fx.students.s1.id, rating: 'calm' }],
    });
    expect(viaB.status).toBe(404);
  });
});

// ───────────────────────────── Guardian P14 ─────────────────────────────

describe('guardian behavior screen (P14)', () => {
  const url = (studentId: string) => `/api/students/${studentId}/behavior`;

  it('shows counts, incidents (newest first) and teacher evaluations, and marks the module seen', async () => {
    const agent = await t.loginAs(t.fx.users.guardian.phone);
    const res = await agent.get(url(t.fx.students.s1.id));
    expect(res.status).toBe(200);
    expect(res.body.violations).toBe(2);
    expect(res.body.penalties).toBe(2);
    expect(res.body.incidents).toHaveLength(2);
    expect(res.body.incidents[0]).toEqual({
      id: expect.any(String),
      date: today,
      regulationTitle: 'إثارة الفوضى داخل الفصل',
      details: 'الحديث أثناء الشرح',
      penalty: 'إنذار كتابي',
    });
    expect(res.body.incidents[1].date).toBe(PAST);
    expect(res.body.evaluations).toEqual([
      { date: PAST, subjectName: 'الرياضيات', rating: 'calm', comment: null, teacherName: 'مشرف أ' },
    ]);

    const [cursor] = await t.db
      .select()
      .from(s.readCursors)
      .where(
        and(
          eq(s.readCursors.userId, t.fx.users.guardian.id),
          eq(s.readCursors.studentId, t.fx.students.s1.id),
          eq(s.readCursors.module, 'behavior'),
        ),
      );
    expect(cursor).toBeDefined();
  });

  it('counts only incidents with a penalty as penalties', async () => {
    const agent = await t.loginAs(t.fx.users.guardian2.phone);
    const res = await agent.get(url(t.fx.students.s2.id));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ violations: 1, penalties: 0 });
    expect(res.body.incidents[0].penalty).toBeNull();
  });

  it('returns the latest 30 evaluations, newest first', async () => {
    const values = Array.from({ length: 35 }, (_, i) => ({
      schoolId: t.fx.schoolA.id,
      studentId: t.fx.students.s3.id,
      subjectId: t.fx.science.id,
      teacherId: null,
      date: addDays('2025-08-01', i),
      rating: 'excellent' as const,
    }));
    await t.db.insert(s.evaluations).values(values);
    const admin = await t.loginAs(t.fx.users.admin.phone);
    const res = await admin.get(url(t.fx.students.s3.id));
    expect(res.status).toBe(200);
    expect(res.body.evaluations).toHaveLength(30);
    // s3 also has the math evaluation of PAST (the newest one).
    expect(res.body.evaluations[0]).toMatchObject({ date: PAST, subjectName: 'الرياضيات', rating: 'disruptive' });
    expect(res.body.evaluations[1].date).toBe(addDays('2025-08-01', 34));
    expect(res.body.evaluations.at(-1).teacherName).toBeNull();
  });

  it('staff can read it without clearing guardian badges', async () => {
    const admin = await t.loginAs(t.fx.users.admin.phone);
    const res = await admin.get(url(t.fx.students.s2.id));
    expect(res.status).toBe(200);
    const cursors = await t.db
      .select()
      .from(s.readCursors)
      .where(and(eq(s.readCursors.userId, t.fx.users.admin.id), eq(s.readCursors.module, 'behavior')));
    expect(cursors).toHaveLength(0);
  });

  it("the guardian of another student and another school's admin are denied", async () => {
    const guardian2 = await t.loginAs(t.fx.users.guardian2.phone);
    expect((await guardian2.get(url(t.fx.students.s1.id))).status).toBe(403);
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(url(t.fx.students.s1.id))).status).toBe(403);
    // A teacher who does not teach the student's class.
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    const [outside] = await t.db
      .insert(s.students)
      .values({
        schoolId: t.fx.schoolA.id,
        classSectionId: t.fx.class6a.id,
        gradeLevelId: t.fx.grade6.id,
        code: 'S-60',
        firstName: 'خالد',
        fatherName: 'عوض',
        grandfatherName: 'محمد',
        gender: 'male',
        registeredAt: '2025-07-01',
      })
      .returning();
    expect((await teacher.get(url(outside.id))).status).toBe(403);
  });
});
