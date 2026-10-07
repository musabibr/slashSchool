import type { PgInsertValue, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../../db/client';
import * as s from '../../db/schema';
import type { DemoRows } from './context';

/** Rows per INSERT statement: one round trip each, well under Postgres' 65,535-parameter limit. */
const CHUNK_SIZE = 500;

async function insertChunked<T extends PgTable>(db: Db, table: T, rows: PgInsertValue<T>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await db.insert(table).values(rows.slice(i, i + CHUNK_SIZE));
  }
}

/** Writes the dataset parents-first, one multi-row INSERT per table chunk. */
export async function insertDemoRows(db: Db, rows: DemoRows): Promise<void> {
  await insertChunked(db, s.schools, rows.schools);
  await insertChunked(db, s.users, rows.users);
  await insertChunked(db, s.memberships, rows.memberships);
  await insertChunked(db, s.activationCodes, rows.activationCodes);
  await insertChunked(db, s.academicYears, rows.academicYears);
  await insertChunked(db, s.stages, rows.stages);
  await insertChunked(db, s.gradeLevels, rows.gradeLevels);
  await insertChunked(db, s.classSections, rows.classSections);
  await insertChunked(db, s.subjects, rows.subjects);
  await insertChunked(db, s.teachingAssignments, rows.teachingAssignments);
  await insertChunked(db, s.students, rows.students);
  await insertChunked(db, s.studentGuardians, rows.studentGuardians);
  await insertChunked(db, s.timetableSlots, rows.timetableSlots);
  await insertChunked(db, s.lessons, rows.lessons);
  await insertChunked(db, s.homeworkDone, rows.homeworkDone);
  await insertChunked(db, s.attendanceSessions, rows.attendanceSessions);
  await insertChunked(db, s.absences, rows.absences);
  await insertChunked(db, s.examPeriods, rows.examPeriods);
  await insertChunked(db, s.assessments, rows.assessments);
  await insertChunked(db, s.scores, rows.scores);
  await insertChunked(db, s.regulations, rows.regulations);
  await insertChunked(db, s.behaviorIncidents, rows.behaviorIncidents);
  await insertChunked(db, s.evaluations, rows.evaluations);
  await insertChunked(db, s.feePlans, rows.feePlans);
  await insertChunked(db, s.planInstallments, rows.planInstallments);
  await insertChunked(db, s.studentFees, rows.studentFees);
  await insertChunked(db, s.payments, rows.payments);
  await insertChunked(db, s.announcements, rows.announcements);
  await insertChunked(db, s.calendarEvents, rows.calendarEvents);
  await insertChunked(db, s.readCursors, rows.readCursors);
}
