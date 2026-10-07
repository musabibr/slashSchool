import { and, asc, count, desc, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  classSections,
  files,
  gradeLevels,
  homeworkDone,
  lessonAttachments,
  lessons,
  students,
  subjects,
  teachingAssignments,
  users,
} from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';

export interface LessonAttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

/** A lesson as staff see it (S6 / S7). */
export interface StaffLessonDto {
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
  attachments: LessonAttachmentDto[];
  /** Active students of the lesson's class who ticked the homework as done. */
  homeworkDoneCount: number;
  /** Active students currently in the lesson's class. */
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A lesson as a guardian sees it (P5 / P7). */
export interface GuardianLessonDto {
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
  attachments: LessonAttachmentDto[];
  /** Created after the guardian last opened this subject (always false for staff). */
  isNew: boolean;
  createdAt: string;
}

const lessonColumns = {
  id: lessons.id,
  classSectionId: lessons.classSectionId,
  sectionName: classSections.name,
  gradeName: gradeLevels.name,
  subjectId: lessons.subjectId,
  subjectName: subjects.name,
  date: lessons.date,
  title: lessons.title,
  pages: lessons.pages,
  details: lessons.details,
  hasHomework: lessons.hasHomework,
  homeworkDetails: lessons.homeworkDetails,
  homeworkDueDate: lessons.homeworkDueDate,
  teacherId: lessons.teacherId,
  teacherName: users.fullName,
  createdAt: lessons.createdAt,
  updatedAt: lessons.updatedAt,
};

export type LessonRow = Awaited<ReturnType<typeof queryLessons>>[number];

/** Lessons matching `where`, newest first (date, then creation time), with class/subject/teacher names. */
export function queryLessons(db: Db, where: SQL | undefined, page: { limit: number; offset?: number }) {
  return db
    .select(lessonColumns)
    .from(lessons)
    .innerJoin(subjects, eq(subjects.id, lessons.subjectId))
    .innerJoin(classSections, eq(classSections.id, lessons.classSectionId))
    .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
    .leftJoin(users, eq(users.id, lessons.teacherId))
    .where(where)
    .orderBy(desc(lessons.date), desc(lessons.createdAt), desc(lessons.id))
    .limit(page.limit)
    .offset(page.offset ?? 0);
}

/** Only lessons of (class, subject) pairs the teacher is assigned to. */
export function taughtBy(db: Db, teacherId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(teachingAssignments)
      .where(
        and(
          eq(teachingAssignments.classSectionId, lessons.classSectionId),
          eq(teachingAssignments.subjectId, lessons.subjectId),
          eq(teachingAssignments.teacherId, teacherId),
        ),
      ),
  );
}

/** Attachments (metadata only, never the bytes) grouped by lesson. */
export async function loadAttachments(db: Db, lessonIds: string[]): Promise<Map<string, LessonAttachmentDto[]>> {
  const map = new Map<string, LessonAttachmentDto[]>();
  if (!lessonIds.length) return map;
  const rows = await db
    .select({
      lessonId: lessonAttachments.lessonId,
      id: files.id,
      fileName: files.fileName,
      mimeType: files.mimeType,
      size: files.size,
    })
    .from(lessonAttachments)
    .innerJoin(files, eq(files.id, lessonAttachments.fileId))
    .where(inArray(lessonAttachments.lessonId, lessonIds))
    .orderBy(asc(files.createdAt), asc(files.id));
  for (const { lessonId, ...file } of rows) {
    const list = map.get(lessonId) ?? [];
    list.push({ ...file, url: `/api/files/${file.id}` });
    map.set(lessonId, list);
  }
  return map;
}

