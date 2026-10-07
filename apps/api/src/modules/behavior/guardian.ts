import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { EvaluationRating } from '@slash/shared';
import type { Db } from '../../db/client';
import { behaviorIncidents, evaluations, regulations, subjects, users } from '../../db/schema';
import { studentOf } from '../../lib/context';
import { markSeenIfGuardian } from '../../lib/cursors';
import { GUARDIAN_EVALUATIONS_LIMIT } from './schemas';

/** Upper bound for one student's incident list (far above a realistic school career). */
const MAX_INCIDENTS = 500;

/** GET /api/students/:studentId/behavior (P14). */
export interface StudentBehaviorDto {
  /** Number of recorded incidents. */
  violations: number;
  /** Incidents that carry a penalty. */
  penalties: number;
  incidents: Array<{
    id: string;
    date: string;
    regulationTitle: string;
    details: string | null;
    penalty: string | null;
  }>;
  /** The latest teacher evaluations, newest first. */
  evaluations: Array<{
    date: string;
    subjectName: string;
    rating: EvaluationRating;
    comment: string | null;
    teacherName: string | null;
  }>;
}

/**
 * P14 — a student's behavior & discipline record and teacher evaluations:
 * /api/students/:studentId/behavior (the student's guardians and the school's staff).
 */
export function guardianRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const student = studentOf(req);
    const ofStudent = and(
      eq(behaviorIncidents.studentId, student.id),
      eq(behaviorIncidents.schoolId, student.schoolId),
    );
    const [[counts], incidents, recent] = await Promise.all([
      db
        .select({
          violations: sql<number>`count(*)`.mapWith(Number),
          penalties:
            sql<number>`count(*) filter (where btrim(coalesce(${behaviorIncidents.penalty}, '')) <> '')`.mapWith(
              Number,
            ),
        })
        .from(behaviorIncidents)
        .where(ofStudent),
      db
        .select({
          id: behaviorIncidents.id,
          date: behaviorIncidents.date,
          regulationTitle: regulations.title,
          details: behaviorIncidents.details,
          penalty: behaviorIncidents.penalty,
        })
        .from(behaviorIncidents)
        .innerJoin(regulations, eq(regulations.id, behaviorIncidents.regulationId))
        .where(ofStudent)
        .orderBy(desc(behaviorIncidents.date), desc(behaviorIncidents.createdAt))
        .limit(MAX_INCIDENTS),
      db
        .select({
          date: evaluations.date,
          subjectName: subjects.name,
          rating: evaluations.rating,
          comment: evaluations.comment,
          teacherName: users.fullName,
        })
        .from(evaluations)
        .innerJoin(subjects, eq(subjects.id, evaluations.subjectId))
        .leftJoin(users, eq(users.id, evaluations.teacherId))
        .where(and(eq(evaluations.studentId, student.id), eq(evaluations.schoolId, student.schoolId)))
        .orderBy(desc(evaluations.date), desc(evaluations.createdAt), subjects.sort)
        .limit(GUARDIAN_EVALUATIONS_LIMIT),
    ]);

    await markSeenIfGuardian(db, req, 'behavior');
    const out: StudentBehaviorDto = {
      violations: counts?.violations ?? 0,
      penalties: counts?.penalties ?? 0,
      incidents,
      evaluations: recent.map((e) => ({ ...e, teacherName: e.teacherName ?? null })),
    };
    res.json(out);
  });

  return r;
}
