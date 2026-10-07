// Feature entry point — pages and panels imported by routes.tsx and other features (admin student profile).
//  Guardian: P10 GuardianExamsHubPage, P11 GuardianQuizzesPage, GuardianExamTimetablePage,
//            P12 GuardianResultsPage, P13 GuardianResultSheetPage
//  Staff:    S11 StaffExamsHubPage, S12 ExamTimetableBuilderPage, StaffQuizzesPage, S13 QuizFormPage,
//            S14 / T7 GradesEntryPage
//  Admin:    StudentResultsPanel({ studentId }) for the student profile (D4)
export {
  GuardianExamsHubPage,
  GuardianExamTimetablePage,
  GuardianQuizzesPage,
  GuardianResultSheetPage,
  GuardianResultsPage,
} from './GuardianPages';
export { StaffExamsHubPage, StaffQuizzesPage } from './StaffPages';
export { ExamTimetableBuilderPage } from './ExamTimetableBuilderPage';
export { QuizFormPage } from './QuizFormPage';
export { GradesEntryPage } from './GradesEntryPage';
export { StudentResultsPanel } from './StudentResultsPanel';