/** Adds attachments, homework done counts and class sizes to staff rows. */
export async function toStaffDtos(db: Db, rows: LessonRow[]): Promise<StaffLessonDto[]> {
  if (!rows.length) return [];
  const lessonIds = rows.map((r) => r.id);
  const classIds = [...new Set(rows.map((r) => r.classSectionId))];
  const [attachments, doneRows, sizeRows] = await Promise.all([
    loadAttachments(db, lessonIds),
    db
      .select({ lessonId: homeworkDone.lessonId, n: count() })
      .from(homeworkDone)
      .innerJoin(lessons, eq(lessons.id, homeworkDone.lessonId))
      .innerJoin(
        students,
        and(
          eq(students.id, homeworkDone.studentId),
          eq(students.classSectionId, lessons.classSectionId),
          eq(students.status, 'active'),
        ),
      )
      .where(inArray(homeworkDone.lessonId, lessonIds))
      .groupBy(homeworkDone.lessonId),
    db
      .select({ classSectionId: students.classSectionId, n: count() })
      .from(students)
      .where(and(inArray(students.classSectionId, classIds), eq(students.status, 'active')))
      .groupBy(students.classSectionId),
  ]);
  const done = new Map(doneRows.map((r) => [r.lessonId, r.n]));
  const sizes = new Map(sizeRows.map((r) => [r.classSectionId, r.n]));
  return rows.map((r) => ({
    id: r.id,
    classSectionId: r.classSectionId,
    classLabel: `${r.gradeName} - ${r.sectionName}`,
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    date: r.date,
    title: r.title,
    pages: r.pages,
    details: r.details,
    hasHomework: r.hasHomework,
    homeworkDetails: r.homeworkDetails,
    homeworkDueDate: r.homeworkDueDate,
    teacherId: r.teacherId,
    teacherName: r.teacherName,
    attachments: attachments.get(r.id) ?? [],
    homeworkDoneCount: r.hasHomework ? (done.get(r.id) ?? 0) : 0,
    studentCount: sizes.get(r.classSectionId) ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** One staff lesson by id within the school (optionally narrowed, e.g. to a teacher's scope); 404 otherwise. */
export async function getStaffLesson(db: Db, schoolId: string, lessonId: string, extra?: SQL): Promise<StaffLessonDto> {
  const rows = await queryLessons(db, and(eq(lessons.schoolId, schoolId), eq(lessons.id, lessonId), extra), {
    limit: 1,
  });
  if (!rows.length) throw notFound('الدرس غير موجود');
  const [dto] = await toStaffDtos(db, rows);
  return dto;
}

/** The raw lesson row, 404 unless it belongs to the school. */
export async function findLessonInSchool(db: Db, schoolId: string, lessonId: string) {
  const [row] = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, lessonId), eq(lessons.schoolId, schoolId)));
  if (!row) throw notFound('الدرس غير موجود');
  return row;
}

/** 404 unless every file id is an upload of this school. */
export async function assertFilesInSchool(db: Db, schoolId: string, fileIds: string[]) {
  if (!fileIds.length) return;
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.schoolId, schoolId), inArray(files.id, fileIds)));
  if (rows.length !== new Set(fileIds).size) throw notFound('بعض المرفقات غير موجودة');
}

/** Replace the attachment set of a lesson. */
export async function replaceAttachments(db: Db, lessonId: string, fileIds: string[]) {
  await db.delete(lessonAttachments).where(eq(lessonAttachments.lessonId, lessonId));
  if (fileIds.length) await db.insert(lessonAttachments).values(fileIds.map((fileId) => ({ lessonId, fileId })));
}

/**
 * Homework rules: details are required when the lesson has homework, and the due date may not precede
 * the lesson date. Without homework the homework fields are cleared.
 */
export function homeworkFields(input: {
  date: string;
  hasHomework: boolean;
  homeworkDetails: string | null;
  homeworkDueDate: string | null;
}) {
  if (!input.hasHomework) return { hasHomework: false, homeworkDetails: null, homeworkDueDate: null };
  const issues: Array<{ path: string; message: string }> = [];
  if (!input.homeworkDetails) issues.push({ path: 'homeworkDetails', message: 'تفاصيل الواجب المنزلي مطلوبة' });
  if (input.homeworkDueDate && input.homeworkDueDate < input.date) {
    issues.push({ path: 'homeworkDueDate', message: 'موعد التسليم يجب ألا يسبق تاريخ الدرس' });
  }
  if (issues.length) throw badRequest('بيانات غير صالحة', issues);
  return { hasHomework: true, homeworkDetails: input.homeworkDetails, homeworkDueDate: input.homeworkDueDate };
}
