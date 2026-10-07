import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { addDays, formatMoney, todayIn } from '@slash/shared';
import * as s from '../src/db/schema';
import { seedFeesDemo } from '../src/modules/fees/demo';
import { setupTestApp, type TestContext } from './helpers';

let t: TestContext;
let today: string;
let dues: [string, string, string];

beforeAll(async () => {
  t = await setupTestApp();
  today = todayIn(t.fx.schoolA.timezone);
  dues = [addDays(today, -40), addDays(today, -10), addDays(today, 30)];
});
afterAll(() => t.close());

const base = () => `/api/schools/${t.fx.schoolA.id}/fees`;
const baseB = () => `/api/schools/${t.fx.schoolB.id}/fees`;
const guardianUrl = (studentId: string) => `/api/students/${studentId}/fees`;

const schedule = () => [
  { amount: 300_000, dueDate: dues[0] },
  { amount: 150_000, dueDate: dues[1] },
  { amount: 150_000, dueDate: dues[2] },
];

async function auditRows(entity: string, entityId: string) {
  return t.db
    .select()
    .from(s.auditLogs)
    .where(and(eq(s.auditLogs.entity, entity), eq(s.auditLogs.entityId, entityId)));
}

async function studentFeeId(studentId: string, planId: string) {
  const [row] = await t.db
    .select({ id: s.studentFees.id })
    .from(s.studentFees)
    .where(and(eq(s.studentFees.studentId, studentId), eq(s.studentFees.feePlanId, planId)));
  return row?.id;
}

/** State shared by the ordered scenarios below. */
let planId: string;
let s1Fee: string;
let paymentId: string;

describe('fee plans', () => {
  it('creates a plan for the current academic year (201)', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent
      .post(`${base()}/plans`)
      .send({ name: '  رسوم الصف الخامس  ', gradeLevelId: t.fx.grade5.id, installments: schedule() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'رسوم الصف الخامس',
      academicYearId: t.fx.yearA.id,
      gradeLevelId: t.fx.grade5.id,
      gradeLevelName: 'الصف الخامس',
      total: 600_000,
      studentCount: 0,
      hasPayments: false,
    });
    expect(
      res.body.installments.map((i: { seq: number; amount: number; dueDate: string }) => [i.seq, i.amount, i.dueDate]),
    ).toEqual([
      [1, 300_000, dues[0]],
      [2, 150_000, dues[1]],
      [3, 150_000, dues[2]],
    ]);
    planId = res.body.id;
  });

  it('creates a plan for any grade level (gradeLevelId null)', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent
      .post(`${base()}/plans`)
      .send({ name: 'رسوم النشاط', gradeLevelId: null, installments: [{ amount: 50_000, dueDate: dues[2] }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ gradeLevelId: null, gradeLevelName: null, total: 50_000 });
  });

  it('validates the plan and its installments', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const post = (body: object) => agent.post(`${base()}/plans`).send(body);

    const noName = await post({ name: ' ', gradeLevelId: null, installments: schedule() });
    expect(noName.status).toBe(400);
    expect(noName.body.error.details[0].path).toBe('name');

    const empty = await post({ name: 'خطة', gradeLevelId: null, installments: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.details[0].message).toBe('يجب إضافة قسط واحد على الأقل');

    const unordered = await post({
      name: 'خطة',
      installments: [
        { amount: 100, dueDate: dues[1] },
        { amount: 100, dueDate: dues[1] },
      ],
    });
    expect(unordered.status).toBe(400);
    expect(unordered.body.error.details[0].path).toBe('installments.1.dueDate');

    const zero = await post({ name: 'خطة', installments: [{ amount: 0, dueDate: dues[0] }] });
    expect(zero.status).toBe(400);
    expect(zero.body.error.details[0].message).toBe('المبلغ يجب أن يكون أكبر من صفر');

    const fraction = await post({ name: 'خطة', installments: [{ amount: 10.5, dueDate: dues[0] }] });
    expect(fraction.status).toBe(400);

    const badDate = await post({ name: 'خطة', installments: [{ amount: 10, dueDate: '2025-02-30' }] });
    expect(badDate.status).toBe(400);

    const tooMany = await post({
      name: 'خطة',
      installments: Array.from({ length: 13 }, (_, k) => ({ amount: 10, dueDate: addDays(today, k) })),
    });
    expect(tooMany.status).toBe(400);

    const otherSchoolGrade = await t.db
      .select({ id: s.gradeLevels.id })
      .from(s.gradeLevels)
      .where(eq(s.gradeLevels.schoolId, t.fx.schoolB.id));
    const foreign = await post({ name: 'خطة', gradeLevelId: otherSchoolGrade[0].id, installments: schedule() });
    expect(foreign.status).toBe(404);
  });

  it('assigns the plan to every active student of the grade level, skipping those already assigned', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.post(`${base()}/plans/${planId}/assign`).send({ gradeLevelId: t.fx.grade5.id });
    expect(res.status).toBe(200);
    // s1, s2, s3 (5-أ) and s5 (5-ب)
    expect(res.body).toEqual({ assigned: 4, skipped: 0 });

    const again = await agent
      .post(`${base()}/plans/${planId}/assign`)
      .send({ gradeLevelId: t.fx.grade5.id, studentIds: [t.fx.students.s1.id] });
    expect(again.body).toEqual({ assigned: 0, skipped: 4 });

    const plans = await agent.get(`${base()}/plans`);
    expect(plans.status).toBe(200);
    expect(plans.body.find((p: { id: string }) => p.id === planId).studentCount).toBe(4);
    s1Fee = (await studentFeeId(t.fx.students.s1.id, planId))!;
    expect(s1Fee).toBeTruthy();
  });

  it('assigns given students with a discount', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const activity = (await agent.get(`${base()}/plans`)).body.find((p: { name: string }) => p.name === 'رسوم النشاط');
    const res = await agent
      .post(`${base()}/plans/${activity.id}/assign`)
      .send({ studentIds: [t.fx.students.s3.id], discount: 10_000 });
    expect(res.body).toEqual({ assigned: 1, skipped: 0 });
    const [row] = await t.db
      .select()
      .from(s.studentFees)
      .where(and(eq(s.studentFees.studentId, t.fx.students.s3.id), eq(s.studentFees.feePlanId, activity.id)));
    expect(row.discount).toBe(10_000);
  });

  it('validates assignments', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const nothing = await agent.post(`${base()}/plans/${planId}/assign`).send({});
    expect(nothing.status).toBe(400);
    const foreign = await agent.post(`${base()}/plans/${planId}/assign`).send({ studentIds: [t.fx.students.s4.id] });
    expect(foreign.status).toBe(400);
    const tooMuch = await agent
      .post(`${base()}/plans/${planId}/assign`)
      .send({ studentIds: [t.fx.students.s1.id], discount: 600_001 });
    expect(tooMuch.status).toBe(400);
    const negative = await agent
      .post(`${base()}/plans/${planId}/assign`)
      .send({ studentIds: [t.fx.students.s1.id], discount: -1 });
    expect(negative.status).toBe(400);
  });
});

