import { and, asc, count, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { computeFeeAccount, formatDate, formatMoney, joinName, type FeeAccount } from '@slash/shared';
import type { Db } from '../../db/client';
import {
  academicYears,
  classSections,
  feePlans,
  gradeLevels,
  payments,
  planInstallments,
  studentFees,
  students,
  users,
} from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { installmentLabel } from './labels';
import type { InstallmentsInput } from './schemas';

// ───────────────────────────── Lookups (404 unless in the school) ─────────────────────────────

export async function findPlan(db: Db, schoolId: string, planId: string) {
  const [row] = await db
    .select()
    .from(feePlans)
    .where(and(eq(feePlans.id, planId), eq(feePlans.schoolId, schoolId)));
  if (!row) throw notFound('خطة الرسوم غير موجودة');
  return row;
}

export async function findStudentFee(db: Db, schoolId: string, studentFeeId: string) {
  const [row] = await db
    .select({
      id: studentFees.id,
      studentId: studentFees.studentId,
      feePlanId: studentFees.feePlanId,
      discount: studentFees.discount,
    })
    .from(studentFees)
    .where(and(eq(studentFees.id, studentFeeId), eq(studentFees.schoolId, schoolId)));
  if (!row) throw notFound('رسوم الطالب غير موجودة');
  return row;
}

export async function findPayment(db: Db, schoolId: string, paymentId: string) {
  const [row] = await db
    .select({
      id: payments.id,
      studentFeeId: payments.studentFeeId,
      studentId: studentFees.studentId,
      amount: payments.amount,
      paidAt: payments.paidAt,
      method: payments.method,
      receiptNo: payments.receiptNo,
      note: payments.note,
    })
    .from(payments)
    .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
    .where(and(eq(payments.id, paymentId), eq(payments.schoolId, schoolId)));
  if (!row) throw notFound('الدفعة غير موجودة');
  return row;
}

export async function findStudent(db: Db, schoolId: string, studentId: string) {
  const [row] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
  if (!row) throw notFound('الطالب غير موجود');
  return row;
}

export async function assertGradeInSchool(db: Db, schoolId: string, gradeLevelId: string) {
  const [row] = await db
    .select({ id: gradeLevels.id })
    .from(gradeLevels)
    .where(and(eq(gradeLevels.id, gradeLevelId), eq(gradeLevels.schoolId, schoolId)));
  if (!row) throw notFound('الصف غير موجود');
}

/** Throws 400 unless every id is a student of the school. */
export async function assertStudentsInSchool(db: Db, schoolId: string, studentIds: string[]) {
  const unique = [...new Set(studentIds)];
  if (!unique.length) return;
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.id, unique)));
  if (rows.length !== unique.length) throw badRequest('بعض الطلاب غير موجودين في المدرسة');
}

/**
 * Active students currently in the grade level: placed in a class of that grade, or (not yet placed)
 * admitted to it.
 */
