import { Router, type Request } from 'express';
import { and, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { lessonAttachments, lessons } from '../../db/schema';
import { hasRole, schoolOf, schoolToday, userOf } from '../../lib/context';
import { assertCanTeach } from '../../lib/scope';
import { parse, zId } from '../../lib/validate';
import { createLessonSchema, staffListQuery, updateLessonSchema } from './schemas';
import {
  assertFilesInSchool,
  findLessonInSchool,
  getStaffLesson,
  homeworkFields,
  queryLessons,
  replaceAttachments,
  taughtBy,
  toStaffDtos,
} from './service';

/**
 * Staff lessons (S4–S7, T3–T6), mounted at /api/schools/:schoolId/lessons.
 *   GET    /            ?classId&subjectId&from&to&limit&offset → lessons, newest first
 *   GET    /:lessonId   → one lesson
 *   POST   /            → 201 lesson
 *   PATCH  /:lessonId   → lesson
 *   DELETE /:lessonId   → { ok: true }
 * Admins and supervisors act on the whole school; teachers only on their (class, subject) assignments.
 */
export function staffLessonsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  /** Extra condition limiting a teacher to their assigned pairs (none for admins/supervisors). */
  const scopeFilter = (req: Request): SQL | undefined =>
    hasRole(req, 'admin', 'supervisor') ? undefined : taughtBy(db, userOf(req).id);

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(staffListQuery, req.query);
    const conds: Array<SQL | undefined> = [eq(lessons.schoolId, school.id), scopeFilter(req)];
    if (q.classId) conds.push(eq(lessons.classSectionId, q.classId));
    if (q.subjectId) conds.push(eq(lessons.subjectId, q.subjectId));
    if (q.from) conds.push(gte(lessons.date, q.from));
    if (q.to) conds.push(lte(lessons.date, q.to));
    const rows = await queryLessons(db, and(...conds), { limit: q.limit, offset: q.offset });
    res.json(await toStaffDtos(db, rows));
  });

  r.get('/:lessonId', async (req, res) => {
    const lessonId = parse(zId, req.params.lessonId);
    res.json(await getStaffLesson(db, schoolOf(req).id, lessonId, scopeFilter(req)));
  });

  r.post('/', async (req, res) => {
    const school = schoolOf(req);
    const body = parse(createLessonSchema, req.body);
    await assertCanTeach(db, req, body.classSectionId, body.subjectId);
    const date = body.date ?? schoolToday(school);
    const homework = homeworkFields({
      date,
      hasHomework: body.hasHomework,
      homeworkDetails: body.homeworkDetails,
      homeworkDueDate: body.homeworkDueDate,
    });
    const attachmentIds = body.attachmentIds ?? [];
    await assertFilesInSchool(db, school.id, attachmentIds);

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(lessons)
        .values({
          schoolId: school.id,
          classSectionId: body.classSectionId,
          subjectId: body.subjectId,
          teacherId: userOf(req).id,
          date,
          title: body.title,
          pages: body.pages,
          details: body.details,
          ...homework,
        })
        .returning({ id: lessons.id });
      if (attachmentIds.length) {
        await tx.insert(lessonAttachments).values(attachmentIds.map((fileId) => ({ lessonId: row.id, fileId })));
      }
      return row.id;
    });
    res.status(201).json(await getStaffLesson(db, school.id, id));
  });

  r.patch('/:lessonId', async (req, res) => {
    const school = schoolOf(req);
    const lessonId = parse(zId, req.params.lessonId);
    const body = parse(updateLessonSchema, req.body);
    const existing = await findLessonInSchool(db, school.id, lessonId);
    await assertCanTeach(db, req, existing.classSectionId, existing.subjectId);

    const classSectionId = body.classSectionId ?? existing.classSectionId;
    const subjectId = body.subjectId ?? existing.subjectId;
    if (classSectionId !== existing.classSectionId || subjectId !== existing.subjectId) {
      await assertCanTeach(db, req, classSectionId, subjectId);
    }
    const date = body.date ?? existing.date;
    const homework = homeworkFields({
      date,
      hasHomework: body.hasHomework ?? existing.hasHomework,
      homeworkDetails: body.homeworkDetails !== undefined ? body.homeworkDetails : existing.homeworkDetails,
      homeworkDueDate: body.homeworkDueDate !== undefined ? body.homeworkDueDate : existing.homeworkDueDate,
    });
    if (body.attachmentIds) await assertFilesInSchool(db, school.id, body.attachmentIds);

    await db.transaction(async (tx) => {
      await tx
        .update(lessons)
        .set({
          classSectionId,
          subjectId,
          date,
          title: body.title ?? existing.title,
          pages: body.pages !== undefined ? body.pages : existing.pages,
          details: body.details !== undefined ? body.details : existing.details,
          ...homework,
          updatedAt: new Date(),
        })
        .where(and(eq(lessons.id, lessonId), eq(lessons.schoolId, school.id)));
      if (body.attachmentIds) await replaceAttachments(tx, lessonId, body.attachmentIds);
    });
    res.json(await getStaffLesson(db, school.id, lessonId));
  });

  r.delete('/:lessonId', async (req, res) => {
    const school = schoolOf(req);
    const lessonId = parse(zId, req.params.lessonId);
    const existing = await findLessonInSchool(db, school.id, lessonId);
    await assertCanTeach(db, req, existing.classSectionId, existing.subjectId);
    await db.delete(lessons).where(and(eq(lessons.id, lessonId), eq(lessons.schoolId, school.id)));
    res.json({ ok: true });
  });

  return r;
}
