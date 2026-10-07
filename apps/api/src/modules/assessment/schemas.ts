import { z } from 'zod';
import { ASSESSMENT_KINDS, EXAM_PERIOD_KINDS } from '@slash/shared';
import { zDate, zId, zOptText, zText } from '../../lib/validate';

/** Highest "الدرجة النهائية" an assessment may have. */
export const MAX_SCORE_LIMIT = 1000;
/** Subjects in one exam timetable. */
export const MAX_TIMETABLE_ROWS = 50;
/** Students in one score save (a class is far smaller). */
export const MAX_SCORE_ROWS = 500;

const invalid = { message: 'قيمة غير صالحة' };

/** Query-string value: '' is treated as "not given". */
const optQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const zMaxScore = z
  .number({ required_error: 'الدرجة النهائية مطلوبة', invalid_type_error: 'الدرجة النهائية غير صالحة' })
  .int({ message: 'الدرجة النهائية يجب أن تكون رقماً صحيحاً' })
  .min(1, { message: 'الدرجة النهائية يجب أن تكون 1 على الأقل' })
  .max(MAX_SCORE_LIMIT, { message: `الدرجة النهائية يجب ألا تتجاوز ${MAX_SCORE_LIMIT}` });

const zPeriodKind = z.enum(EXAM_PERIOD_KINDS, { errorMap: () => ({ message: 'نوع الامتحان غير صالح' }) });
const zAssessmentKind = z.enum(ASSESSMENT_KINDS, { errorMap: () => ({ message: 'نوع الاختبار غير صالح' }) });

// ───────────────────────────── Exam periods (S12) ─────────────────────────────

/** GET /exam-periods */
export const periodsQuery = z.object({ gradeLevelId: optQuery(zId) });

/** POST /exam-periods */
export const createPeriodSchema = z.object({
  gradeLevelId: zId,
  kind: zPeriodKind,
  name: zText(200),
});

/** PATCH /exam-periods/:id */
export const updatePeriodSchema = z.object({
  name: zText(200).optional(),
  kind: zPeriodKind.optional(),
});

/** PUT /exam-periods/:id/timetable — one row per subject. */
export const timetableSchema = z.object({
  rows: z
    .array(z.object({ subjectId: zId, date: zDate, maxScore: zMaxScore }), {
      required_error: 'قائمة المواد مطلوبة',
      invalid_type_error: invalid.message,
    })
    .max(MAX_TIMETABLE_ROWS, { message: `الحد الأقصى ${MAX_TIMETABLE_ROWS} مادة` })
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (seen.has(r.subjectId)) ctx.addIssue({ code: 'custom', path: [i, 'subjectId'], message: 'المادة مكررة' });
        seen.add(r.subjectId);
      });
    }),
});
export type TimetableRowInput = z.infer<typeof timetableSchema>['rows'][number];

/** POST /exam-periods/:id/publish */
export const publishSchema = z.object({
  published: z.boolean({ required_error: 'هذا الحقل مطلوب', invalid_type_error: invalid.message }),
});

/** GET /exam-periods/:id/results */
export const periodResultsQuery = z.object({ classId: optQuery(zId) });

// ───────────────────────────── Assessments (S13 / S14) ─────────────────────────────

/** GET /assessments */
export const assessmentsQuery = z.object({
  classId: optQuery(zId),
  subjectId: optQuery(zId),
  kind: optQuery(zAssessmentKind),
  examPeriodId: optQuery(zId),
  limit: z.coerce
    .number({ invalid_type_error: 'رقم غير صالح' })
    .int(invalid)
    .min(1, invalid)
    .max(500, { message: 'الحد الأقصى 500' })
    .default(200),
});

const quizFields = {
  classSectionId: zId,
  subjectId: zId,
  title: zText(200),
  date: zDate,
  maxScore: zMaxScore,
  details: zOptText(2000),
};

/** POST /assessments — a quiz announcement (S13). */
export const createQuizSchema = z.object(quizFields);
export type CreateQuizInput = z.infer<typeof createQuizSchema>;

/** PATCH /assessments/:id — absent keys stay unchanged; `details: null | ''` clears. */
export const updateQuizSchema = z.object({
  classSectionId: quizFields.classSectionId.optional(),
  subjectId: quizFields.subjectId.optional(),
  title: quizFields.title.optional(),
  date: quizFields.date.optional(),
  maxScore: quizFields.maxScore.optional(),
  details: quizFields.details.optional(),
});

/** A score, rounded to two decimals; `null` removes the student's score. */
const zScore = z
  .number({ required_error: 'الدرجة مطلوبة', invalid_type_error: 'الدرجة غير صالحة' })
  .finite({ message: 'الدرجة غير صالحة' })
  .min(0, { message: 'الدرجة لا يمكن أن تكون سالبة' })
  .transform((v) => Math.round(v * 100) / 100)
  .nullable();

/** PUT /assessments/:id/scores (S14 / T7). */
export const saveScoresSchema = z.object({
  scores: z
    .array(z.object({ studentId: zId, score: zScore }), {
      required_error: 'قائمة الدرجات مطلوبة',
      invalid_type_error: invalid.message,
    })
    .max(MAX_SCORE_ROWS, { message: 'عدد كبير من الطلاب' })
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (seen.has(r.studentId)) ctx.addIssue({ code: 'custom', path: [i, 'studentId'], message: 'الطالب مكرر' });
        seen.add(r.studentId);
      });
    }),
});
