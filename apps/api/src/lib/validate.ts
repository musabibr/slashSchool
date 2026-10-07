import { z } from 'zod';
import { isIsoDate } from '@slash/shared';
import { badRequest } from './errors';

/** Parse request input; throws a 400 with per-field details on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'بيانات غير صالحة',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const zId = z.string().uuid({ message: 'معرّف غير صالح' });
export const zDate = z.string().refine(isIsoDate, { message: 'تاريخ غير صالح (YYYY-MM-DD)' });
/** Required, trimmed text. */
export const zText = (max = 2000) =>
  z.string().trim().min(1, { message: 'هذا الحقل مطلوب' }).max(max, { message: 'النص أطول من المسموح' });
/** Optional text: '', null and undefined all become null. */
export const zOptText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max, { message: 'النص أطول من المسموح' })
    .nullish()
    .transform((v) => (v ? v : null));
export const zOptDate = zDate.nullish().transform((v) => v ?? null);
export const zMoney = z.number().int({ message: 'المبلغ يجب أن يكون رقماً صحيحاً' }).min(0).max(1_000_000_000);
export const zPin = z.string().regex(/^\d{4,6}$/, { message: 'الرقم السري يجب أن يكون من 4 إلى 6 أرقام' });
