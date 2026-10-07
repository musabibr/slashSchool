import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_GRADE_BANDS, isValidPhone, normalizePhone, type GradeBand } from '@slash/shared';
import type { Db } from '../../../db/client';
import { schools } from '../../../db/schema';
import { audit } from '../../../lib/audit';
import { requireRole, schoolOf, userOf } from '../../../lib/context';
import { notFound } from '../../../lib/errors';
import { parse, zOptText, zText } from '../../../lib/validate';
import { nonEmpty, NOTHING_TO_UPDATE } from './common';

export const MAX_GRADE_BANDS = 10;

const zBand = z.object({
  min: z
    .number({ required_error: 'الحد الأدنى مطلوب', invalid_type_error: 'الحد الأدنى يجب أن يكون رقماً' })
    .min(0, { message: 'الحد الأدنى يجب أن يكون بين 0 و 100' })
    .max(100, { message: 'الحد الأدنى يجب أن يكون بين 0 و 100' }),
  label: zText(30),
});

const zGradeBands = z
  .array(zBand, { invalid_type_error: 'التقديرات غير صالحة' })
  .min(1, { message: 'أضف تقديراً واحداً على الأقل' })
  .max(MAX_GRADE_BANDS, { message: `لا يمكن أن يتجاوز عدد التقديرات ${MAX_GRADE_BANDS}` })
  .superRefine((bands, ctx) => {
    const seen = new Set<number>();
    bands.forEach((b, i) => {
      if (seen.has(b.min)) ctx.addIssue({ code: 'custom', path: [i, 'min'], message: 'الحد الأدنى مكرر' });
      seen.add(b.min);
    });
    if (!bands.some((b) => b.min === 0)) {
      ctx.addIssue({ code: 'custom', message: 'يجب أن يبدأ أحد التقديرات من 0' });
    }
  })
  .transform((bands) => [...bands].sort((a, b) => b.min - a.min));

const patchBody = z
  .object({
    name: zText(120).optional(),
    phone: zOptText(30)
      .refine((v) => v === null || isValidPhone(v), { message: 'رقم الهاتف غير صالح' })
      .transform((v) => (v === null ? null : normalizePhone(v)))
      .optional(),
    address: zOptText(300).optional(),
    weekStart: z
      .number({ invalid_type_error: 'بداية الأسبوع غير صالحة' })
      .int({ message: 'بداية الأسبوع غير صالحة' })
      .min(0, { message: 'بداية الأسبوع غير صالحة' })
      .max(6, { message: 'بداية الأسبوع غير صالحة' })
      .optional(),
    gradeBands: zGradeBands.optional(),
  })
  .refine(nonEmpty, NOTHING_TO_UPDATE);

export interface SchoolSettings {
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  weekStart: number;
  /** Highest band first. */
  gradeBands: GradeBand[];
}

function toSettings(row: typeof schools.$inferSelect): SchoolSettings {
  const bands = row.gradeBands && row.gradeBands.length ? row.gradeBands : DEFAULT_GRADE_BANDS;
  return {
    name: row.name,
    code: row.code,
    phone: row.phone,
    address: row.address,
    timezone: row.timezone,
    weekStart: row.weekStart,
    gradeBands: [...bands].sort((a, b) => b.min - a.min),
  };
}

/**
 * School settings (admin "الإعدادات"): /api/schools/:schoolId/settings
 *   GET   / → {name, code, phone, address, timezone, weekStart, gradeBands}
 *   PATCH / {name?, phone?, address?, weekStart?, gradeBands?}
 */
export function settingsRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin'));

  r.get('/', async (req, res) => {
    const [row] = await db.select().from(schools).where(eq(schools.id, schoolOf(req).id));
    if (!row) throw notFound('المدرسة غير موجودة');
    res.json(toSettings(row));
  });

  r.patch('/', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(patchBody, req.body);
    const [before] = await db.select().from(schools).where(eq(schools.id, school.id));
    if (!before) throw notFound('المدرسة غير موجودة');
    const [row] = await db
      .update(schools)
      .set({
        name: body.name,
        phone: body.phone,
        address: body.address,
        weekStart: body.weekStart,
        gradeBands: body.gradeBands,
      })
      .where(eq(schools.id, school.id))
      .returning();
    await audit(db, {
      schoolId: school.id,
      actorId: userOf(req).id,
      entity: 'school',
      entityId: school.id,
      action: 'update',
      before: toSettings(before),
      after: toSettings(row),
    });
    res.json(toSettings(row));
  });

  return r;
}
