import { z } from 'zod';
import { DATE_RANGES } from '@slash/shared';
import { zDate, zId, zOptDate, zOptText, zText } from '../../lib/validate';

/** Max files attached to one lesson. */
export const MAX_ATTACHMENTS = 10;

const invalid = { message: 'قيمة غير صالحة' };

/** Query-string value: '' is treated as "not given". */
const optQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const zBool = z.boolean({ required_error: 'هذا الحقل مطلوب', invalid_type_error: 'قيمة غير صالحة' });

const zAttachmentIds = z
  .array(zId, { invalid_type_error: 'قيمة غير صالحة' })
  .max(MAX_ATTACHMENTS, { message: `الحد الأقصى ${MAX_ATTACHMENTS} مرفقات للدرس الواحد` })
  .transform((ids) => [...new Set(ids)]);

const fields = {
  title: zText(200),
  pages: zOptText(100),
  details: zOptText(5000),
  homeworkDetails: zOptText(5000),
};

/** POST /lessons (S5 / T4). Missing optional text becomes null; `date` defaults to the school's today. */
export const createLessonSchema = z.object({
  classSectionId: zId,
  subjectId: zId,
  date: zDate.optional(),
  title: fields.title,
  pages: fields.pages,
  details: fields.details,
  hasHomework: zBool,
  homeworkDetails: fields.homeworkDetails,
  homeworkDueDate: zOptDate,
  attachmentIds: zAttachmentIds.optional(),
});
export type CreateLessonInput = z.infer<typeof createLessonSchema>;

/**
 * PATCH /lessons/:id (S7 / T6). Every field is optional; a key that is absent stays `undefined` (unchanged),
 * while `null` / '' clears an optional field.
 */
export const updateLessonSchema = z.object({
  classSectionId: zId.optional(),
  subjectId: zId.optional(),
  date: zDate.optional(),
  title: fields.title.optional(),
  pages: fields.pages.optional(),
  details: fields.details.optional(),
  hasHomework: zBool.optional(),
  homeworkDetails: fields.homeworkDetails.optional(),
  homeworkDueDate: zOptDate.optional(),
  attachmentIds: zAttachmentIds.optional(),
});
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;

/** GET /lessons (S6 / T5). */
export const staffListQuery = z.object({
  classId: optQuery(zId),
  subjectId: optQuery(zId),
  from: optQuery(zDate),
  to: optQuery(zDate),
  limit: z.coerce
    .number({ invalid_type_error: 'رقم غير صالح' })
    .int(invalid)
    .min(1, invalid)
    .max(100, { message: 'الحد الأقصى 100' })
    .default(50),
  offset: z.coerce.number({ invalid_type_error: 'رقم غير صالح' }).int(invalid).min(0, invalid).default(0),
});

export const LESSON_MODULES = ['lessons', 'homework'] as const;
export type LessonModule = (typeof LESSON_MODULES)[number];

/** GET /students/:id/subjects (P4 / P6). */
export const subjectsQuery = z.object({
  module: z.enum(LESSON_MODULES, { errorMap: () => invalid }).default('lessons'),
});

/** GET /students/:id/lessons and /homework (P5 / P7). */
export const guardianListQuery = z.object({
  subjectId: optQuery(zId),
  range: z.enum(DATE_RANGES, { errorMap: () => invalid }).default('all'),
});

/** PUT /students/:id/homework/:lessonId/done (P7 "تم"). */
export const homeworkDoneBody = z.object({ done: zBool });
