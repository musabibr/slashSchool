import { z } from 'zod';
import { GENDERS, isValidPhone, normalizePhone, RELATIONS, STUDENT_STATUSES, USER_STATUSES } from '@slash/shared';
import { zDate, zId, zOptDate, zOptText, zText } from '../../../lib/validate';

/** Most students a single CSV import may carry. */
export const MAX_IMPORT_ROWS = 2000;

const invalid = { message: 'قيمة غير صالحة' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query-string value: '' is treated as "not given". */
const optQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/** Enum with Arabic messages ("required" when missing, "invalid" otherwise). */
const zEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values as unknown as [T[number], ...Array<T[number]>], {
    errorMap: (_issue, ctx) => ({ message: ctx.data === undefined ? 'هذا الحقل مطلوب' : 'قيمة غير صالحة' }),
  });

const zBool = z.boolean({ invalid_type_error: 'قيمة غير صالحة' });

/** Required Sudanese mobile number, stored normalized (0XXXXXXXXX). */
export const zPhone = z
  .string({ required_error: 'رقم الهاتف مطلوب', invalid_type_error: 'رقم الهاتف غير صالح' })
  .trim()
  .min(1, { message: 'رقم الهاتف مطلوب' })
  .refine(isValidPhone, { message: 'رقم الهاتف غير صالح' })
  .transform(normalizePhone);

/** Optional phone: '', null and undefined become null; otherwise it must be valid. */
export const zOptPhone = z
  .string({ invalid_type_error: 'رقم الهاتف غير صالح' })
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidPhone(v), { message: 'رقم الهاتف غير صالح' })
  .transform((v) => (v === null ? null : normalizePhone(v)));

const zName = zText(60);
const zOptName = zOptText(60);

const guardianDetails = {
  whatsapp: zOptPhone,
  occupation: zOptText(120),
  workplace: zOptText(120),
  locality: zOptText(120),
  residence: zOptText(200),
};

const pagination = {
  limit: z.coerce
    .number({ invalid_type_error: 'رقم غير صالح' })
    .int(invalid)
    .min(1, invalid)
    .max(100, { message: 'الحد الأقصى 100' })
    .default(50),
  offset: z.coerce.number({ invalid_type_error: 'رقم غير صالح' }).int(invalid).min(0, invalid).default(0),
};

const zSearch = z.string().trim().max(100, { message: 'النص أطول من المسموح' });

/** GET /students (D2). `classId=none` lists students not placed in a class yet. */
export const listStudentsQuery = z.object({
  q: optQuery(zSearch),
  classId: optQuery(z.string().refine((v) => v === 'none' || UUID_RE.test(v), { message: 'معرّف غير صالح' })),
  gradeLevelId: optQuery(zId),
  status: optQuery(zEnum(STUDENT_STATUSES)),
  ...pagination,
});

/** GET /guardians (sidebar "أولياء الأمور"). */
export const listGuardiansQuery = z.object({
  q: optQuery(zSearch),
  status: optQuery(zEnum(USER_STATUSES)),
  ...pagination,
});

/** POST /students — the D3 admission form. */
export const admissionSchema = z
  .object({
    student: z.object({
      firstName: zName,
      fatherName: zName,
      grandfatherName: zName,
      greatGrandfatherName: zOptName,
      gender: zEnum(GENDERS),
      birthDate: zOptDate,
      gradeLevelId: zId,
      classSectionId: zId.nullish().transform((v) => v ?? null),
      registeredAt: zDate.optional(),
    }),
    mother: z
      .object({
        name: zOptText(120),
        phone: zOptPhone,
        whatsapp: zOptPhone,
      })
      .default({}),
    guardian: z.object({
      firstName: zName,
      fatherName: zName,
      grandfatherName: zName,
      greatGrandfatherName: zOptName,
      phone: zPhone,
      relation: zEnum(RELATIONS).default('father'),
      ...guardianDetails,
    }),
    /** Also give the mother her own app account (a second guardian). */
    motherAccount: zBool.default(false),
  })
  .superRefine((b, ctx) => {
    if (!b.motherAccount) return;
    if (!b.mother.name) {
      ctx.addIssue({ code: 'custom', path: ['mother', 'name'], message: 'اسم الوالدة مطلوب لإنشاء حساب لها' });
    }
    if (!b.mother.phone) {
      ctx.addIssue({ code: 'custom', path: ['mother', 'phone'], message: 'رقم الوالدة مطلوب لإنشاء حساب لها' });
    } else if (b.mother.phone === b.guardian.phone) {
      ctx.addIssue({ code: 'custom', path: ['mother', 'phone'], message: 'رقم الوالدة مطابق لرقم ولي الأمر' });
    }
  });
