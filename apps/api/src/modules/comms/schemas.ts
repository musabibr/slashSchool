import { z } from 'zod';
import { AUDIENCE_TYPES, BADGE_MODULES, CALENDAR_KINDS } from '@slash/shared';
import { zDate, zId, zOptText, zText } from '../../lib/validate';

const invalid = { message: 'قيمة غير صالحة' };

/** Query-string value: '' is treated as "not given". */
const optQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const zLimit = (fallback: number) =>
  z.coerce
    .number({ invalid_type_error: 'رقم غير صالح' })
    .int(invalid)
    .min(1, invalid)
    .max(100, { message: 'الحد الأقصى 100' })
    .default(fallback);
const zOffset = z.coerce.number({ invalid_type_error: 'رقم غير صالح' }).int(invalid).min(0, invalid).default(0);

export const zAudienceType = z.enum(AUDIENCE_TYPES, { errorMap: () => ({ message: 'نوع المستلمين غير صالح' }) });
export const zCalendarKind = z.enum(CALENDAR_KINDS, { errorMap: () => ({ message: 'نوع الحدث غير صالح' }) });

// ───────────────────────────── Announcements ─────────────────────────────

/** GET /schools/:id/announcements */
export const announcementListQuery = z.object({
  audienceType: optQuery(zAudienceType),
  audienceId: optQuery(zId),
  limit: zLimit(20),
  offset: zOffset,
});

/**
 * POST /schools/:id/announcements. `audienceId` is required for every audience except the whole school
 * (where it is ignored).
 */
export const createAnnouncementSchema = z
  .object({
    title: zText(200),
    body: zText(5000),
    audienceType: zAudienceType,
    audienceId: zId.nullish().transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    if (v.audienceType !== 'school' && !v.audienceId) {
      ctx.addIssue({ code: 'custom', path: ['audienceId'], message: 'يجب اختيار المستلمين' });
    }
  })
  .transform((v) => ({ ...v, audienceId: v.audienceType === 'school' ? null : v.audienceId }));
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

// ───────────────────────────── Calendar ─────────────────────────────

/** Longest event accepted (a whole academic year). */
export const MAX_EVENT_DAYS = 366;

const endAfterStart = { message: 'تاريخ النهاية يجب أن يكون في نفس يوم البداية أو بعده', path: ['endsOn'] };

/** GET /schools/:id/calendar?from&to — either bound may be omitted. */
export const calendarRangeQuery = z
  .object({ from: optQuery(zDate), to: optQuery(zDate) })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'تاريخ البداية بعد تاريخ النهاية',
    path: ['to'],
  });

const eventFields = {
  title: zText(200),
  kind: zCalendarKind,
  startsOn: zDate,
  endsOn: zDate,
  details: zOptText(2000),
};

/** POST /schools/:id/calendar. `endsOn` defaults to `startsOn` (a one-day event). */
export const createEventSchema = z
  .object({ ...eventFields, endsOn: eventFields.endsOn.optional() })
  .transform((v) => ({ ...v, endsOn: v.endsOn ?? v.startsOn }))
  .refine((v) => v.endsOn >= v.startsOn, endAfterStart);
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** PATCH /schools/:id/calendar/:eventId — absent keys stay unchanged; the merged range is checked by the route. */
export const updateEventSchema = z
  .object({
    title: eventFields.title.optional(),
    kind: eventFields.kind.optional(),
    startsOn: eventFields.startsOn.optional(),
    endsOn: eventFields.endsOn.optional(),
    details: eventFields.details.optional(),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, endAfterStart);
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// ───────────────────────────── Guardian ─────────────────────────────

/** GET /students/:id/calendar?month=YYYY-MM */
export const guardianCalendarQuery = z.object({
  month: optQuery(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'الشهر غير صالح (YYYY-MM)' })),
});

/** POST /students/:id/seen — `scope` is a subject id for per-subject badges, '' otherwise. */
export const seenBody = z.object({
  module: z.enum(BADGE_MODULES, { errorMap: () => ({ message: 'القسم غير صالح' }) }),
  scope: z
    .union([z.literal(''), zId])
    .nullish()
    .transform((v) => v ?? ''),
});
