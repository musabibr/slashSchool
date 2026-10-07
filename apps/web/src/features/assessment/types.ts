/** API shapes of the assessment module (see apps/api/src/modules/assessment). */
import type { AssessmentKind, ExamPeriodKind } from '@slash/shared';

// ───────────────────────────── Staff ─────────────────────────────

/** GET /api/schools/:schoolId/exam-periods */
export interface ExamPeriod {
  id: string;
  name: string;
  kind: ExamPeriodKind;
  gradeLevelId: string;
  gradeLevelName: string;
  academicYearId: string;
  /** ISO timestamp; null while results are hidden from guardians. */
  resultsPublishedAt: string | null;
  subjectCount: number;
  firstDate: string | null;
  lastDate: string | null;
  hasScores: boolean;
}

export interface TimetableRow {
  subjectId: string;
  subjectName: string;
  date: string;
  maxScore: number;
}

/** GET / PUT /api/schools/:schoolId/exam-periods/:id/timetable */
export interface PeriodTimetable {
  period: ExamPeriod;
  rows: TimetableRow[];
}

export interface TimetableRowInput {
  subjectId: string;
  date: string;
  maxScore: number;
}

/** GET /api/schools/:schoolId/exam-periods/:id/results */
export interface PeriodResults {
  period: ExamPeriod;
  classes: Array<{ id: string; label: string }>;
  subjects: Array<{ subjectId: string; subjectName: string; maxScore: number }>;
  students: Array<{
    id: string;
    code: string;
    fullName: string;
    classSectionId: string;
    classLabel: string;
    scores: Array<{ subjectId: string; score: number | null; maxScore: number }>;
    total: number;
    max: number;
    percentage: number;
    grade: string;
    incomplete: boolean;
  }>;
}

/** GET /api/schools/:schoolId/assessments[/:id] */
export interface Assessment {
  id: string;
  kind: AssessmentKind;
  title: string;
  date: string;
  maxScore: number;
  details: string | null;
  classSectionId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  examPeriodId: string | null;
  examPeriodName: string | null;
  scoredCount: number;
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST / PATCH /api/schools/:schoolId/assessments */
export interface QuizPayload {
  classSectionId: string;
  subjectId: string;
  title: string;
  date: string;
  maxScore: number;
  details: string | null;
}

export interface ScoreSheetStudent {
  id: string;
  code: string;
  fullName: string;
  score: number | null;
}

/** GET / PUT /api/schools/:schoolId/assessments/:id/scores */
export interface ScoreSheet {
  assessment: Assessment;
  students: ScoreSheetStudent[];
}

// ───────────────────────────── Guardian ─────────────────────────────

export interface GuardianQuiz {
  id: string;
  subjectName: string;
  title: string;
  date: string;
  details: string | null;
  maxScore: number;
  score: number | null;
}

export interface GuardianExamTimetable {
  periodId: string;
  name: string;
  kind: ExamPeriodKind;
  rows: Array<{ subjectName: string; date: string; weekday: number }>;
}

/** GET /api/students/:studentId/exams */
export interface GuardianExams {
  quizzes: GuardianQuiz[];
  timetables: GuardianExamTimetable[];
}

/** GET /api/students/:studentId/results */
export type ResultItem =
  | {
      type: 'period';
      id: string;
      name: string;
      kind: ExamPeriodKind;
      date: string;
      publishedAt: string | null;
      published: boolean;
    }
  | { type: 'quiz'; id: string; title: string; subjectName: string; date: string; score: number; maxScore: number };

/** GET /api/students/:studentId/results/:periodId */
export interface ResultSheet {
  period: { id: string; name: string; kind: ExamPeriodKind; publishedAt: string | null };
  rows: Array<{ subjectId: string; subjectName: string; score: number | null; maxScore: number }>;
  total: number;
  max: number;
  percentage: number;
  grade: string;
  incomplete: boolean;
}