export type AdmissionInput = z.infer<typeof admissionSchema>;

/**
 * PATCH /students/:id. Absent keys stay unchanged; null / '' clears an optional field.
 * Moving to a class also sets the grade level from the class.
 */
export const updateStudentSchema = z.object({
  firstName: zName.optional(),
  fatherName: zName.optional(),
  grandfatherName: zName.optional(),
  greatGrandfatherName: zOptName.optional(),
  gender: zEnum(GENDERS).optional(),
  birthDate: zOptDate.optional(),
  gradeLevelId: zId.optional(),
  classSectionId: zId.nullable().optional(),
  registeredAt: zDate.optional(),
  notes: zOptText(2000).optional(),
  motherName: zOptText(120).optional(),
  motherPhone: zOptPhone.optional(),
  motherWhatsapp: zOptPhone.optional(),
});
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

/** PATCH /students/:id/status — expel (D4 "فصل طالب"), withdraw or reactivate. */
export const statusSchema = z
  .object({ status: zEnum(STUDENT_STATUSES), reason: zOptText(500) })
  .superRefine((b, ctx) => {
    if (b.status === 'expelled' && !b.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'سبب الفصل مطلوب' });
    }
  });

/** POST /students/:id/guardians */
export const addGuardianSchema = z.object({
  fullName: zText(150),
  phone: zPhone,
  relation: zEnum(RELATIONS),
  isPrimary: zBool.optional(),
  ...guardianDetails,
});

/** PATCH /students/:id/guardians/:userId — the link details (the account's name and phone are global). */
export const updateGuardianSchema = z.object({
  relation: zEnum(RELATIONS).optional(),
  isPrimary: zBool.optional(),
  whatsapp: guardianDetails.whatsapp.optional(),
  occupation: guardianDetails.occupation.optional(),
  workplace: guardianDetails.workplace.optional(),
  locality: guardianDetails.locality.optional(),
  residence: guardianDetails.residence.optional(),
});

/** A CSV cell: strings and numbers (spreadsheets turn phones into numbers) become trimmed text. */
const cell = z
  .union([z.string(), z.number()], { invalid_type_error: 'قيمة غير صالحة' })
  .nullish()
  .transform((v) => (v === null || v === undefined ? '' : String(v).trim()));

export const importRowSchema = z.object({
  studentFirstName: cell,
  studentFatherName: cell,
  studentGrandfatherName: cell,
  studentGreatGrandfatherName: cell,
  gender: cell,
  gradeLevel: cell,
  classSection: cell,
  birthDate: cell,
  guardianName: cell,
  guardianPhone: cell,
  relation: cell,
  motherName: cell,
  motherPhone: cell,
});
export type ImportRowInput = z.infer<typeof importRowSchema>;

/** POST /students/import — validate (dryRun) or import a parsed CSV. */
export const importSchema = z.object({
  rows: z
    .array(importRowSchema, { required_error: 'لا توجد صفوف للاستيراد', invalid_type_error: 'قيمة غير صالحة' })
    .min(1, { message: 'لا توجد صفوف للاستيراد' })
    .max(MAX_IMPORT_ROWS, { message: `الحد الأقصى ${MAX_IMPORT_ROWS} طالب في المرة الواحدة` }),
  dryRun: zBool.default(true),
});