export async function activeStudentsOfGrade(db: Db, schoolId: string, gradeLevelId: string): Promise<string[]> {
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .leftJoin(classSections, eq(classSections.id, students.classSectionId))
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.status, 'active'),
        or(
          eq(classSections.gradeLevelId, gradeLevelId),
          and(isNull(students.classSectionId), eq(students.gradeLevelId, gradeLevelId)),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/** True when any payment is recorded under the condition (joined through student_fees). */
export async function hasPayments(db: Db, where: SQL | undefined): Promise<boolean> {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
    .where(where)
    .limit(1);
  return !!row;
}

// ───────────────────────────── Plans ─────────────────────────────

export interface PlanInstallmentDto {
  id: string;
  seq: number;
  amount: number;
  dueDate: string;
}

export interface PlanDto {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
  /** Sum of the installments. */
  total: number;
  installments: PlanInstallmentDto[];
  studentCount: number;
  /** Payments are recorded under this plan (it cannot be deleted). */
  hasPayments: boolean;
}

/** Plans of the school (or one plan), newest academic year first, then by grade level and name. */
export async function loadPlans(db: Db, schoolId: string, planId?: string): Promise<PlanDto[]> {
  const plans = await db
    .select({
      id: feePlans.id,
      name: feePlans.name,
      academicYearId: feePlans.academicYearId,
      academicYearName: academicYears.name,
      gradeLevelId: feePlans.gradeLevelId,
      gradeLevelName: gradeLevels.name,
    })
    .from(feePlans)
    .innerJoin(academicYears, eq(academicYears.id, feePlans.academicYearId))
    .leftJoin(gradeLevels, eq(gradeLevels.id, feePlans.gradeLevelId))
    .where(and(eq(feePlans.schoolId, schoolId), planId ? eq(feePlans.id, planId) : undefined))
    .orderBy(desc(academicYears.startsOn), asc(gradeLevels.sort), asc(feePlans.name), asc(feePlans.createdAt));
  if (!plans.length) return [];
  const ids = plans.map((p) => p.id);

  const [installments, counts, paid] = await Promise.all([
    db
      .select()
      .from(planInstallments)
      .where(inArray(planInstallments.feePlanId, ids))
      .orderBy(asc(planInstallments.seq)),
    db
      .select({ planId: studentFees.feePlanId, n: count() })
      .from(studentFees)
      .where(inArray(studentFees.feePlanId, ids))
      .groupBy(studentFees.feePlanId),
    db
      .selectDistinct({ planId: studentFees.feePlanId })
      .from(payments)
      .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
      .where(inArray(studentFees.feePlanId, ids)),
  ]);
  const countBy = new Map(counts.map((c) => [c.planId, c.n]));
  const paidPlans = new Set(paid.map((p) => p.planId));

  return plans.map((p) => {
    const own = installments
      .filter((i) => i.feePlanId === p.id)
      .map((i) => ({ id: i.id, seq: i.seq, amount: i.amount, dueDate: i.dueDate }));
    return {
      ...p,
      gradeLevelName: p.gradeLevelName ?? null,
      total: own.reduce((sum, i) => sum + i.amount, 0),
      installments: own,
      studentCount: countBy.get(p.id) ?? 0,
      hasPayments: paidPlans.has(p.id),
    };
  });
}

export async function getPlan(db: Db, schoolId: string, planId: string): Promise<PlanDto> {
  const [plan] = await loadPlans(db, schoolId, planId);
  if (!plan) throw notFound('خطة الرسوم غير موجودة');
  return plan;
}

/** Replace a plan's schedule with `list` (seq 1…n). Run inside a transaction. */
export async function replaceInstallments(db: Db, planId: string, list: InstallmentsInput) {
  await db.delete(planInstallments).where(eq(planInstallments.feePlanId, planId));
  await db
    .insert(planInstallments)
    .values(list.map((i, k) => ({ feePlanId: planId, seq: k + 1, amount: i.amount, dueDate: i.dueDate })));
}

export async function planTotal(db: Db, planId: string): Promise<number> {
  const rows = await db
    .select({ amount: planInstallments.amount })
    .from(planInstallments)
    .where(eq(planInstallments.feePlanId, planId));
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

// ───────────────────────────── Accounts (balances) ─────────────────────────────

export interface StudentAccount {
  studentFeeId: string;
  studentId: string;
  planId: string;
  planName: string;
  discount: number;
  account: FeeAccount;
}

/**
 * Every fee account of the school (or of one student), with balances from `computeFeeAccount`
 * as of `today`. Oldest plan first.
 */
export async function loadAccounts(
  db: Db,
  schoolId: string,
  today: string,
  studentId?: string,
): Promise<StudentAccount[]> {
  const where = and(eq(studentFees.schoolId, schoolId), studentId ? eq(studentFees.studentId, studentId) : undefined);
  const rows = await db
    .select({
      studentFeeId: studentFees.id,
      studentId: studentFees.studentId,
      planId: feePlans.id,
      planName: feePlans.name,
      discount: studentFees.discount,
    })
    .from(studentFees)
    .innerJoin(feePlans, eq(feePlans.id, studentFees.feePlanId))
    .where(where)
    .orderBy(asc(feePlans.createdAt), asc(feePlans.name), asc(studentFees.createdAt));
  if (!rows.length) return [];

  const planIds = [...new Set(rows.map((r) => r.planId))];
  const [installments, paid] = await Promise.all([
    db
      .select({
        id: planInstallments.id,
        planId: planInstallments.feePlanId,
        seq: planInstallments.seq,
        amount: planInstallments.amount,
        dueDate: planInstallments.dueDate,
      })
      .from(planInstallments)
      .where(inArray(planInstallments.feePlanId, planIds)),
    db
      .select({ studentFeeId: payments.studentFeeId, amount: payments.amount, paidAt: payments.paidAt })
      .from(payments)
      .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
      .where(where),
  ]);

  const installmentsBy = new Map<string, Array<{ id: string; seq: number; amount: number; dueDate: string }>>();
  for (const { planId, ...inst } of installments) {
    const list = installmentsBy.get(planId) ?? [];
    list.push(inst);
    installmentsBy.set(planId, list);
  }
  const paymentsBy = new Map<string, Array<{ amount: number; paidAt: string }>>();
  for (const { studentFeeId, ...p } of paid) {
    const list = paymentsBy.get(studentFeeId) ?? [];
    list.push(p);
    paymentsBy.set(studentFeeId, list);
  }

  return rows.map((r) => ({
    ...r,
    account: computeFeeAccount({
      installments: installmentsBy.get(r.planId) ?? [],
      discount: r.discount,
      payments: paymentsBy.get(r.studentFeeId) ?? [],
      today,
    }),
  }));
}

export interface FeeTotals {
  total: number;
  discount: number;
  net: number;
  paid: number;
  remaining: number;
  overdue: number;
  credit: number;
}

export function sumAccounts(accounts: Array<{ account: FeeAccount }>): FeeTotals {
  const totals: FeeTotals = { total: 0, discount: 0, net: 0, paid: 0, remaining: 0, overdue: 0, credit: 0 };
  for (const { account } of accounts) {
    totals.total += account.total;
    totals.discount += account.discount;
    totals.net += account.net;
    totals.paid += account.paid;
    totals.remaining += account.remaining;
    totals.overdue += account.overdue;
    totals.credit += account.credit;
  }
  return totals;
}

export interface NextInstallment {
  planName: string;
  seq: number;
  remaining: number;
  dueDate: string;
}

/** The earliest not-yet-late installment that still has something to pay. */
export function nextDueInstallment(accounts: StudentAccount[]): NextInstallment | null {
  let next: NextInstallment | null = null;
  for (const a of accounts) {
    for (const i of a.account.installments) {
      if (i.remaining <= 0 || i.status === 'late') continue;
      if (!next || i.dueDate < next.dueDate) {
        next = { planName: a.planName, seq: i.seq, remaining: i.remaining, dueDate: i.dueDate };
      }
    }
  }
  return next;
}

// ───────────────────────────── Payments ─────────────────────────────

export interface StaffPaymentDto {
  id: string;
  studentFeeId: string;
  amount: number;
  paidAt: string;
  method: string;
  receiptNo: string | null;
  note: string | null;
  recordedByName: string | null;
  createdAt: string;
}

/** A student's payments (all plans), newest first. */
export async function studentPayments(db: Db, schoolId: string, studentId: string): Promise<StaffPaymentDto[]> {
  const rows = await db
    .select({
      id: payments.id,
      studentFeeId: payments.studentFeeId,
      amount: payments.amount,
      paidAt: payments.paidAt,
      method: payments.method,
      receiptNo: payments.receiptNo,
      note: payments.note,
      recordedByName: users.fullName,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
    .leftJoin(users, eq(users.id, payments.recordedBy))
    .where(and(eq(payments.schoolId, schoolId), eq(studentFees.studentId, studentId)))
    .orderBy(desc(payments.paidAt), desc(payments.createdAt));
  return rows.map((p) => ({ ...p, recordedByName: p.recordedByName ?? null, createdAt: p.createdAt.toISOString() }));
}

// ───────────────────────────── Students ─────────────────────────────

export interface StudentInfo {
  id: string;
  code: string;
  fullName: string;
  status: string;
  classLabel: string | null;
  gradeLevelId: string | null;
}

/** Name, code and "الصف الخامس - ب" label for a set of students of the school. */
export async function studentInfos(db: Db, schoolId: string, studentIds: string[]): Promise<Map<string, StudentInfo>> {
  const unique = [...new Set(studentIds)];
  if (!unique.length) return new Map();
  const rows = await db
    .select({
      id: students.id,
      code: students.code,
      firstName: students.firstName,
      fatherName: students.fatherName,
      grandfatherName: students.grandfatherName,
      status: students.status,
      admittedGradeId: students.gradeLevelId,
      section: classSections.name,
      classGradeId: classSections.gradeLevelId,
      grade: gradeLevels.name,
    })
    .from(students)
    .leftJoin(classSections, eq(classSections.id, students.classSectionId))
    .leftJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .where(and(eq(students.schoolId, schoolId), inArray(students.id, unique)));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        code: r.code,
        fullName: joinName(r.firstName, r.fatherName, r.grandfatherName),
        status: r.status,
        classLabel: r.section && r.grade ? `${r.grade} - ${r.section}` : null,
        gradeLevelId: r.classGradeId ?? r.admittedGradeId ?? null,
      },
    ]),
  );
}

