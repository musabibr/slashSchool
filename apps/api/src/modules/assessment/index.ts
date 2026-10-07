import type { ModuleDeps, ModuleRouters } from '../types';
import { guardianExamsRouter } from './guardian';
import { assessmentsRouter, examPeriodsRouter } from './staff';

export { countNewExams, countNewResults } from './badges';

/**
 * Exams, quizzes, grades and results.
 *  - staff:   /api/schools/:schoolId/exam-periods   (S11 / S12 exam timetables, publishing, results review)
 *             /api/schools/:schoolId/assessments    (S13 quiz announcements, S14 / T7 grade entry)
 *  - student: /api/students/:studentId/exams|results (P10–P13, admin student profile)
 */
export function register({ school, student }: ModuleRouters, { db }: ModuleDeps): void {
  school.use('/exam-periods', examPeriodsRouter(db));
  school.use('/assessments', assessmentsRouter(db));
  student.use(guardianExamsRouter(db));
}
