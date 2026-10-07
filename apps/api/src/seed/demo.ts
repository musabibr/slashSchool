import { isIsoDate, todayIn } from '@slash/shared';
import type { Db } from '../db/client';
import { hashSecret } from '../lib/security';
import { DEMO_PIN } from './demo-accounts';
import { buildActivity } from './demo-data/activity';
import { buildAssessments } from './demo-data/assessment';
import { emptyRows, type DemoContext, type DemoRows } from './demo-data/context';
import { insertDemoRows } from './demo-data/insert';
import { buildSchoolLife } from './demo-data/life';
import { buildPeople } from './demo-data/people';
import { planDates } from './demo-data/plan';
import { IdFactory, Rng } from './demo-data/random';
import { buildTimetables } from './demo-data/timetable';
import { academicYearOf } from './demo-data/time';

const SEED = 'slash-school-demo';

/**
 * Builds every row of the demo dataset in memory (no I/O). Deterministic: the same `today` gives the
 * same rows and ids. `now` only caps timestamps (nothing is dated in the future) and sets the
 * activation code's expiry.
 */
export function buildDemoRows(input: { today: string; now: Date; pinHash: string }): DemoRows {
  const { cal, dates } = planDates(input.today, input.now);
  const ctx: DemoContext = {
    today: input.today,
    now: input.now,
    cal,
    year: academicYearOf(input.today),
    dates,
    ids: new IdFactory(SEED),
    rng: new Rng(SEED),
    pinHash: input.pinHash,
    rows: emptyRows(),
  };
  const world = buildPeople(ctx);
  const timetables = buildTimetables(ctx, world);
  const lessonLog = buildActivity(ctx, world, timetables);
  buildAssessments(ctx, world, lessonLog);
  buildSchoolLife(ctx, world);
  return ctx.rows;
}

/**
 * Seeds the demo dataset (DEMO_MODE): the two schools from the sketch with their structure, staff,
 * timetables and a few weeks of school life — lessons, homework, attendance, exams and results,
 * quizzes, behavior, evaluations, fees, announcements and the calendar — centred on `today`, the
 * school-local date (default: today in Khartoum). The demo logins, activation code and link code are
 * the ones in demo-accounts.ts.
 *
 * Built in memory, then written in one transaction with one multi-row INSERT per table chunk, so a
 * failed seed leaves the database empty (and the server retries on its next boot).
 */
export async function seedDemo(db: Db, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? todayIn('Africa/Khartoum');
  if (!isIsoDate(today)) throw new Error(`seedDemo: invalid today "${today}"`);
  const rows = buildDemoRows({ today, now: new Date(), pinHash: await hashSecret(DEMO_PIN) });
  await db.transaction(async (tx) => {
    await insertDemoRows(tx, rows);
  });
}
