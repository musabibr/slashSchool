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

const MARKER_PREFIX = 'slashschool-demo-seed:';

/** Demo-seed version stored as a comment on the schools table (no extra table needed). */
export async function getDemoSeedVersion(db: Db): Promise<string | null> {
  const result = await db.execute(sql`select obj_description('schools'::regclass, 'pg_class') as c`);
  const rows = (result as unknown as { rows: Array<{ c: string | null }> }).rows;
  const comment = rows?.[0]?.c ?? null;
  return comment?.startsWith(MARKER_PREFIX) ? comment.slice(MARKER_PREFIX.length) : null;
}

export async function setDemoSeedVersion(db: Db, version: string) {
  if (!/^[\w.-]+$/.test(version)) throw new Error('invalid demo seed version');
  await db.execute(sql.raw(`COMMENT ON TABLE schools IS '${MARKER_PREFIX}${version}'`));
}

/** Demo mode boot: load the demo data into an empty database, or reload it when the demo dataset changed. */
export async function ensureDemoData(
  db: Db,
  seed: (db: Db) => Promise<void>,
  version: string,
): Promise<'seeded' | 'reseeded' | 'current'> {
  const empty = await isDatabaseEmpty(db);
  if (!empty && (await getDemoSeedVersion(db)) === version) return 'current';
  if (!empty) await resetDatabase(db);
  await seed(db);
  await setDemoSeedVersion(db, version);
  return empty ? 'seeded' : 'reseeded';
}
