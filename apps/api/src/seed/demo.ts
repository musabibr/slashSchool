import type { Db } from '../db/client';

/**
 * Seeds the demo dataset (two schools from the sketch, staff, guardians, students and a few weeks of
 * lessons, attendance, exams, behavior, fees, announcements, calendar and timetables).
 * `today` is the school-local date the data is centred on.
 */
export async function seedDemo(_db: Db, _opts: { today?: string } = {}): Promise<void> {
  // implemented by the demo-seed task
}
