import { Router } from 'express';
import { and, asc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { addDays, type CalendarKind } from '@slash/shared';
import type { Db } from '../../db/client';
import { calendarEvents } from '../../db/schema';
import { requireRole, schoolOf, userOf } from '../../lib/context';
import { badRequest, notFound } from '../../lib/errors';
import { parse, zId } from '../../lib/validate';
import { calendarRangeQuery, createEventSchema, MAX_EVENT_DAYS, updateEventSchema } from './schemas';

/** A calendar event (P15, admin calendar). Dates are inclusive. */
export interface CalendarEventDto {
  id: string;
  title: string;
  kind: CalendarKind;
  startsOn: string;
  endsOn: string;
  details: string | null;
}

/** Upper bound for one listing (a school has a few dozen events a year). */
const MAX_EVENTS = 500;

const columns = {
  id: calendarEvents.id,
  title: calendarEvents.title,
  kind: calendarEvents.kind,
  startsOn: calendarEvents.startsOn,
  endsOn: calendarEvents.endsOn,
  details: calendarEvents.details,
};

/** Events of the school overlapping [from, to] (either bound optional), ordered by start date. */
export function listEvents(
  db: Db,
  schoolId: string,
  range: { from?: string | null; to?: string | null },
): Promise<CalendarEventDto[]> {
  return db
    .select(columns)
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        range.to ? lte(calendarEvents.startsOn, range.to) : undefined,
        range.from ? gte(calendarEvents.endsOn, range.from) : undefined,
      ),
    )
    .orderBy(asc(calendarEvents.startsOn), asc(calendarEvents.endsOn), asc(calendarEvents.title))
    .limit(MAX_EVENTS);
}

function assertDuration(startsOn: string, endsOn: string) {
  if (endsOn > addDays(startsOn, MAX_EVENT_DAYS)) throw badRequest('مدة الحدث أطول من المسموح (سنة واحدة)');
}

async function findEvent(db: Db, schoolId: string, id: string) {
  const [row] = await db
    .select(columns)
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, schoolId)));
  if (!row) throw notFound('الحدث غير موجود');
  return row;
}

/**
 * The academic calendar, staff side: /api/schools/:schoolId/calendar.
 *   GET    /?from&to   → events overlapping the range, by start date (any staff)
 *   POST   /           {title, kind, startsOn, endsOn?, details?} → 201 (admin)
 *   PATCH  /:eventId   → event (admin)
 *   DELETE /:eventId   → { ok: true } (admin)
 */
export function staffCalendarRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const q = parse(calendarRangeQuery, req.query);
    res.json(await listEvents(db, schoolOf(req).id, q));
  });

  r.post('/', requireRole('admin'), async (req, res) => {
    const school = schoolOf(req);
    const body = parse(createEventSchema, req.body);
    assertDuration(body.startsOn, body.endsOn);
    const [row] = await db
      .insert(calendarEvents)
      .values({
        schoolId: school.id,
        title: body.title,
        kind: body.kind,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        details: body.details,
        createdBy: userOf(req).id,
      })
      .returning(columns);
    res.status(201).json(row satisfies CalendarEventDto);
  });

  r.patch('/:eventId', requireRole('admin'), async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.eventId);
    const body = parse(updateEventSchema, req.body);
    const existing = await findEvent(db, school.id, id);
    const startsOn = body.startsOn ?? existing.startsOn;
    const endsOn = body.endsOn ?? existing.endsOn;
    if (endsOn < startsOn) {
      throw badRequest('بيانات غير صالحة', [
        { path: 'endsOn', message: 'تاريخ النهاية يجب أن يكون في نفس يوم البداية أو بعده' },
      ]);
    }
    assertDuration(startsOn, endsOn);
    const where: SQL | undefined = and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, school.id));
    const [row] = await db
      .update(calendarEvents)
      .set({
        title: body.title ?? existing.title,
        kind: body.kind ?? existing.kind,
        startsOn,
        endsOn,
        details: body.details !== undefined ? body.details : existing.details,
      })
      .where(where)
      .returning(columns);
    res.json(row satisfies CalendarEventDto);
  });

  r.delete('/:eventId', requireRole('admin'), async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.eventId);
    const [deleted] = await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, school.id)))
      .returning({ id: calendarEvents.id });
    if (!deleted) throw notFound('الحدث غير موجود');
    res.json({ ok: true });
  });

  return r;
}
