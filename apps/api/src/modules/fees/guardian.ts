import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { payments, studentFees } from '../../db/schema';
import { hasRole, schoolOf, schoolToday, studentOf } from '../../lib/context';
import { markSeenIfGuardian } from '../../lib/cursors';
import { forbidden } from '../../lib/errors';
import { loadAccounts, sumAccounts } from './service';

/**
 * P9 — a student's fees: /api/students/:studentId/fees.
 * The student's guardians, and the school's admins and supervisors (teachers do not see fees).
 * Every number is derived with `computeFeeAccount` as of the school's today.
 */
export function guardianFeesRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const student = studentOf(req);
    if (student.access !== 'guardian' && !hasRole(req, 'admin', 'supervisor')) throw forbidden();
    const today = schoolToday(schoolOf(req));
    const [accounts, paid] = await Promise.all([
      loadAccounts(db, student.schoolId, today, student.id),
      db
        .select({
          amount: payments.amount,
          paidAt: payments.paidAt,
          method: payments.method,
          receiptNo: payments.receiptNo,
        })
        .from(payments)
        .innerJoin(studentFees, eq(studentFees.id, payments.studentFeeId))
        .where(and(eq(payments.schoolId, student.schoolId), eq(studentFees.studentId, student.id)))
        .orderBy(desc(payments.paidAt), desc(payments.createdAt)),
    ]);
    await markSeenIfGuardian(db, req, 'fees');
    res.json({
      today,
      plans: accounts.map(({ planName, account }) => ({
        planName,
        total: account.total,
        discount: account.discount,
        net: account.net,
        paid: account.paid,
        remaining: account.remaining,
        overdue: account.overdue,
        credit: account.credit,
        installments: account.installments.map((i) => ({
          seq: i.seq,
          amount: i.amount,
          due: i.due,
          paid: i.paid,
          remaining: i.remaining,
          dueDate: i.dueDate,
          status: i.status,
        })),
      })),
      totals: sumAccounts(accounts),
      payments: paid,
    });
  });

  return r;
}