// ───────────────────────────── Fee notice ─────────────────────────────

export const FEE_NOTICE_TITLE = 'إشعار الرسوم الدراسية';

const money = (n: number) => formatMoney(n, true);

/** Arabic text of the fee notice (announcement body and WhatsApp message). */
export function feeNoticeBody(input: {
  studentName: string;
  schoolName: string;
  today: string;
  totals: FeeTotals;
  next: NextInstallment | null;
  /** Name the plan in the "next installment" line when the student has several plans. */
  withPlanName: boolean;
}): string {
  const { totals, next } = input;
  const lines = [
    `ولي أمر الطالب/ة ${input.studentName}، السلام عليكم ورحمة الله.`,
    `نفيدكم بموقف الرسوم الدراسية حتى تاريخ ${formatDate(input.today)}:`,
    `- إجمالي الرسوم: ${money(totals.total)}`,
  ];
  if (totals.discount > 0) lines.push(`- الخصم: ${money(totals.discount)}`);
  lines.push(`- المبلغ المدفوع: ${money(totals.paid)}`);
  lines.push(`- المبلغ المتبقي: ${money(totals.remaining)}`);
  if (totals.overdue > 0) lines.push(`- المتأخرات المستحقة: ${money(totals.overdue)}`);
  if (next) {
    const plan = input.withPlanName ? ` (${next.planName})` : '';
    lines.push(
      `- القسط القادم: ${installmentLabel(next.seq)}${plan} بمبلغ ${money(next.remaining)} يستحق في ${formatDate(next.dueDate)}`,
    );
  }
  if (totals.remaining === 0) lines.push('تم سداد جميع الرسوم المستحقة، شكراً لكم.');
  else if (totals.overdue > 0) lines.push('نرجو التكرم بسداد المتأخرات في أقرب وقت.');
  else lines.push('نرجو التكرم بالسداد في الموعد المحدد.');
  lines.push(`إدارة ${input.schoolName}`);
  return lines.join('\n');
}
