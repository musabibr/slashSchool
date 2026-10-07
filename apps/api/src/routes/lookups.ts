import { Router } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { memberships, subjects, users } from '../db/schema';
import { hasRole, schoolOf, schoolToday } from '../lib/context';
import { assertCanAccessClass, classStudents, currentAcademicYear, listScopeClasses } from '../lib/scope';
import { parse, zId } from '../lib/validate';

/**
 * Shared pickers for every staff screen (mounted at /api/schools/:schoolId/lookups).
 *   GET /scope                         → school info, current year, classes × subjects I can act on, teachers
 *   GET /classes/:classSectionId/students → active students of a class (sorted by name)
 */
export function lookupsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/scope', async (req, res) => {
    const school = schoolOf(req);
    const [year, classes, allSubjects] = await Promise.all([
      currentAcademicYear(db, school.id),
      listScopeClasses(db, req),
      db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(eq(subjects.schoolId, school.id))
        .orderBy(asc(subjects.sort), asc(subjects.name)),
    ]);
    const teachers = hasRole(req, 'admin', 'supervisor')
      ? await db
          .selectDistinct({ id: users.id, fullName: users.fullName })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.schoolId, school.id), inArray(memberships.role, ['teacher', 'supervisor'])))
          .orderBy(asc(users.fullName))
      : [];
    res.json({
      school: {
        id: school.id,
        name: school.name,
        code: school.code,
        timezone: school.timezone,
        weekStart: school.weekStart,
        gradeBands: school.gradeBands,
        today: schoolToday(school),
        roles: school.roles,
      },
      academicYear: year ? { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn } : null,
      classes,
      subjects: allSubjects,
      teachers,
    });
  });

  r.get('/classes/:classSectionId/students', async (req, res) => {
    const classSectionId = parse(zId, req.params.classSectionId);
    await assertCanAccessClass(db, req, classSectionId);
    res.json(await classStudents(db, classSectionId));
  });

  return r;
}
