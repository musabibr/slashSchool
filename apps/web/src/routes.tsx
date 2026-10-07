import { lazy, Suspense, type ComponentType } from 'react';
import { Button, Center, Stack, Text } from '@mantine/core';
import { createBrowserRouter, Link, Navigate } from 'react-router';
import { ActivatePage } from './auth/ActivatePage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { SelectPage } from './auth/SelectPage';
import { PageLoader } from './components/States';
import { GuardianHome } from './home/GuardianHome';
import { StaffHome } from './home/StaffHome';
import { AdminShell } from './layouts/AdminShell';
import { GuardianShell } from './layouts/GuardianShell';
import { StaffShell } from './layouts/StaffShell';

// Each feature is its own chunk, loaded on first use.
const features = {
  lessons: () => import('./features/lessons'),
  attendance: () => import('./features/attendance'),
  assessment: () => import('./features/assessment'),
  behavior: () => import('./features/behavior'),
  fees: () => import('./features/fees'),
  comms: () => import('./features/comms'),
  timetable: () => import('./features/timetable'),
  people: () => import('./features/people'),
};

type Loader = () => Promise<Record<string, unknown>>;

/** Lazily render a named export of a feature module. */
function page(loader: Loader, name: string, props: Record<string, unknown> = {}) {
  const Component = lazy(async () => {
    const mod = await loader();
    return { default: mod[name] as ComponentType<Record<string, unknown>> };
  });
  return (
    <Suspense fallback={<PageLoader />}>
      <Component {...props} />
    </Suspense>
  );
}

function NotFound() {
  return (
    <Center h="100dvh">
      <Stack align="center">
        <Text fw={700} size="xl">
          الصفحة غير موجودة
        </Text>
        <Button component={Link} to="/">
          العودة للرئيسية
        </Button>
      </Stack>
    </Center>
  );
}

const { lessons, attendance, assessment, behavior, fees, comms, timetable, people } = features;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/activate', element: <ActivatePage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Navigate to="/select" replace /> },
      { path: '/select', element: <SelectPage /> },

      // Guardian app (P3–P16)
      {
        path: '/g/:studentId',
        element: <GuardianShell />,
        children: [
          { index: true, element: <GuardianHome /> },
          { path: 'lessons', element: page(lessons, 'LessonsSubjectsPage') },
          { path: 'lessons/:subjectId', element: page(lessons, 'LessonsListPage') },
          { path: 'homework', element: page(lessons, 'HomeworkSubjectsPage') },
          { path: 'homework/:subjectId', element: page(lessons, 'HomeworkListPage') },
          { path: 'attendance', element: page(attendance, 'GuardianAttendancePage') },
          { path: 'fees', element: page(fees, 'GuardianFeesPage') },
          { path: 'exams', element: page(assessment, 'GuardianExamsHubPage') },
          { path: 'exams/quizzes', element: page(assessment, 'GuardianQuizzesPage') },
          { path: 'exams/timetable', element: page(assessment, 'GuardianExamTimetablePage') },
          { path: 'results', element: page(assessment, 'GuardianResultsPage') },
          { path: 'results/:periodId', element: page(assessment, 'GuardianResultSheetPage') },
          { path: 'behavior', element: page(behavior, 'GuardianBehaviorPage') },
          { path: 'calendar', element: page(comms, 'GuardianCalendarPage') },
          { path: 'announcements', element: page(comms, 'GuardianAnnouncementsPage') },
        ],
      },

      // Staff app — supervisor & teacher (S3–S17, T2–T9)
      {
        path: '/s/:schoolId',
        element: <StaffShell />,
        children: [
          { index: true, element: <StaffHome /> },
          { path: 'lessons', element: page(lessons, 'StaffLessonsHubPage') },
          { path: 'lessons/new', element: page(lessons, 'LessonFormPage') },
          { path: 'lessons/list', element: page(lessons, 'StaffLessonsListPage') },
          { path: 'lessons/:lessonId', element: page(lessons, 'LessonFormPage') },
          { path: 'attendance', element: page(attendance, 'AttendanceHubPage') },
          { path: 'attendance/record', element: page(attendance, 'AttendanceRecordPage') },
          { path: 'exams', element: page(assessment, 'StaffExamsHubPage') },
          { path: 'exams/timetable', element: page(assessment, 'ExamTimetableBuilderPage') },
          { path: 'exams/quizzes', element: page(assessment, 'StaffQuizzesPage') },
          { path: 'exams/quizzes/new', element: page(assessment, 'QuizFormPage') },
          { path: 'exams/quizzes/:assessmentId', element: page(assessment, 'QuizFormPage') },
          { path: 'grades', element: page(assessment, 'GradesEntryPage') },
          { path: 'behavior', element: page(behavior, 'BehaviorRecordPage') },
          { path: 'evaluation', element: page(behavior, 'EvaluationPage') },
          { path: 'timetable', element: page(timetable, 'StaffTimetablePage') },
        ],
      },

      // Director dashboard (D1–D5 + sidebar pages)
      {
        path: '/a/:schoolId',
        element: <AdminShell />,
        children: [
          { index: true, element: page(people, 'AdminDashboardPage') },
          { path: 'students', element: page(people, 'AdminStudentsPage') },
          { path: 'students/new', element: page(people, 'AdmissionPage') },
          { path: 'students/import', element: page(people, 'StudentImportPage') },
          { path: 'students/:studentId', element: page(people, 'AdminStudentProfilePage') },
          { path: 'students/:studentId/edit', element: page(people, 'AdmissionPage') },
          { path: 'supervisors', element: page(people, 'AdminStaffPage', { role: 'supervisor' }) },
          { path: 'teachers', element: page(people, 'AdminStaffPage', { role: 'teacher' }) },
          { path: 'guardians', element: page(people, 'AdminGuardiansPage') },
          { path: 'classes', element: page(people, 'AdminSetupPage') },
          { path: 'settings', element: page(people, 'AdminSettingsPage') },
          { path: 'calendar', element: page(comms, 'AdminCalendarPage') },
          { path: 'announcements', element: page(comms, 'AdminAnnouncementsPage') },
          { path: 'timetables', element: page(timetable, 'AdminTimetablePage') },
          { path: 'regulations', element: page(behavior, 'AdminRegulationsPage') },
          { path: 'attendance', element: page(attendance, 'AdminAttendancePage') },
          { path: 'fees', element: page(fees, 'AdminFeesPage') },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
