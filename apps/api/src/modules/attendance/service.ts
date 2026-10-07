import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { absences, attendanceSessions, users } from '../../db/schema';
import { classLabel } from '../../lib/context';
import { classStudents } from '../../lib/scope';

export interface AttendanceStudentRow {
  id: string;
  code: string;
  fullName: string;
  absent: boolean;
  note: string | null;
}

/** GET/PUT /attendance/:classId/:date — the S9/S10 checklist. */
export interface ClassAttendance {
  classSectionId: string;
  classLabel: string;
  date: string;
  recorded: boolean;
  recordedByName: string | null;
  updatedAt: string | null;
  students: AttendanceStudentRow[];
}

/** The class+date session (if recorded) with the name of whoever last saved it. */
export async function findSession(db: Db, classSectionId: string, date: string) {
  const [row] = await db
    .select({
      id: attendanceSessions.id,
      updatedAt: attendanceSessions.updatedAt,
      recordedByName: users.fullName,
    })
    .from(attendanceSessions)
    .leftJoin(users, eq(users.id, attendanceSessions.recordedBy))
    .where(and(eq(attendanceSessions.classSectionId, classSectionId), eq(attendanceSessions.date, date)));
  return row ?? null;
}

export async function sessionAbsences(db: Db, sessionId: string) {
  return db
    .select({ studentId: absences.studentId, note: absences.note })
    .from(absences)
    .where(eq(absences.sessionId, sessionId));
}

/** Active students of the class, each flagged absent or not on `date`. */
export async function loadClassAttendance(db: Db, classSectionId: string, date: string): Promise<ClassAttendance> {
  const [label, roster, session] = await Promise.all([
    classLabel(db, classSectionId),
    classStudents(db, classSectionId),
    findSession(db, classSectionId, date),
  ]);
  const absent = new Map((session ? await sessionAbsences(db, session.id) : []).map((a) => [a.studentId, a.note]));
  return {
    classSectionId,
    classLabel: label ?? '',
    date,
    recorded: !!session,
    recordedByName: session?.recordedByName ?? null,
    updatedAt: session ? session.updatedAt.toISOString() : null,
    students: roster.map((s) => ({
      id: s.id,
      code: s.code,
      fullName: s.fullName,
      absent: absent.has(s.id),
      note: absent.get(s.id) ?? null,
    })),
  };
}
