import { Router } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { evaluations } from '../../db/schema';
import { schoolOf, schoolToday, userOf } from '../../lib/context';
import { badRequest } from '../../lib/errors';
import { assertCanTeach, assertStudentsInClass } from '../../lib/scope';
import { parse } from '../../lib/validate';
import { evaluationQuery, saveEvaluationsSchema } from './schemas';
import { classEvaluations } from './service';

/**
 * Student evaluation (S17 / T9), mounted at /api/schools/:schoolId/evaluations.
 * Teachers act on their assigned (class, subject) pairs; supervisors and admins on the whole school.
 *   GET /  ?classId&subjectId&date → [{ studentId, rating, comment }]
 *   PUT /  { classSectionId, subjectId, date, items: [{ studentId, rating | null, comment? }] }
 *          → upsert per (student, subject, date); a null rating removes the evaluation. Returns the saved list.
 */
export function evaluationsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(evaluationQuery, req.query);
    await assertCanTeach(db, req, q.classId, q.subjectId);
    res.json(await classEvaluations(db, school.id, q.classId, q.subjectId, q.date));
  });

  r.put('/', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const body = parse(saveEvaluationsSchema, req.body);
    await assertCanTeach(db, req, body.classSectionId, body.subjectId);
    if (body.date > schoolToday(school)) throw badRequest('لا يمكن تقييم الطلاب لتاريخ لاحق لليوم');
    const studentIds = body.items.map((i) => i.studentId);
    await assertStudentsInClass(db, body.classSectionId, studentIds);

    if (studentIds.length) {
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ studentId: evaluations.studentId, rating: evaluations.rating, comment: evaluations.comment })
          .from(evaluations)
          .where(
            and(
              eq(evaluations.subjectId, body.subjectId),
              eq(evaluations.date, body.date),
              inArray(evaluations.studentId, studentIds),
            ),
          );
        const saved = new Map(existing.map((e) => [e.studentId, e]));

        const toDelete = body.items.filter((i) => i.rating === null && saved.has(i.studentId)).map((i) => i.studentId);
        // Unchanged rows are left alone, so saving the whole class keeps the original evaluator.
        const toWrite = body.items.flatMap((i) => {
          if (i.rating === null) return [];
          const prev = saved.get(i.studentId);
          if (prev && prev.rating === i.rating && (prev.comment ?? null) === i.comment) return [];
          return [{ studentId: i.studentId, rating: i.rating, comment: i.comment }];
        });

        if (toDelete.length) {
          await tx
            .delete(evaluations)
            .where(
              and(
                eq(evaluations.subjectId, body.subjectId),
                eq(evaluations.date, body.date),
                inArray(evaluations.studentId, toDelete),
              ),
            );
        }
        if (toWrite.length) {
          await tx
            .insert(evaluations)
            .values(
              toWrite.map((w) => ({
                schoolId: school.id,
                studentId: w.studentId,
                subjectId: body.subjectId,
                teacherId: user.id,
                date: body.date,
                rating: w.rating,
                comment: w.comment,
              })),
            )
            .onConflictDoUpdate({
              target: [evaluations.studentId, evaluations.subjectId, evaluations.date],
              set: {
                rating: sql`excluded.rating`,
                comment: sql`excluded.comment`,
                teacherId: sql`excluded.teacher_id`,
              },
            });
        }
      });
    }

    res.json(await classEvaluations(db, school.id, body.classSectionId, body.subjectId, body.date));
  });

  return r;
}
