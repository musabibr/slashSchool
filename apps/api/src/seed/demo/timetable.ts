import { teacherOf, type DemoContext, type World } from './context';
import { Rng } from './random';

/** Sunday … Thursday. */
export const SCHOOL_WEEKDAYS = [0, 1, 2, 3, 4] as const;
export const PERIODS_PER_DAY = 6;
/** A subject appears at most twice a day in one class. */
const MAX_SAME_SUBJECT_PER_DAY = 2;
const MAX_ATTEMPTS = 200;
/** Search nodes per day before the week is restarted with another shuffle. */
const DAY_SEARCH_BUDGET = 20_000;

export interface TimetableCell {
  classId: string;
  weekday: number;
  period: number;
  subjectId: string;
  teacherId: string;
}

export interface ScheduleClass {
  classId: string;
  subjects: ReadonlyArray<{ subjectId: string; teacherId: string; periods: number }>;
}

/**
 * Fills every (weekday, period) of every class so that each subject gets its weekly periods, a subject
 * appears at most twice a day, and no teacher is in two classes at the same weekday + period.
 * Day by day, a backtracking search assigns (period × class) cells, most loaded teacher first, pruning
 * any state where a class can no longer fit its remaining periods; a dead end restarts the week with
 * another shuffle. Deterministic for a given seed.
 */
export function scheduleWeek(classes: readonly ScheduleClass[], seed: string): TimetableCell[] {
  const slotsPerWeek = SCHOOL_WEEKDAYS.length * PERIODS_PER_DAY;
  for (const c of classes) {
    const total = c.subjects.reduce((sum, x) => sum + x.periods, 0);
    if (total !== slotsPerWeek) throw new Error(`timetable: class ${c.classId} needs ${total} periods`);
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = tryWeek(classes, new Rng(`${seed}:${attempt}`));
    if (result) return result;
  }
  throw new Error('timetable: no conflict-free week found');
}

function tryWeek(classes: readonly ScheduleClass[], rng: Rng): TimetableCell[] | null {
  const remaining = classes.map((c) => c.subjects.map((x) => x.periods));
  const teacherLeft = new Map<string, number>();
  for (const c of classes) {
    for (const x of c.subjects) teacherLeft.set(x.teacherId, (teacherLeft.get(x.teacherId) ?? 0) + x.periods);
  }
  const cells: TimetableCell[] = [];

  for (const [dayIndex, weekday] of SCHOOL_WEEKDAYS.entries()) {
    const daysAfter = SCHOOL_WEEKDAYS.length - dayIndex - 1;
    const usedToday = classes.map((c) => c.subjects.map(() => 0));
    const orders = Array.from({ length: PERIODS_PER_DAY }, () => rng.shuffle(classes.map((_, i) => i)));
    const busy = Array.from({ length: PERIODS_PER_DAY }, () => new Set<string>());
    const picks = Array.from({ length: PERIODS_PER_DAY }, () => new Array<number>(classes.length).fill(-1));
    const total = PERIODS_PER_DAY * classes.length;
    let nodes = 0;

    /** Periods a class must still place today so the rest of the week stays feasible. */
    const fitsToday = (ci: number, slotsLeftToday: number) => {
      let must = 0;
      remaining[ci].forEach((r, si) => {
        const need = r - MAX_SAME_SUBJECT_PER_DAY * daysAfter;
        if (need > MAX_SAME_SUBJECT_PER_DAY - usedToday[ci][si]) must = Infinity;
        else if (need > 0) must += need;
      });
      return must <= slotsLeftToday;
    };

    const dfs = (k: number): boolean => {
      if (k === total) return true;
      if (++nodes > DAY_SEARCH_BUDGET) return false;
      const period = Math.floor(k / classes.length);
      const ci = orders[period][k % classes.length];
      const slotsLeftWeek = (daysAfter + 1) * PERIODS_PER_DAY - period;
      const options = classes[ci].subjects
        .map((x, si) => ({ x, si }))
        .filter(({ si }) => remaining[ci][si] > 0 && usedToday[ci][si] < MAX_SAME_SUBJECT_PER_DAY)
        .map(({ x, si }) => ({
          x,
          si,
          score:
            ((teacherLeft.get(x.teacherId) ?? 0) / slotsLeftWeek) * 50 +
            (remaining[ci][si] / (daysAfter + 1)) * 10 +
            (usedToday[ci][si] === 0 ? 30 : 0) +
            rng.next() * 5,
        }))
        .sort((a, b) => b.score - a.score);
      for (const { x, si } of options) {
        if (busy[period].has(x.teacherId)) continue;
        busy[period].add(x.teacherId);
        picks[period][ci] = si;
        remaining[ci][si] -= 1;
        usedToday[ci][si] += 1;
        teacherLeft.set(x.teacherId, (teacherLeft.get(x.teacherId) ?? 0) - 1);
        if (fitsToday(ci, PERIODS_PER_DAY - period - 1) && dfs(k + 1)) return true;
        teacherLeft.set(x.teacherId, (teacherLeft.get(x.teacherId) ?? 0) + 1);
        usedToday[ci][si] -= 1;
        remaining[ci][si] += 1;
        picks[period][ci] = -1;
        busy[period].delete(x.teacherId);
      }
      return false;
    };
    if (!dfs(0)) return null;

    picks.forEach((row, index) => {
      row.forEach((si, ci) => {
        const x = classes[ci].subjects[si];
        cells.push({ classId: classes[ci].classId, weekday, period: index + 1, subjectId: x.subjectId, teacherId: x.teacherId });
      });
    });
  }
  return cells;
}

/** Weekly timetables of every class (S16 / T8), keyed by class id. */
export function buildTimetables(ctx: DemoContext, world: World): Map<string, TimetableCell[]> {
  const byClass = new Map<string, TimetableCell[]>();
  for (const school of world.schools) {
    const cells = scheduleWeek(
      school.classes.map((cls) => ({
        classId: cls.id,
        subjects: school.subjects.map((subject) => ({
          subjectId: subject.id,
          teacherId: teacherOf(cls, subject.id),
          periods: subject.def.weeklyPeriods,
        })),
      })),
      // Independent of `today`: the week looks the same after every reset.
      `timetable:${school.key}`,
    );
    for (const cell of cells) {
      ctx.rows.timetableSlots.push({
        id: ctx.ids.next(),
        schoolId: school.id,
        classSectionId: cell.classId,
        weekday: cell.weekday,
        period: cell.period,
        subjectId: cell.subjectId,
        teacherId: cell.teacherId,
      });
      const list = byClass.get(cell.classId) ?? [];
      list.push(cell);
      byClass.set(cell.classId, list);
    }
  }
  return byClass;
}
