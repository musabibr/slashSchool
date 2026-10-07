import { Router, type Request } from 'express';
import { and, eq, gt, gte, inArray, lte, max, type SQL } from 'drizzle-orm';
import { dateRangeBounds } from '@slash/shared';
import type { Db } from '../../db/client';
import { homeworkDone, lessons, studentGuardians, subjects, teachingAssignments } from '../../db/schema';
import { requireGuardianAccess, schoolOf, schoolToday, studentOf, userOf } from '../../lib/context';
import { cursorKey, getCursorMap, markSeenIfGuardian } from '../../lib/cursors';
import { badRequest, notFound } from '../../lib/errors';
import { assertSubjectInSchool } from '../../lib/scope';
import { parse, zId } from '../../lib/validate';
import { guardianListQuery, homeworkDoneBody, subjectsQuery, type LessonModule } from './schemas';
import { loadAttachments, queryLessons, type GuardianLessonDto } from './service';

/** Upper bound for one guardian list (a subject has well under this many lessons a year). */
const GUARDIAN_LIST_LIMIT = 500;

export interface SubjectTileDto {
  id: string;
  name: string;
  /** Lessons (or homework) added since the guardian last opened this subject; 0 for staff. */
  badge: number;
  /** Date of the latest lesson (or homework) in this subject, if any. */
  lastDate: string | null;
}

export interface GuardianHomeworkDto extends GuardianLessonDto {
  done: boolean;
}

interface SeenBaseline {
  /** When the guardian last opened this subject (or was linked to the student, if never). */
  of(subjectId: string): Date;
  /** The oldest of those moments: nothing created before it can count towards a badge. */
  oldest: Date;
}

/**
 * For guardians: "last seen" per subject of a module — the subject cursor, else the moment the guardian
 * was linked to the student. Returns null for staff (they have no badges).
 */
async function seenBaseline(db: Db, req: Request, module: LessonModule): Promise<SeenBaseline | null> {
  const student = studentOf(req);
  if (student.access !== 'guardian') return null;
  const userId = userOf(req).id;
  const [cursors, [link]] = await Promise.all([
    getCursorMap(db, userId, student.id),
    db
      .select({ createdAt: studentGuardians.createdAt })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.studentId, student.id), eq(studentGuardians.userId, userId))),
  ]);
  const fallback = link?.createdAt ?? new Date(0);
  const prefix = cursorKey(module, '');
  let oldest = fallback;
  for (const [key, seenAt] of cursors) {
    if (key.startsWith(prefix) && key !== prefix && seenAt < oldest) oldest = seenAt;
  }
  return { of: (subjectId) => cursors.get(cursorKey(module, subjectId)) ?? fallback, oldest };
}

/** Lessons of the student's current class (only those with homework for the homework module). */
function classLessons(student: { schoolId: string }, classSectionId: string, module: LessonModule): SQL | undefined {
  return and(
    eq(lessons.schoolId, student.schoolId),
    eq(lessons.classSectionId, classSectionId),
    module === 'homework' ? eq(lessons.hasHomework, true) : undefined,
  );
}

/**
 * Guardian lessons & homework (P4–P7), mounted at /api/students/:studentId.
 *   GET /subjects?module=lessons|homework   → subject tiles with per-subject badges
 *   GET /lessons?subjectId&range            → lessons of the student's class
 *   GET /homework?subjectId&range           → lessons with homework + done flag
 *   PUT /homework/:lessonId/done {done}     → guardians only
 */
