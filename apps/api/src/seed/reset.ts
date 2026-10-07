import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

/** Every application table, children first. */
const TABLES = [
  'audit_logs',
  'read_cursors',
  'timetable_slots',
  'calendar_events',
  'announcements',
  'payments',
  'student_fees',
  'plan_installments',
  'fee_plans',
  'evaluations',
  'behavior_incidents',
  'regulations',
  'scores',
  'assessments',
  'exam_periods',
  'absences',
  'attendance_sessions',
  'homework_done',
  'lesson_attachments',
  'lessons',
  'files',
  'student_guardians',
  'students',
  'teaching_assignments',
  'subjects',
  'class_sections',
  'grade_levels',
  'stages',
  'academic_years',
  'sessions',
  'activation_codes',
  'memberships',
  'users',
  'schools',
];

export async function resetDatabase(db: Db) {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`));
}

export async function isDatabaseEmpty(db: Db): Promise<boolean> {
  const result = await db.execute(sql`select count(*)::int as n from schools`);
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return Number(rows?.[0]?.n ?? 0) === 0;
}
