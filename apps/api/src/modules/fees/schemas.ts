import { z } from 'zod';
import { PAYMENT_METHODS } from '@slash/shared';
import { zDate, zId, zOptText, zText } from '../../lib/validate';

/** A fee plan holds 1–12 installments. */
export const MAX_INSTALLMENTS = 12;
/** Upper bound for any single amount (whole SDG). */
const MAX_AMOUNT = 1_000_000_000;

const zNumber = (required: string) =>
  z.number({ required_error: required, invalid_type_error: 'يجب إدخال رقم صحيح' }).int({
    message: 'المبلغ يجب أن يكون رقماً صحيحاً',
  });

/** Amount of an installment or payment: a whole number of SDG, more than zero. */
export const zAmount = zNumber('المبلغ مطلوب')
  .min(1, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  .max(MAX_AMOUNT, { message: 'المبلغ أكبر من المسموح' });

/** Per-student discount: a whole number of SDG, zero or more. */
export const zDiscount = zNumber('قيمة الخصم مطلوبة')
  .min(0, { message: 'الخصم لا يمكن أن يكون سالباً' })
  .max(MAX_AMOUNT, { message: 'الخصم أكبر من المسموح' });

const installmentSchema = z.object({ amount: zAmount, dueDate: zDate });

const installmentsSchema = z
  .array(installmentSchema, { required_error: 'الأقساط مطلوبة', invalid_type_error: 'قيمة غير صالحة' })
  .min(1, { message: 'يجب إضافة قسط واحد على الأقل' })
  .max(MAX_INSTALLMENTS, { message: `الحد الأقصى ${MAX_INSTALLMENTS} قسطاً` })
  .superRefine((list, ctx) => {
    for (let i = 1; i < list.length; i++) {
      if (list[i].dueDate <= list[i - 1].dueDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'dueDate'],
          message: 'تاريخ كل قسط يجب أن يكون بعد تاريخ القسط الذي قبله',
        });
      }
    }
  });
export type InstallmentsInput = z.infer<typeof installmentsSchema>;

/** POST /plans */
export const createPlanSchema = z.object({
  name: zText(120),
  gradeLevelId: zId.nullish().transform((v) => v ?? null),
  installments: installmentsSchema,
});

/** PATCH /plans/:id — absent keys stay unchanged; `installments` replaces the whole schedule. */
export const updatePlanSchema = z.object({
  name: zText(120).optional(),
  gradeLevelId: zId.nullable().optional(),
  installments: installmentsSchema.optional(),
});

/** POST /plans/:id/assign — the given students, all active students of a grade level, or both. */
export const assignSchema = z
  .object({
    studentIds: z
      .array(zId, { invalid_type_error: 'قيمة غير صالحة' })
      .max(5000, { message: 'عدد كبير من الطلاب' })
      .optional(),
    gradeLevelId: zId.optional(),
    discount: zDiscount.optional(),
  })
  .refine((b) => (b.studentIds?.length ?? 0) > 0 || !!b.gradeLevelId, {
    message: 'اختر الطلاب أو الصف',
    path: ['studentIds'],
  });

/** PATCH /student-fees/:id */
export const discountSchema = z.object({ discount: zDiscount });

/** POST /student-fees/:id/payments */
export const paymentSchema = z.object({
  amount: zAmount,
  paidAt: zDate,
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'طريقة الدفع غير صالحة' }) }),
  receiptNo: zOptText(60),
  note: zOptText(500),
});