describe('payments and student accounts', () => {
  it('records a payment (201) with an audit entry', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.post(`${base()}/student-fees/${s1Fee}/payments`).send({
      amount: 300_000,
      paidAt: addDays(today, -45),
      method: 'cash',
      receiptNo: ' 1001 ',
      note: '',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      studentFeeId: s1Fee,
      amount: 300_000,
      paidAt: addDays(today, -45),
      method: 'cash',
      receiptNo: '1001',
      note: null,
      recordedByName: 'مدير أ',
    });
    paymentId = res.body.id;
    const logs = await auditRows('payment', paymentId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'create', actorId: t.fx.users.admin.id, schoolId: t.fx.schoolA.id });
    expect(logs[0].after).toMatchObject({ studentId: t.fx.students.s1.id, amount: 300_000 });

    const second = await agent
      .post(`${base()}/student-fees/${s1Fee}/payments`)
      .send({ amount: 100_000, paidAt: today, method: 'bankak' });
    expect(second.status).toBe(201);
  });

  it('validates payments', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const post = (body: object) => agent.post(`${base()}/student-fees/${s1Fee}/payments`).send(body);
    const zero = await post({ amount: 0, paidAt: today, method: 'cash' });
    expect(zero.status).toBe(400);
    const future = await post({ amount: 10, paidAt: addDays(today, 1), method: 'cash' });
    expect(future.status).toBe(400);
    expect(future.body.error.details[0].path).toBe('paidAt');
    const method = await post({ amount: 10, paidAt: today, method: 'card' });
    expect(method.status).toBe(400);
    expect(method.body.error.details[0].message).toBe('طريقة الدفع غير صالحة');
    const missing = await post({ paidAt: today, method: 'cash' });
    expect(missing.status).toBe(400);
    const badId = await agent.post(`${base()}/student-fees/not-a-uuid/payments`).send({});
    expect(badId.status).toBe(400);
  });

  it('derives the account (oldest-first allocation, statuses, overdue)', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.get(`${base()}/students/${t.fx.students.s1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(today);
    expect(res.body.student).toMatchObject({
      code: 'S-1',
      classLabel: 'الصف الخامس - أ',
      gradeLevelId: t.fx.grade5.id,
    });
    expect(res.body.accounts).toHaveLength(1);
    const [acc] = res.body.accounts;
    expect(acc).toMatchObject({ studentFeeId: s1Fee, planId, planName: 'رسوم الصف الخامس', discount: 0 });
    expect(acc.account).toMatchObject({
      total: 600_000,
      net: 600_000,
      paid: 400_000,
      remaining: 200_000,
      overdue: 50_000,
      credit: 0,
    });
    expect(
      acc.account.installments.map((i: { paid: number; remaining: number; status: string }) => [
        i.paid,
        i.remaining,
        i.status,
      ]),
    ).toEqual([
      [300_000, 0, 'paid'],
      [100_000, 50_000, 'late'],
      [0, 150_000, 'upcoming'],
    ]);
    expect(res.body.totals).toMatchObject({ total: 600_000, paid: 400_000, remaining: 200_000, overdue: 50_000 });
    // Newest first
    expect(res.body.payments.map((p: { amount: number }) => p.amount)).toEqual([100_000, 300_000]);
    expect(res.body.payments[0]).toMatchObject({ method: 'bankak', recordedByName: 'مدير أ' });
  });

  it('returns 404 for a student of another school', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.get(`${base()}/students/${t.fx.students.s4.id}`);
    expect(res.status).toBe(404);
  });

  it('updates the discount with an audit entry; the balance recomputes', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.patch(`${base()}/student-fees/${s1Fee}`).send({ discount: 100_000 });
    expect(res.status).toBe(200);
    expect(res.body.discount).toBe(100_000);
    const logs = await auditRows('student_fee', s1Fee);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'update', before: { discount: 0 }, after: { discount: 100_000 } });

    const acc = (await agent.get(`${base()}/students/${t.fx.students.s1.id}`)).body.accounts[0].account;
    // The discount reduces the last installment: dues 300k, 150k, 50k.
    expect(acc).toMatchObject({ net: 500_000, remaining: 100_000, overdue: 50_000 });

    const tooMuch = await agent.patch(`${base()}/student-fees/${s1Fee}`).send({ discount: 700_000 });
    expect(tooMuch.status).toBe(400);
    const bad = await agent.patch(`${base()}/student-fees/${s1Fee}`).send({ discount: 'x' });
    expect(bad.status).toBe(400);

    await agent.patch(`${base()}/student-fees/${s1Fee}`).send({ discount: 0 });
  });

  it('edits the installments of a plan that has payments; balances follow', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.patch(`${base()}/plans/${planId}`).send({
      name: 'رسوم الصف الخامس 2025',
      installments: [
        { amount: 350_000, dueDate: dues[0] },
        { amount: 250_000, dueDate: dues[2] },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'رسوم الصف الخامس 2025', total: 600_000, hasPayments: true });
    expect(res.body.installments.map((i: { seq: number }) => i.seq)).toEqual([1, 2]);

    const acc = (await agent.get(`${base()}/students/${t.fx.students.s1.id}`)).body.accounts[0].account;
    expect(acc.installments.map((i: { status: string }) => i.status)).toEqual(['paid', 'partial']);
    expect(acc).toMatchObject({ paid: 400_000, remaining: 200_000, overdue: 0 });
    const logs = await auditRows('fee_plan', planId);
    expect(logs).toHaveLength(1);

    // Back to the original schedule for the scenarios below.
    const back = await agent
      .patch(`${base()}/plans/${planId}`)
      .send({ name: 'رسوم الصف الخامس', installments: schedule() });
    expect(back.body.installments).toHaveLength(3);
  });

  it('validates plan edits and keeps tenant isolation', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const unordered = await agent.patch(`${base()}/plans/${planId}`).send({
      installments: [
        { amount: 1, dueDate: dues[2] },
        { amount: 1, dueDate: dues[0] },
      ],
    });
    expect(unordered.status).toBe(400);
    const missing = await agent.patch(`${base()}/plans/${crypto.randomUUID()}`).send({ name: 'x' });
    expect(missing.status).toBe(404);
    const anyGrade = await agent.patch(`${base()}/plans/${planId}`).send({ gradeLevelId: null });
    expect(anyGrade.body.gradeLevelId).toBeNull();
    const grade5 = await agent.patch(`${base()}/plans/${planId}`).send({ gradeLevelId: t.fx.grade5.id });
    expect(grade5.body.gradeLevelName).toBe('الصف الخامس');
  });

  it('refuses to delete a plan or an account that has payments (409)', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const plan = await agent.delete(`${base()}/plans/${planId}`);
    expect(plan.status).toBe(409);
    const fee = await agent.delete(`${base()}/student-fees/${s1Fee}`);
    expect(fee.status).toBe(409);
  });

  it('deletes a payment with an audit entry', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const extra = await agent
      .post(`${base()}/student-fees/${s1Fee}/payments`)
      .send({ amount: 5_000, paidAt: today, method: 'other', note: 'خطأ' });
    const res = await agent.delete(`${base()}/payments/${extra.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const logs = await auditRows('payment', extra.body.id);
    expect(logs.map((l) => l.action).sort()).toEqual(['create', 'delete']);
    expect(logs.find((l) => l.action === 'delete')!.before).toMatchObject({ amount: 5_000, note: 'خطأ' });
    const again = await agent.delete(`${base()}/payments/${extra.body.id}`);
    expect(again.status).toBe(404);
  });

  it('removes an account without payments', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const s5Fee = await studentFeeId(t.fx.students.s5.id, planId);
    const res = await agent.delete(`${base()}/student-fees/${s5Fee}`);
    expect(res.status).toBe(200);
    expect(await studentFeeId(t.fx.students.s5.id, planId)).toBeUndefined();
    expect((await auditRows('student_fee', s5Fee!)).map((l) => l.action)).toEqual(['delete']);
  });
});

