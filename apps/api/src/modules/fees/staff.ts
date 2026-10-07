import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { whatsappLink } from '@slash/shared';
import type { Db } from '../../db/client';
import { announcements, feePlans, payments, studentFees, studentGuardians, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { requireRole, schoolOf, schoolToday, userOf } from '../../lib/context';
import { badRequest, conflict } from '../../lib/errors';
import { currentAcademicYear } from '../../lib/scope';
import { parse, zId } from '../../lib/validate';
import { assignSchema, createPlanSchema, discountSchema, paymentSchema, updatePlanSchema } from './schemas';
import {
  activeStudentsOfGrade,
  assertGradeInSchool,
  assertStudentsInSchool,
  FEE_NOTICE_TITLE,
  feeNoticeBody,
  findPayment,
  findPlan,
  findStudent,
  findStudentFee,
  getPlan,
  hasPayments,
  loadAccounts,
  loadPlans,
  nextDueInstallment,
  planTotal,
  replaceInstallments,
  studentInfos,
  studentPayments,
  sumAccounts,
} from './service';

const ARREARS_LIMIT = 100;
const RECENT_PAYMENTS = 20;

const discountTooLarge = () =>
  badRequest('الخصم أكبر من إجمالي الرسوم', [{ path: 'discount', message: 'الخصم أكبر من إجمالي الرسوم' }]);

const scheduleSnapshot = (list: Array<{ amount: number; dueDate: string }>) =>
  list.map((i) => ({ amount: i.amount, dueDate: i.dueDate }));

/**
 * Fees, recorded by hand — the director's screens: /api/schools/:schoolId/fees (admins only).
 *   GET    /plans                         → plans with installments and student counts
 *   POST   /plans                         → 201 plan (current academic year)
 *   PATCH  /plans/:id                     → plan (installments replace the schedule)
 *   DELETE /plans/:id                     → { ok } (409 when payments exist)
 *   POST   /plans/:id/assign              → { assigned, skipped }
 *   GET    /students/:studentId           → { student, accounts, totals, payments }
 *   POST   /students/:studentId/notice    → 201 { announcementId, body, contacts }
 *   PATCH  /student-fees/:id              → { discount } (audited)
 *   DELETE /student-fees/:id              → { ok } (409 when payments exist)
 *   POST   /student-fees/:id/payments     → 201 payment (audited)
 *   DELETE /payments/:id                  → { ok } (audited)
 *   GET    /overview                      → school totals, arrears, recent payments
 */
export function staffFeesRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin'));

  // ───────────── Plans ─────────────

  r.get('/plans', async (req, res) => {
    res.json(await loadPlans(db, schoolOf(req).id));
  });

  r.post('/plans', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(createPlanSchema, req.body);
    if (body.gradeLevelId) await assertGradeInSchool(db, school.id, body.gradeLevelId);
    const year = await currentAcademicYear(db, school.id);
    if (!year) throw badRequest('لا يوجد عام دراسي حالي، أضف العام الدراسي أولاً');

    const planId = await db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(feePlans)
        .values({ schoolId: school.id, academicYearId: year.id, gradeLevelId: body.gradeLevelId, name: body.name })
        .returning({ id: feePlans.id });
      await replaceInstallments(tx, plan.id, body.installments);
      return plan.id;
    });
    res.status(201).json(await getPlan(db, school.id, planId));
  });

  r.patch('/plans/:id', async (req, res) => {
    const school = schoolOf(req);
    const planId = parse(zId, req.params.id);
    const body = parse(updatePlanSchema, req.body);
    const existing = await findPlan(db, school.id, planId);
    if (body.gradeLevelId) await assertGradeInSchool(db, school.id, body.gradeLevelId);
    const before = await getPlan(db, school.id, planId);

    await db.transaction(async (tx) => {
      await tx
        .update(feePlans)
        .set({
          name: body.name ?? existing.name,
          gradeLevelId: body.gradeLevelId !== undefined ? body.gradeLevelId : existing.gradeLevelId,
        })
        .where(and(eq(feePlans.id, planId), eq(feePlans.schoolId, school.id)));
      if (body.installments) await replaceInstallments(tx, planId, body.installments);
    });
    const after = await getPlan(db, school.id, planId);
    if (before.hasPayments && body.installments) {
      // Balances of paying students change with the schedule: keep a trace.
      await audit(db, {
        schoolId: school.id,
        actorId: userOf(req).id,
        entity: 'fee_plan',
        entityId: planId,
        action: 'update',
        before: { name: before.name, installments: scheduleSnapshot(before.installments) },
        after: { name: after.name, installments: scheduleSnapshot(after.installments) },
      });
    }
    res.json(after);
  });

  r.delete('/plans/:id', async (req, res) => {
    const school = schoolOf(req);
    const planId = parse(zId, req.params.id);
    await findPlan(db, school.id, planId);
    if (await hasPayments(db, eq(studentFees.feePlanId, planId))) {
      throw conflict('لا يمكن حذف خطة رسوم عليها دفعات مسجلة');
    }
    await db.delete(feePlans).where(and(eq(feePlans.id, planId), eq(feePlans.schoolId, school.id)));
    res.json({ ok: true });
  });

  /** "تطبيق على الصف": bill the given students and/or every active student of a grade level. */
  r.post('/plans/:id/assign', async (req, res) => {
    const school = schoolOf(req);
    const planId = parse(zId, req.params.id);
    const body = parse(assignSchema, req.body);
    await findPlan(db, school.id, planId);
    const discount = body.discount ?? 0;
    if (discount > 0 && discount > (await planTotal(db, planId))) throw discountTooLarge();

    const ids = new Set(body.studentIds ?? []);
    await assertStudentsInSchool(db, school.id, [...ids]);
    if (body.gradeLevelId) {
      await assertGradeInSchool(db, school.id, body.gradeLevelId);
      for (const id of await activeStudentsOfGrade(db, school.id, body.gradeLevelId)) ids.add(id);
    }
    if (!ids.size) {
      res.json({ assigned: 0, skipped: 0 });
      return;
    }
    const inserted = await db
      .insert(studentFees)
      .values([...ids].map((studentId) => ({ schoolId: school.id, studentId, feePlanId: planId, discount })))
      .onConflictDoNothing({ target: [studentFees.studentId, studentFees.feePlanId] })
      .returning({ id: studentFees.id });
    res.json({ assigned: inserted.length, skipped: ids.size - inserted.length });
  });

  // ───────────── One student (admin student profile) ─────────────

  r.get('/students/:studentId', async (req, res) => {
    const school = schoolOf(req);
    const studentId = parse(zId, req.params.studentId);
    await findStudent(db, school.id, studentId);
    const [accounts, paymentList, infos] = await Promise.all([
      loadAccounts(db, school.id, schoolToday(school), studentId),
      studentPayments(db, school.id, studentId),
      studentInfos(db, school.id, [studentId]),
    ]);
    res.json({
      student: infos.get(studentId),
      accounts: accounts.map(({ studentFeeId, planId, planName, discount, account }) => ({
        studentFeeId,
        planId,
        planName,
        discount,
        account,
      })),
      totals: sumAccounts(accounts),
      payments: paymentList,
    });
  });

  /** "إرسال إشعار الرسوم الدراسية": posts an announcement to the student's guardians + WhatsApp links. */
  r.post('/students/:studentId/notice', async (req, res) => {
    const school = schoolOf(req);
    const studentId = parse(zId, req.params.studentId);
    await findStudent(db, school.id, studentId);
    const today = schoolToday(school);
    const accounts = await loadAccounts(db, school.id, today, studentId);
    if (!accounts.length) throw badRequest('لا توجد رسوم مسجلة لهذا الطالب');
    const info = (await studentInfos(db, school.id, [studentId])).get(studentId)!;

    const body = feeNoticeBody({
      studentName: info.fullName,
      schoolName: school.name,
      today,
      totals: sumAccounts(accounts),
      next: nextDueInstallment(accounts),
      withPlanName: accounts.length > 1,
    });
    const [announcement] = await db
      .insert(announcements)
      .values({
        schoolId: school.id,
        title: FEE_NOTICE_TITLE,
        body,
        audienceType: 'student',
        audienceId: studentId,
        createdBy: userOf(req).id,
      })
      .returning({ id: announcements.id });

    const guardians = await db
      .select({
        fullName: users.fullName,
        phone: users.phone,
        whatsapp: studentGuardians.whatsapp,
        isPrimary: studentGuardians.isPrimary,
      })
      .from(studentGuardians)
      .innerJoin(users, eq(users.id, studentGuardians.userId))
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.schoolId, school.id)))
      .orderBy(desc(studentGuardians.isPrimary), studentGuardians.createdAt);
    const message = `${FEE_NOTICE_TITLE}\n${body}`;
    res.status(201).json({
      announcementId: announcement.id,
      body,
      contacts: guardians.map((g) => {
        const phone = g.whatsapp?.trim() || g.phone;
        return { fullName: g.fullName, phone, whatsappUrl: whatsappLink(phone, message) };
      }),
    });
  });

  // ───────────── Student fee accounts ─────────────

  r.patch('/student-fees/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const { discount } = parse(discountSchema, req.body);
    const existing = await findStudentFee(db, school.id, id);
    if (discount > (await planTotal(db, existing.feePlanId))) throw discountTooLarge();
    if (discount !== existing.discount) {
      await db.transaction(async (tx) => {
        await tx
          .update(studentFees)
          .set({ discount })
          .where(and(eq(studentFees.id, id), eq(studentFees.schoolId, school.id)));
        await audit(tx, {
          schoolId: school.id,
          actorId: userOf(req).id,
          entity: 'student_fee',
          entityId: id,
          action: 'update',
          before: { studentId: existing.studentId, discount: existing.discount },
          after: { studentId: existing.studentId, discount },
        });
      });
    }
    res.json({ id, studentId: existing.studentId, planId: existing.feePlanId, discount });
  });

  r.delete('/student-fees/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const existing = await findStudentFee(db, school.id, id);
    if (await hasPayments(db, eq(studentFees.id, id))) {
      throw conflict('لا يمكن إلغاء الرسوم لوجود دفعات مسجلة، احذف الدفعات أولاً');
    }
    await db.transaction(async (tx) => {
      await tx.delete(studentFees).where(and(eq(studentFees.id, id), eq(studentFees.schoolId, school.id)));
      await audit(tx, {
        schoolId: school.id,
        actorId: userOf(req).id,
        entity: 'student_fee',
        entityId: id,
        action: 'delete',
        before: { studentId: existing.studentId, planId: existing.feePlanId, discount: existing.discount },
      });
    });
    res.json({ ok: true });
  });

  // ───────────── Payments ─────────────

  r.post('/student-fees/:id/payments', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(paymentSchema, req.body);
    const fee = await findStudentFee(db, school.id, id);
    if (body.paidAt > schoolToday(school)) {
      throw badRequest('تاريخ الدفع لا يمكن أن يكون بعد اليوم', [
        { path: 'paidAt', message: 'تاريخ الدفع لا يمكن أن يكون بعد اليوم' },
      ]);
    }

    const payment = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payments)
        .values({ schoolId: school.id, studentFeeId: id, recordedBy: user.id, ...body })
        .returning();
      await audit(tx, {
        schoolId: school.id,
        actorId: user.id,
        entity: 'payment',
        entityId: row.id,
        action: 'create',
        after: { studentId: fee.studentId, studentFeeId: id, ...body },
      });
      return row;
    });
    res.status(201).json({
      id: payment.id,
      studentFeeId: payment.studentFeeId,
      amount: payment.amount,
      paidAt: payment.paidAt,
      method: payment.method,
      receiptNo: payment.receiptNo,
      note: payment.note,
      recordedByName: user.fullName,
      createdAt: payment.createdAt.toISOString(),
    });
  });

  r.delete('/payments/:id', async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const existing = await findPayment(db, school.id, id);
    await db.transaction(async (tx) => {
      await tx.delete(payments).where(and(eq(payments.id, id), eq(payments.schoolId, school.id)));
      await audit(tx, {
        schoolId: school.id,
        actorId: userOf(req).id,
        entity: 'payment',
        entityId: id,
        action: 'delete',
        before: {
          studentId: existing.studentId,
          studentFeeId: existing.studentFeeId,
          amount: existing.amount,
          paidAt: existing.paidAt,
          method: existing.method,
          receiptNo: existing.receiptNo,
          note: existing.note,
        },
      });
    });
    res.json({ ok: true });
  });

  // ───────────── Overview ("المتأخرات") ─────────────

  r.get('/overview', async (req, res) => {
    const school = schoolOf(req);
    const accounts = await loadAccounts(db, school.id, schoolToday(school));
    const totals = sumAccounts(accounts);

    const byStudent = new Map<string, { remaining: number; overdue: number }>();
    for (const { studentId, account } of accounts) {
      const s = byStudent.get(studentId) ?? { remaining: 0, overdue: 0 };
      s.remaining += account.remaining;
      s.overdue += account.overdue;
      byStudent.set(studentId, s);
    }
    const late = [...byStudent.entries()]
      .filter(([, s]) => s.overdue > 0)
      .sort((a, b) => b[1].overdue - a[1].overdue || b[1].remaining - a[1].remaining);
    const top = late.slice(0, ARREARS_LIMIT);

    const recent = await db
      .select({
        id: payments.id,
        studentId: studentFees.studentId,
        planName: feePlans.name,
        amount: payments.amount,
        paidAt: payments.paidAt,
        method: payments.method,
        receiptNo: payments.receiptNo,
        recordedByName: users.fullName,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
      .innerJoin(feePlans, eq(feePlans.id, studentFees.feePlanId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(eq(payments.schoolId, school.id))
      .orderBy(desc(payments.createdAt))
      .limit(RECENT_PAYMENTS);

    const infos = await studentInfos(db, school.id, [...top.map(([id]) => id), ...recent.map((p) => p.studentId)]);
    res.json({
      expected: totals.net,
      collected: totals.paid,
      outstanding: totals.remaining,
      overdue: totals.overdue,
      studentsWithArrears: late.length,
      arrears: top.map(([studentId, s]) => {
        const info = infos.get(studentId);
        return {
          studentId,
          code: info?.code ?? '',
          fullName: info?.fullName ?? '',
          classLabel: info?.classLabel ?? null,
          status: info?.status ?? 'active',
          remaining: s.remaining,
          overdue: s.overdue,
        };
      }),
      recentPayments: recent.map((p) => ({
        ...p,
        studentName: infos.get(p.studentId)?.fullName ?? '',
        code: infos.get(p.studentId)?.code ?? '',
        recordedByName: p.recordedByName ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  return r;
}
