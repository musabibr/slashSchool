import type { ModuleDeps, ModuleRouters } from '../types';
import { staffAnnouncementsRouter } from './announcements';
import { staffCalendarRouter } from './calendar';
import { guardianCommsRouter } from './guardian';

/**
 * Announcements, the academic calendar and the guardian home summary (P3 badges, P15, P16, director pages).
 *  - staff:   /api/schools/:schoolId/announcements, /api/schools/:schoolId/calendar
 *  - student: /api/students/:studentId/summary|seen|announcements|calendar
 */
export function register({ school, student }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/announcements', staffAnnouncementsRouter(db));
  school.use('/calendar', staffCalendarRouter(db));
  student.use(guardianCommsRouter(db));
}
