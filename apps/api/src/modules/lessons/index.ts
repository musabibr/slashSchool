import type { ModuleDeps, ModuleRouters } from '../types';
import { guardianLessonsRouter } from './guardian';
import { staffLessonsRouter } from './staff';

/**
 * Lessons & homework.
 *  - staff:   /api/schools/:schoolId/lessons            (S4–S7, T3–T6)
 *  - student: /api/students/:studentId/subjects|lessons|homework (P4–P7)
 */
export function register({ school, student }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/lessons', staffLessonsRouter(db));
  student.use(guardianLessonsRouter(db));
}