describe('guardian view (P9)', () => {
  it("shows the child's plans, totals and payments, and clears the fees badge", async () => {
    const agent = await t.loginAs(t.fx.users.guardian.phone);
    const res = await agent.get(guardianUrl(t.fx.students.s1.id));
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(today);
    expect(res.body.totals).toMatchObject({ total: 600_000, paid: 400_000, remaining: 200_000, overdue: 50_000 });
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0]).toMatchObject({ planName: 'رسوم الصف الخامس', total: 600_000, net: 600_000 });
    expect(res.body.plans[0].installments[1]).toEqual({
      seq: 2,
      amount: 150_000,
      due: 150_000,
      paid: 100_000,
      remaining: 50_000,
      dueDate: dues[1],
      status: 'late',
    });
    expect(res.body.payments).toEqual([
      { amount: 100_000, paidAt: today, method: 'bankak', receiptNo: null },
      { amount: 300_000, paidAt: addDays(today, -45), method: 'cash', receiptNo: '1001' },
    ]);
    const cursors = await t.db
      .select()
      .from(s.readCursors)
      .where(and(eq(s.readCursors.userId, t.fx.users.guardian.id), eq(s.readCursors.module, 'fees')));
    expect(cursors).toHaveLength(1);
  });

  it('returns empty lists for a child without fees', async () => {
    const agent = await t.loginAs(t.fx.users.guardian.phone);
    const res = await agent.get(guardianUrl(t.fx.students.s4.id));
    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([]);
    expect(res.body.totals).toMatchObject({ total: 0, paid: 0, remaining: 0, overdue: 0 });
  });

  it("denies another student's guardian and teachers", async () => {
    const other = await t.loginAs(t.fx.users.guardian2.phone);
    expect((await other.get(guardianUrl(t.fx.students.s1.id))).status).toBe(403);
    // The teacher teaches 5-أ but fees are not part of a teacher's work.
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    expect((await teacher.get(guardianUrl(t.fx.students.s1.id))).status).toBe(403);
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(guardianUrl(t.fx.students.s1.id))).status).toBe(403);
  });

  it('lets supervisors read it without clearing the guardian badge', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.get(guardianUrl(t.fx.students.s1.id));
    expect(res.status).toBe(200);
    const cursors = await t.db.select().from(s.readCursors).where(eq(s.readCursors.userId, t.fx.users.supervisor.id));
    expect(cursors).toHaveLength(0);
  });
});

