import type { ModuleDeps, ModuleRouters } from '../types';
import { guardiansRouter } from './students/guardiansRouter';
import { studentsRouter } from './students/studentsRouter';

/**
 * Students, admission, CSV import, student profile and guardians (D2–D4, sidebar "أولياء الأمور").
 *   /api/schools/:schoolId/students   → studentsRouter (list/profile: admins & supervisors; changes: admins)
 *   /api/schools/:schoolId/guardians  → guardiansRouter (admins)
 */
export function registerStudents({ school }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/students', studentsRouter(db));
  school.use('/guardians', guardiansRouter(db));
}
