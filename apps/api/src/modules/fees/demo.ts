import { and, asc, eq } from 'drizzle-orm';
import { addDays, type PaymentMethod } from '@slash/shared';
import type { Db } from '../../db/client';
import * as s from '../../db/schema';
import { currentAcademicYear } from '../../lib/scope';

/** The sketch's plan (P9): 600,000 in three installments. */
const DEMO_INSTALLMENTS = [300_000, 150_000, 150_000] as const;

interface DemoPayment {
  amount: number;
  /** Days before today. */
  daysAgo: number;
  method: PaymentMethod;
}

/**
 * Payment patterns cycled over each school's students (in registration order, so the demo
 * guardian's children come first). With the due dates below (60 days ago, 5 days ago, in 75 days):
 *  0 → 300,000 + 100,000: second installment partly paid and late (the sketch's numbers)
 *  1 → 300,000 + 150,000: up to date
 *  2 → 300,000: second installment late
 *  3 → nothing paid: two installments late
 *  4 → 50,000 discount, everything paid
 */
const PATTERNS: Array<{ discount: number; payments: DemoPayment[] }> = [
  {
    discount: 0,
    payments: [
      { amount: 300_000, daysAgo: 63, method: 'cash' },
      { amount: 100_000, daysAgo: 7, method: 'bankak' },
    ],
  },
  {
    discount: 0,
    payments: [
      { amount: 300_000, daysAgo: 61, method: 'bankak' },
      { amount: 150_000, daysAgo: 6, method: 'cash' },
    ],
  },
  { discount: 0, payments: [{ amount: 300_000, daysAgo: 58, method: 'bank_transfer' }] },
  { discount: 0, payments: [] },
  {
    discount: 50_000,
    payments: [
      { amount: 300_000, daysAgo: 65, method: 'cash' },
      { amount: 250_000, daysAgo: 2, method: 'bankak' },
    ],
  },
];

/**
 * Demo fees for every school that has none yet: one plan per grade level of the current academic
 * year, billed to its active students, with a mix of paid, partly paid and late accounts.
 * Call after the schools, staff and students are seeded (e.g. at the end of `seedDemo`).
 */
export async function seedFeesDemo(db: Db, opts: { today: string }): Promise<void> {
  const { today } = opts;
  const dueDates = [addDays(today, -60), addDays(today, -5), addDays(today, 75)];
  const schools = await db.select({ id: s.schools.id }).from(s.schools).orderBy(asc(s.schools.createdAt));
  let receipt = 1000;

  for (const school of schools) {
    const [existing] = await db
      .select({ id: s.feePlans.id })
      .from(s.feePlans)
      .where(eq(s.feePlans.schoolId, school.id))
      .limit(1);
    if (existing) continue;
    const year = await currentAcademicYear(db, school.id);
    if (!year) continue;
    const [admin] = await db
      .select({ id: s.memberships.userId })
      .from(s.memberships)
      .where(and(eq(s.memberships.schoolId, school.id), eq(s.memberships.role, 'admin')))
      .limit(1);

    const grades = await db
      .select()
      .from(s.gradeLevels)
      .where(eq(s.gradeLevels.schoolId, school.id))
      .orderBy(asc(s.gradeLevels.sort));
    const planByGrade = new Map<string, string>();
    for (const grade of grades) {
      const [plan] = await db
        .insert(s.feePlans)
        .values({ schoolId: school.id, academicYearId: year.id, gradeLevelId: grade.id, name: `رسوم ${grade.name}` })
        .returning({ id: s.feePlans.id });
      await db
        .insert(s.planInstallments)
        .values(
          DEMO_INSTALLMENTS.map((amount, k) => ({ feePlanId: plan.id, seq: k + 1, amount, dueDate: dueDates[k] })),
        );
      planByGrade.set(grade.id, plan.id);
    }

    const pupils = await db
      .select({
        id: s.students.id,
        admittedGradeId: s.students.gradeLevelId,
        classGradeId: s.classSections.gradeLevelId,
      })
      .from(s.students)
      .leftJoin(s.classSections, eq(s.classSections.id, s.students.classSectionId))
      .where(and(eq(s.students.schoolId, school.id), eq(s.students.status, 'active')))
      .orderBy(asc(s.students.createdAt), asc(s.students.code));

    let index = 0;
    for (const pupil of pupils) {
      const planId = planByGrade.get(pupil.classGradeId ?? pupil.admittedGradeId ?? '');
      if (!planId) continue;
      const pattern = PATTERNS[index++ % PATTERNS.length];
      const [fee] = await db
        .insert(s.studentFees)
        .values({ schoolId: school.id, studentId: pupil.id, feePlanId: planId, discount: pattern.discount })
        .returning({ id: s.studentFees.id });
      if (!pattern.payments.length) continue;
      await db.insert(s.payments).values(
        pattern.payments.map((p) => {
          const paidAt = addDays(today, -p.daysAgo);
          return {
            schoolId: school.id,
            studentFeeId: fee.id,
            amount: p.amount,
            paidAt,
            method: p.method,
            receiptNo: `R-${receipt++}`,
            recordedBy: admin?.id ?? null,
            createdAt: new Date(`${paidAt}T08:00:00Z`),
          };
        }),
      );
    }
  }
}