describe('overview and arrears', () => {
  it('sums the school and lists students in arrears by overdue amount', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.get(`${base()}/overview`);
    expect(res.status).toBe(200);
    // Accounts: s1 (600k, paid 400k, overdue 50k), s2 & s3 (600k, nothing paid, overdue 450k),
    // s3 activity plan (50k − 10k discount, not due yet).
    expect(res.body).toMatchObject({
      expected: 1_840_000,
      collected: 400_000,
      outstanding: 1_440_000,
      overdue: 950_000,
      studentsWithArrears: 3,
    });
    expect(res.body.arrears.map((a: { studentId: string; overdue: number }) => [a.studentId, a.overdue])).toEqual([
      [t.fx.students.s3.id, 450_000],
      [t.fx.students.s2.id, 450_000],
      [t.fx.students.s1.id, 50_000],
    ]);
    expect(res.body.arrears[2]).toMatchObject({
      code: 'S-1',
      fullName: 'مصعب إبراهيم عبدالله',
      classLabel: 'الصف الخامس - أ',
      remaining: 200_000,
    });
    expect(res.body.recentPayments).toHaveLength(2);
    expect(res.body.recentPayments[0]).toMatchObject({
      studentId: t.fx.students.s1.id,
      studentName: 'مصعب إبراهيم عبدالله',
      amount: 100_000,
      recordedByName: 'مدير أ',
    });
  });

  it("is scoped to the admin's own school", async () => {
    const agent = await t.loginAs(t.fx.users.adminB.phone);
    const res = await agent.get(`${baseB()}/overview`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ expected: 0, collected: 0, arrears: [], recentPayments: [] });
    expect((await agent.get(`${baseB()}/plans`)).body).toEqual([]);
  });
});

