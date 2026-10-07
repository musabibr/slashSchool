import { z } from 'zod';
import { EVALUATION_RATINGS } from '@slash/shared';
import { zDate, zId, zOptText, zText } from '../../lib/validate';

const invalid = { message: 'قيمة غير صالحة' };

/** Query-string value: '' is treated as "not given". */
const optQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

// ───────────────────────────── Regulations ─────────────────────────────

const regulationFields = {
  code: zOptText(30),
  title: zText(300),
  defaultPenalty: zOptText(300),
};

/** POST /regulations. */
export const createRegulationSchema = z.object({
  code: regulationFields.code,
  title: regulationFields.title,
  defaultPenalty: regulationFields.defaultPenalty,
});
export type CreateRegulationInput = z.infer<typeof createRegulationSchema>;

/** PATCH /regulations/:id — an absent key is unchanged; null / '' clears an optional field. */
export const updateRegulationSchema = z
  .object({
    code: regulationFields.code.optional(),
    title: regulationFields.title.optional(),
    defaultPenalty: regulationFields.defaultPenalty.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'لا توجد بيانات للتعديل' });
export type UpdateRegulationInput = z.infer<typeof updateRegulationSchema>;

// ───────────────────────────── Behavior incidents ─────────────────────────────

/**
 * POST /behavior (S15, admin student page). `date` defaults to the school's today.
 * `penalty` absent → the regulation's default penalty; null / '' → no penalty.
 */
export const createIncidentSchema = z.object({
  studentId: zId,
  regulationId: zId,
  date: zDate.optional(),
  details: zOptText(2000),
  penalty: zOptText(300).optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

/** GET /behavior. */
export const incidentListQuery = z
  .object({
    studentId: optQuery(zId),
    classId: optQuery(zId),
    from: optQuery(zDate),
    to: optQuery(zDate),
    limit: z.coerce
      .number({ invalid_type_error: 'رقم غير صالح' })
      .int(invalid)
      .min(1, invalid)
      .max(200, { message: 'الحد الأقصى 200' })
      .default(50),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'تاريخ البداية بعد تاريخ النهاية', path: ['to'] });

// ───────────────────────────── Evaluations ─────────────────────────────

const zRating = z.enum(EVALUATION_RATINGS, { errorMap: () => ({ message: 'تقييم غير صالح' }) });

/** Most evaluations returned to a guardian (P14). */
export const GUARDIAN_EVALUATIONS_LIMIT = 30;

/** GET /evaluations. */
export const evaluationQuery = z.object({ classId: zId, subjectId: zId, date: zDate });

/** PUT /evaluations (S17 / T9). A null rating removes that student's evaluation for the day. */
export const saveEvaluationsSchema = z.object({
  classSectionId: zId,
  subjectId: zId,
  date: zDate,
  items: z
    .array(
      z
        .object({
          studentId: zId,
          rating: zRating.nullable(),
          comment: zOptText(500),
        })
        // The comment belongs to the rating row; a comment alone cannot be stored.
        .refine((i) => i.rating !== null || i.comment === null, {
          message: 'اختر التقييم قبل إضافة تعليق',
          path: ['comment'],
        }),
      { required_error: 'قائمة الطلاب مطلوبة', invalid_type_error: 'قائمة الطلاب غير صالحة' },
    )
    .max(500, { message: 'عدد كبير من الطلاب' })
    .refine((items) => new Set(items.map((i) => i.studentId)).size === items.length, {
      message: 'الطالب مكرر في القائمة',
    }),
});
export type SaveEvaluationsInput = z.infer<typeof saveEvaluationsSchema>;
