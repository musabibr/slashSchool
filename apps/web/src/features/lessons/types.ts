/** API shapes of the lessons module (see apps/api/src/modules/lessons). */

export interface LessonAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

/** GET /api/schools/:schoolId/lessons[/:id] */
export interface StaffLesson {
  id: string;
  classSectionId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  date: string;
  title: string;
  pages: string | null;
  details: string | null;
  hasHomework: boolean;
  homeworkDetails: string | null;
  homeworkDueDate: string | null;
  teacherId: string | null;
  teacherName: string | null;
  attachments: LessonAttachment[];
  homeworkDoneCount: number;
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST / PATCH /api/schools/:schoolId/lessons */
export interface LessonPayload {
  classSectionId: string;
  subjectId: string;
  date: string;
  title: string;
  pages: string | null;
  details: string | null;
  hasHomework: boolean;
  homeworkDetails: string | null;
  homeworkDueDate: string | null;
  attachmentIds: string[];
}

/** GET /api/students/:studentId/lessons */
export interface GuardianLesson {
  id: string;
  subjectId: string;
  subjectName: string;
  date: string;
  title: string;
  pages: string | null;
  details: string | null;
  hasHomework: boolean;
  homeworkDetails: string | null;
  homeworkDueDate: string | null;
  teacherName: string | null;
  attachments: LessonAttachment[];
  isNew: boolean;
  createdAt: string;
}

/** GET /api/students/:studentId/homework */
export interface GuardianHomework extends GuardianLesson {
  done: boolean;
}

/** GET /api/students/:studentId/subjects?module=… */
export interface SubjectTile {
  id: string;
  name: string;
  badge: number;
  lastDate: string | null;
}

export type LessonModule = 'lessons' | 'homework';