export function guardianLessonsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/subjects', async (req, res) => {
    const student = studentOf(req);
    const { module } = parse(subjectsQuery, req.query);
    const classSectionId = student.classSectionId;
    if (!classSectionId) {
      await markSeenIfGuardian(db, req, module);
      res.json([]);
      return;
    }
    const where = classLessons(student, classSectionId, module);
    const [assigned, withLessons, baseline] = await Promise.all([
      db
        .selectDistinct({ id: subjects.id, name: subjects.name, sort: subjects.sort })
        .from(teachingAssignments)
        .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
        .where(and(eq(teachingAssignments.classSectionId, classSectionId), eq(subjects.schoolId, student.schoolId))),
      db
        .select({ id: subjects.id, name: subjects.name, sort: subjects.sort, lastDate: max(lessons.date) })
        .from(lessons)
        .innerJoin(subjects, eq(subjects.id, lessons.subjectId))
        .where(where)
        .groupBy(subjects.id, subjects.name, subjects.sort),
      seenBaseline(db, req, module),
    ]);

    const badges = new Map<string, number>();
    if (baseline) {
      const created = await db
        .select({ subjectId: lessons.subjectId, createdAt: lessons.createdAt })
        .from(lessons)
        .where(and(where, gt(lessons.createdAt, baseline.oldest)));
      for (const row of created) {
        if (row.createdAt > baseline.of(row.subjectId)) {
          badges.set(row.subjectId, (badges.get(row.subjectId) ?? 0) + 1);
        }
      }
    }

    const tiles = new Map<string, SubjectTileDto & { sort: number }>();
    for (const s of [...assigned.map((a) => ({ ...a, lastDate: null })), ...withLessons]) {
      tiles.set(s.id, { id: s.id, name: s.name, sort: s.sort, badge: badges.get(s.id) ?? 0, lastDate: s.lastDate });
    }
    const list: SubjectTileDto[] = [...tiles.values()]
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ar'))
      .map(({ sort: _sort, ...tile }) => tile);

    await markSeenIfGuardian(db, req, module);
    res.json(list);
  });

  /** Shared by /lessons and /homework. */
  async function listFor(req: Request, module: LessonModule): Promise<GuardianLessonDto[]> {
    const student = studentOf(req);
    const q = parse(guardianListQuery, req.query);
    if (q.subjectId) await assertSubjectInSchool(db, student.schoolId, q.subjectId);
    const markSeen = () => markSeenIfGuardian(db, req, module, q.subjectId ?? '');
    if (!student.classSectionId) {
      await markSeen();
      return [];
    }
    const school = schoolOf(req);
    const bounds = dateRangeBounds(q.range, schoolToday(school), school.weekStart);
    const where = and(
      classLessons(student, student.classSectionId, module),
      q.subjectId ? eq(lessons.subjectId, q.subjectId) : undefined,
      bounds.from ? gte(lessons.date, bounds.from) : undefined,
      bounds.to ? lte(lessons.date, bounds.to) : undefined,
    );
    const [rows, baseline] = await Promise.all([
      queryLessons(db, where, { limit: GUARDIAN_LIST_LIMIT }),
      seenBaseline(db, req, module),
    ]);
    const attachments = await loadAttachments(
      db,
      rows.map((r) => r.id),
    );
    await markSeen();
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      subjectName: r.subjectName,
      date: r.date,
      title: r.title,
      pages: r.pages,
      details: r.details,
      hasHomework: r.hasHomework,
      homeworkDetails: r.homeworkDetails,
      homeworkDueDate: r.homeworkDueDate,
      teacherName: r.teacherName,
      attachments: attachments.get(r.id) ?? [],
      isNew: baseline ? r.createdAt > baseline.of(r.subjectId) : false,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  r.get('/lessons', async (req, res) => {
    res.json(await listFor(req, 'lessons'));
  });

  r.get('/homework', async (req, res) => {
    const student = studentOf(req);
    const list = await listFor(req, 'homework');
    const doneRows = list.length
      ? await db
          .select({ lessonId: homeworkDone.lessonId })
          .from(homeworkDone)
          .where(
            and(
              eq(homeworkDone.studentId, student.id),
              inArray(
                homeworkDone.lessonId,
                list.map((l) => l.id),
              ),
            ),
          )
      : [];
    const done = new Set(doneRows.map((d) => d.lessonId));
    const out: GuardianHomeworkDto[] = list.map((l) => ({ ...l, done: done.has(l.id) }));
    res.json(out);
  });

  r.put('/homework/:lessonId/done', requireGuardianAccess, async (req, res) => {
    const student = studentOf(req);
    const lessonId = parse(zId, req.params.lessonId);
    const { done } = parse(homeworkDoneBody, req.body);
    const [lesson] = student.classSectionId
      ? await db
          .select({ id: lessons.id, hasHomework: lessons.hasHomework })
          .from(lessons)
          .where(
            and(
              eq(lessons.id, lessonId),
              eq(lessons.schoolId, student.schoolId),
              eq(lessons.classSectionId, student.classSectionId),
            ),
          )
      : [];
    if (!lesson) throw notFound('الدرس غير موجود');
    if (!lesson.hasHomework) throw badRequest('لا يوجد واجب منزلي لهذا الدرس');
    const userId = userOf(req).id;
    if (done) {
      await db
        .insert(homeworkDone)
        .values({ lessonId, studentId: student.id, byUserId: userId, doneAt: new Date() })
        .onConflictDoUpdate({
          target: [homeworkDone.lessonId, homeworkDone.studentId],
          set: { byUserId: userId, doneAt: new Date() },
        });
    } else {
      await db
        .delete(homeworkDone)
        .where(and(eq(homeworkDone.lessonId, lessonId), eq(homeworkDone.studentId, student.id)));
    }
    res.json({ lessonId, done });
  });

  return r;
}
