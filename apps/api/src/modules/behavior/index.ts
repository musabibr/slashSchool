import type { ModuleDeps, ModuleRouters } from '../types';
import { evaluationsRouter } from './evaluations';
import { guardianRouter } from './guardian';
import { incidentsRouter } from './incidents';
import { regulationsRouter } from './regulations';

/**
 * Behavior & discipline, school regulations and student evaluation (P14, S15, S17 / T9, admin regulations).
 *   /api/schools/:schoolId/regulations  → catalog (read: any staff; write: admin, supervisor)
 *   /api/schools/:schoolId/behavior     → incidents (admin, supervisor)
 *   /api/schools/:schoolId/evaluations  → per class/subject/day ratings (teachers within their assignments)
 *   /api/students/:studentId/behavior   → P14 for the student's guardians and the school's staff
 */
export function register({ school, student }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/regulations', regulationsRouter(db));
  school.use('/behavior', incidentsRouter(db));
  school.use('/evaluations', evaluationsRouter(db));
  student.use('/behavior', guardianRouter(db));
}
