import type { ModuleDeps, ModuleRouters } from '../types';
import { dashboardRouter } from './setup/dashboard';
import { settingsRouter } from './setup/settings';
import { staffRouter } from './setup/staff';
import { structureRouter } from './setup/structure';

/**
 * School structure, staff, settings and the director dashboard (admins only):
 *   /api/schools/:schoolId/setup      → classes, subjects, academic years, teaching assignments (D "الفصول والمواد")
 *   /api/schools/:schoolId/staff      → supervisors / teachers (D5 "المشرفين" / "الأساتذة")
 *   /api/schools/:schoolId/settings   → school info, week start, grade bands ("الإعدادات")
 *   /api/schools/:schoolId/dashboard  → D1 counters and panels
 */
export function registerSetup({ school }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/setup', structureRouter(db));
  school.use('/staff', staffRouter(db));
  school.use('/settings', settingsRouter(db));
  school.use('/dashboard', dashboardRouter(db));
}
