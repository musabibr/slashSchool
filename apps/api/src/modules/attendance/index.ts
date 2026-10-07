import type { ModuleDeps, ModuleRouters } from '../types';
import { guardianRouter } from './guardian';
import { staffRouter } from './staff';

/**
 * Attendance (P8, S8–S10, admin "تسجيل الغياب").
 *   /api/schools/:schoolId/attendance   → staffRouter (admins & supervisors)
 *   /api/students/:studentId/attendance → guardianRouter (the student's guardians and school staff)
 */
export function register({ school, student }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/attendance', staffRouter(db));
  student.use('/attendance', guardianRouter(db));
}