describe('fee notice', () => {
  it('posts an announcement to the student and returns WhatsApp links for each guardian', async () => {
    await t.db
      .update(s.studentGuardians)
      .set({ whatsapp: '0911222333' })
      .where(eq(s.studentGuardians.studentId, t.fx.students.s1.id));
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.post(`${base()}/students/${t.fx.students.s1.id}/notice`);
    expect(res.status).toBe(201);
    expect(res.body.body).toContain(`إجمالي الرسوم: ${formatMoney(600_000, true)}`);
    expect(res.body.body).toContain(`المبلغ المدفوع: ${formatMoney(400_000, true)}`);
    expect(res.body.body).toContain(`المبلغ المتبقي: ${formatMoney(200_000, true)}`);
    expect(res.body.body).toContain(`المتأخرات المستحقة: ${formatMoney(50_000, true)}`);
    expect(res.body.body).toContain('القسط القادم: القسط الثالث');
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0]).toMatchObject({ fullName: 'ولي أمر', phone: '0911222333' });
    expect(res.body.contacts[0].whatsappUrl).toMatch(/^https:\/\/wa\.me\/249911222333\?text=/);

    const [announcement] = await t.db
      .select()
      .from(s.announcements)
      .where(eq(s.announcements.id, res.body.announcementId));
    expect(announcement).toMatchObject({
      schoolId: t.fx.schoolA.id,
      title: 'إشعار الرسوم الدراسية',
      audienceType: 'student',
      audienceId: t.fx.students.s1.id,
      createdBy: t.fx.users.admin.id,
      body: res.body.body,
    });
  });

  it("falls back to the guardian's phone and refuses students without fees", async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const s2 = await agent.post(`${base()}/students/${t.fx.students.s2.id}/notice`);
    expect(s2.status).toBe(201);
    expect(s2.body.contacts).toEqual([
      expect.objectContaining({ fullName: 'ولي أمر ثاني', phone: t.fx.users.guardian2.phone }),
    ]);
    const s5 = await agent.post(`${base()}/students/${t.fx.students.s5.id}/notice`);
    expect(s5.status).toBe(400);
    const foreign = await agent.post(`${base()}/students/${t.fx.students.s4.id}/notice`);
    expect(foreign.status).toBe(404);
  });
});

