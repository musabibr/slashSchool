import { Router } from 'express';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { behaviorIncidents, students } from '../../db/schema';
import { audit } from '../../lib/audit';
import { requireRole, schoolOf, schoolToday, userOf } from '../../lib/context';
import { badRequest, notFound } from '../../lib/errors';
import { assertClassInSchool } from '../../lib/scope';
import { parse, zId } from '../../lib/validate';
import { createIncidentSchema, incidentListQuery } from './schemas';
import { findRegulationInSchool, findStudentInSchool, getIncident, queryIncidents } from './service';

/** Fields kept in the audit log for an incident. */
function auditSnapshot(row: typeof behaviorIncidents.$inferSelect) {
  return {
    studentId: row.studentId,
    regulationId: row.regulationId,
    date: row.date,
    details: row.details,
    penalty: row.penalty,
  };
}

/**
 * Behavior incidents (S15, admin student page), mounted at /api/schools/:schoolId/behavior.
 * Recorded by supervisors and admins only.
 *   GET    /     ?studentId&classId&from&to&limit → incidents, newest first
 *   POST   /     { studentId, regulationId, date?, details?, penalty? } → 201 incident (audited)
 *   DELETE /:id  → { ok: true } (audited)
 */
export function incidentsRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin', 'supervisor'));

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(incidentListQuery, req.query);
    if (q.studentId) await findStudentInSchool(db, school.id, q.studentId);
    if (q.classId) await assertClassInSchool(db, school.id, q.classId);
    const where = and(
      eq(behaviorIncidents.schoolId, school.id),
      q.studentId ? eq(behaviorIncidents.studentId, q.studentId) : undefined,
      q.classId ? eq(students.classSectionId, q.classId) : undefined,
      q.from ? gte(behaviorIncidents.date, q.from) : undefined,
      q.to ? lte(behaviorIncidents.date, q.to) : undefined,
    );
    res.json(await queryIncidents(db, where, q.limit));
  });

  r.post('/', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const body = parse(createIncidentSchema, req.body);
    const date = body.date ?? schoolToday(school);
    if (date > schoolToday(school)) throw badRequest('لا يمكن تسجيل مخالفة بتاريخ لاحق لليوم');
    await findStudentInSchool(db, school.id, body.studentId);
    const regulation = await findRegulationInSchool(db, school.id, body.regulationId);
    // Absent → the regulation's default penalty; null / '' → a violation without a penalty.
    const penalty = body.penalty === undefined ? regulation.defaultPenalty : body.penalty;

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(behaviorIncidents)
        .values({
          schoolId: school.id,
          studentId: body.studentId,
          regulationId: regulation.id,
          date,
          details: body.details,
          penalty,
          recordedBy: user.id,
        })
        .returning();
      await audit(tx, {
        schoolId: school.id,
        actorId: user.id,
        entity: 'behavior_incident',
        entityId: row.id,
        action: 'create',
        after: auditSnapshot(row),
      });
      return row.id;
    });
    res.status(201).json(await getIncident(db, school.id, id));
  });

  r.delete('/:id', async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const id = parse(zId, req.params.id);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(behaviorIncidents)
        .where(and(eq(behaviorIncidents.id, id), eq(behaviorIncidents.schoolId, school.id)))
        .returning();
      if (!row) throw notFound('المخالفة غير موجودة');
      await audit(tx, {
        schoolId: school.id,
        actorId: user.id,
        entity: 'behavior_incident',
        entityId: row.id,
        action: 'delete',
        before: auditSnapshot(row),
      });
    });
    res.json({ ok: true });
  });

  return r;
}
