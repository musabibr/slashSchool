import type { ModuleDeps, ModuleRouters } from '../types';
import { guardianFeesRouter } from './guardian';
import { staffFeesRouter } from './staff';

/**
 * Fees, recorded by hand (P9, admin fees page, student profile panel, fee notice).
 *   /api/schools/:schoolId/fees   → staffFeesRouter (admins)
 *   /api/students/:studentId/fees → guardianFeesRouter (the student's guardians, admins and supervisors)
 */
export function register({ school, student }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/fees', staffFeesRouter(db));
  student.use('/fees', guardianFeesRouter(db));
}
