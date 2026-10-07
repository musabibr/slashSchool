import { Router, type Request } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { addDays, monthBounds, type AudienceType } from '@slash/shared';
import type { Db } from '../../db/client';
import { announcements, studentGuardians } from '../../db/schema';
import { schoolOf, schoolToday, studentOf, userOf } from '../../lib/context';
import { cursorKey, getCursorMap, markSeenIfGuardian } from '../../lib/cursors';
import { parse } from '../../lib/validate';
import { announcementsFor, labelForStudent, loadStudentTarget } from './audience';
import { listEvents, type CalendarEventDto } from './calendar';
import { guardianCalendarQuery, seenBody } from './schemas';
import { countBadges, zeroBadges, type Badges } from './summary';

/** GET /students/:id/summary — must match `StudentSummary` in apps/web/src/api/types.ts. */
export interface StudentSummaryDto {
  student: { id: string; fullName: string; code: string; classLabel: string | null; status: string };
  school: { id: string; name: string; today: string };
  badges: Badges;
}

/** An announcement as a guardian sees it (P16). */
export interface GuardianAnnouncementDto {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  audienceType: AudienceType;
  audienceLabel: string;
  /** Published since the guardian last opened the announcements (always false for staff). */
  isNew: boolean;
}

/** GET /students/:id/calendar (P15). */
export interface GuardianCalendarDto {
  /** YYYY-MM */
  month: string;
  /** Events overlapping the month. */
  events: CalendarEventDto[];
  /** Events between today and 30 days from now. */
  upcoming: CalendarEventDto[];
}

/** Newest announcements shown to a guardian. */
const GUARDIAN_ANNOUNCEMENTS_LIMIT = 200;
const UPCOMING_DAYS = 30;

/** When the current guardian was linked to the student (the badge baseline when a module was never opened). */
async function linkedAt(db: Db, userId: string, studentId: string): Promise<Date | null> {
  const [link] = await db
    .select({ createdAt: studentGuardians.createdAt })
    .from(studentGuardians)
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.userId, userId)));
  return link?.createdAt ?? null;
}

/** For guardians: the moment announcements were last opened (or the link date). Null for staff. */
async function announcementsSeenAt(db: Db, req: Request): Promise<Date | null> {
  const student = studentOf(req);
  if (student.access !== 'guardian') return null;
  const userId = userOf(req).id;
  const [cursors, linked] = await Promise.all([getCursorMap(db, userId, student.id), linkedAt(db, userId, student.id)]);
  return cursors.get(cursorKey('announcements')) ?? linked ?? new Date(0);
}

/**
 * Guardian home summary, announcements and calendar (P3, P15, P16), mounted at /api/students/:studentId.
 *   GET  /summary              → student, school (with today) and the nine unread badges (zeros for staff)
 *   POST /seen {module, scope?} → clears a badge (guardians; a no-op for staff)
 *   GET  /announcements        → announcements aimed at the student, newest first
 *   GET  /calendar?month       → the month's events (+ the next 30 days as `upcoming`)
 */
export function guardianCommsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/summary', async (req, res) => {
    const student = studentOf(req);
    const school = schoolOf(req);
    const target = await loadStudentTarget(db, student);
    let badges = zeroBadges();
    if (student.access === 'guardian') {
      const userId = userOf(req).id;
      const linked = await linkedAt(db, userId, student.id);
      if (linked) badges = await countBadges(db, userId, target, linked);
    }
    const out: StudentSummaryDto = {
      student: {
        id: student.id,
        fullName: student.fullName,
        code: student.code,
        classLabel: target.classLabel,
        status: student.status,
      },
      school: { id: school.id, name: school.name, today: schoolToday(school) },
      badges,
    };
    res.json(out);
  });

  r.post('/seen', async (req, res) => {
    const { module, scope } = parse(seenBody, req.body);
    await markSeenIfGuardian(db, req, module, scope);
    res.json({ ok: true });
  });

  r.get('/announcements', async (req, res) => {
    const student = studentOf(req);
    const [target, seenAt] = await Promise.all([loadStudentTarget(db, student), announcementsSeenAt(db, req)]);
    const rows = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        audienceType: announcements.audienceType,
        publishedAt: announcements.publishedAt,
      })
      .from(announcements)
      .where(announcementsFor(target))
      .orderBy(desc(announcements.publishedAt), desc(announcements.id))
      .limit(GUARDIAN_ANNOUNCEMENTS_LIMIT);
    await markSeenIfGuardian(db, req, 'announcements');
    const out: GuardianAnnouncementDto[] = rows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      publishedAt: a.publishedAt.toISOString(),
      audienceType: a.audienceType,
      audienceLabel: labelForStudent(target, a.audienceType),
      isNew: seenAt ? a.publishedAt > seenAt : false,
    }));
    res.json(out);
  });

  r.get('/calendar', async (req, res) => {
    const student = studentOf(req);
    const today = schoolToday(schoolOf(req));
    const q = parse(guardianCalendarQuery, req.query);
    const month = q.month ?? today.slice(0, 7);
    const [events, upcoming] = await Promise.all([
      listEvents(db, student.schoolId, monthBounds(`${month}-01`)),
      listEvents(db, student.schoolId, { from: today, to: addDays(today, UPCOMING_DAYS) }),
    ]);
    await markSeenIfGuardian(db, req, 'calendar');
    const out: GuardianCalendarDto = { month, events, upcoming };
    res.json(out);
  });

  return r;
}