describe('authorization', () => {
  it('another school admin is denied on school A routes', async () => {
    const agent = await t.loginAs(t.fx.users.adminB.phone);
    expect((await agent.get(`${base()}/plans`)).status).toBe(403);
    expect((await agent.get(`${base()}/students/${t.fx.students.s1.id}`)).status).toBe(403);
    expect(
      (await agent.post(`${base()}/student-fees/${s1Fee}/payments`).send({ amount: 1, paidAt: today, method: 'cash' }))
        .status,
    ).toBe(403);
  });

  it("another school admin cannot reach school A's records through their own school (404)", async () => {
    const agent = await t.loginAs(t.fx.users.adminB.phone);
    expect((await agent.patch(`${baseB()}/plans/${planId}`).send({ name: 'x' })).status).toBe(404);
    expect((await agent.delete(`${baseB()}/plans/${planId}`)).status).toBe(404);
    expect((await agent.post(`${baseB()}/plans/${planId}/assign`).send({ gradeLevelId: t.fx.grade5.id })).status).toBe(
      404,
    );
    expect((await agent.get(`${baseB()}/students/${t.fx.students.s1.id}`)).status).toBe(404);
    expect((await agent.post(`${baseB()}/students/${t.fx.students.s1.id}/notice`)).status).toBe(404);
    expect((await agent.patch(`${baseB()}/student-fees/${s1Fee}`).send({ discount: 0 })).status).toBe(404);
    expect(
      (await agent.post(`${baseB()}/student-fees/${s1Fee}/payments`).send({ amount: 1, paidAt: today, method: 'cash' }))
        .status,
    ).toBe(404);
    expect((await agent.delete(`${baseB()}/payments/${paymentId}`)).status).toBe(404);
    expect((await agent.delete(`${baseB()}/student-fees/${s1Fee}`)).status).toBe(404);
  });

  it('teachers and supervisors cannot manage fees (admins only)', async () => {
    for (const phone of [t.fx.users.teacher.phone, t.fx.users.supervisor.phone]) {
      const agent = await t.loginAs(phone);
      expect((await agent.get(`${base()}/plans`)).status).toBe(403);
      expect((await agent.get(`${base()}/overview`)).status).toBe(403);
      expect(
        (
          await agent
            .post(`${base()}/student-fees/${s1Fee}/payments`)
            .send({ amount: 1, paidAt: today, method: 'cash' })
        ).status,
      ).toBe(403);
    }
  });

  it('guardians cannot call staff routes', async () => {
    const agent = await t.loginAs(t.fx.users.guardian.phone);
    expect((await agent.get(`${base()}/plans`)).status).toBe(403);
    expect((await agent.get(`${base()}/students/${t.fx.students.s1.id}`)).status).toBe(403);
    expect(
      (await agent.post(`${base()}/student-fees/${s1Fee}/payments`).send({ amount: 1, paidAt: today, method: 'cash' }))
        .status,
    ).toBe(403);
    expect((await agent.delete(`${base()}/payments/${paymentId}`)).status).toBe(403);
  });

  it('anonymous users are rejected', async () => {
    expect((await t.anon().get(`${base()}/plans`)).status).toBe(401);
    expect((await t.anon().get(guardianUrl(t.fx.students.s1.id))).status).toBe(401);
  });
});

describe('plan deletion', () => {
  it('deletes a plan without payments together with its accounts', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const created = await agent
      .post(`${base()}/plans`)
      .send({ name: 'رسوم الصف السادس', gradeLevelId: t.fx.grade6.id, installments: schedule() });
    await agent.post(`${base()}/plans/${created.body.id}/assign`).send({ studentIds: [t.fx.students.s5.id] });
    const res = await agent.delete(`${base()}/plans/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(await studentFeeId(t.fx.students.s5.id, created.body.id)).toBeUndefined();
    expect((await agent.delete(`${base()}/plans/${created.body.id}`)).status).toBe(404);
  });
});

describe('demo data', () => {
  let d: TestContext;
  beforeAll(async () => {
    d = await setupTestApp();
  });
  afterAll(() => d.close());

  it('seeds one plan per grade level with a mix of paid and late accounts, once', async () => {
    const day = todayIn(d.fx.schoolA.timezone);
    await seedFeesDemo(d.db, { today: day });
    await seedFeesDemo(d.db, { today: day });
    const agent = await d.loginAs(d.fx.users.admin.phone);
    const plans = (await agent.get(`/api/schools/${d.fx.schoolA.id}/fees/plans`)).body;
    expect(
      plans.map((p: { name: string; total: number; studentCount: number }) => [p.name, p.total, p.studentCount]),
    ).toEqual([
      ['رسوم الصف الخامس', 600_000, 4],
      ['رسوم الصف السادس', 600_000, 0],
    ]);
    const overview = (await agent.get(`/api/schools/${d.fx.schoolA.id}/fees/overview`)).body;
    expect(overview.collected).toBeGreaterThan(0);
    expect(overview.studentsWithArrears).toBeGreaterThan(0);
    const guardian = await d.loginAs(d.fx.users.guardian.phone);
    const p9 = (await guardian.get(`/api/students/${d.fx.students.s1.id}/fees`)).body;
    expect(p9.totals).toMatchObject({ total: 600_000, paid: 400_000, remaining: 200_000, overdue: 50_000 });
  });
});
