import { monthBounds, weekdayOf } from '@slash/shared';
import { ABSENCE_NOTES, homeworkText, LESSON_DETAILS, type SubjectDef } from './content';
import { teacherOf, type DemoContext, type StudentModel, type World } from './context';
import { ATTENDANCE_DAYS, LESSON_DAYS } from './plan';
import type { Rng } from './random';
import type { TimetableCell } from './timetable';

const LESSONS_PER_DAY = [3, 4] as const;
const HOMEWORK_SHARE = 0.5;
const ABSENCE_RATE = 0.04;
/** Classes whose attendance is not taken yet today, so "record absence" has something to do. */
const NOT_RECORDED_TODAY = new Set(['middle:الصف السابع:أ', 'secondary:الصف الثاني الثانوي:أ']);
/** Absences of the demo children: [this month, earlier in the academic year]. */
const DEMO_ABSENCES: Record<'musab' | 'ismail' | 'mohamed', readonly [number, number]> = {
  musab: [3, 5],
  ismail: [1, 1],
  mohamed: [1, 0],
};

/** What a lesson was about, for quizzes announced on recent topics. */
export interface LessonLogEntry {
  date: string;
  subjectId: string;
  title: string;
}

interface LessonContent {
  title: string;
  pages: string;
  details: string;
  homework: string;
}

const QURAN_CHUNK = 8;

/** The `index`-th lesson of a subject: topics in order (Quran: 8 ayat at a time). */
function lessonContent(def: SubjectDef, index: number, rng: Rng): LessonContent {
  const details = rng.pick(LESSON_DETAILS[def.kind]);
  if (def.surahs?.length) {
    const chunks = def.surahs.map((surah) => Math.ceil(surah.ayat / QURAN_CHUNK));
    let i = index % chunks.reduce((a, b) => a + b, 0);
    let k = 0;
    while (i >= chunks[k]) i -= chunks[k++];
    const surah = def.surahs[k];
    const from = i * QURAN_CHUNK + 1;
    const to = Math.min(surah.ayat, from + QURAN_CHUNK - 1);
    const page = surah.page + Math.floor((from - 1) / QURAN_CHUNK);
    return {
      title: `سورة ${surah.name}: الآيات ${from} - ${to}`,
      pages: `${page} - ${page + 1}`,
      details,
      homework: `حفظ الآيات ${from} - ${to} من سورة ${surah.name}`,
    };
  }
  const topic = index % def.topics.length;
  const start = 8 + topic * 5 + rng.int(0, 1);
  const end = start + rng.int(2, 5);
  return { title: def.topics[topic], pages: `${start} - ${end}`, details, homework: homeworkText(def.kind, end, rng.int(0, 5)) };
}

/** Minutes after midnight when a lesson taught in `period` was posted (periods start at 7:30, 45 min). */
const postedAt = (period: number, rng: Rng) => 7 * 60 + 30 + period * 45 + rng.int(10, 80);

/**
 * Lessons of the last 15 school days (3–4 of the day's timetable subjects per class, the demo
 * teacher's always included), the demo children's ticked homework, and attendance for the last 40
 * school days.
 */
export function buildActivity(
  ctx: DemoContext,
  world: World,
  timetables: Map<string, TimetableCell[]>,
): Map<string, LessonLogEntry[]> {
  const { rows, ids, cal, dates, today } = ctx;
  const rng = ctx.rng.fork('activity');
  const lessonDays = dates.recent.slice(0, LESSON_DAYS).reverse();
  const examDays = new Set(dates.lastMonthly.days);
  const log = new Map<string, LessonLogEntry[]>();
  const demoChildren = Object.values(world.children);

  for (const school of world.schools) {
    for (const cls of school.classes) {
      const cells = timetables.get(cls.id) ?? [];
      const progress = new Map(school.subjects.map((x) => [x.id, x.def.kind === 'quran' ? 0 : rng.int(0, 2)]));
      const entries: LessonLogEntry[] = [];
      const children = demoChildren.filter((c) => c.cls === cls);

      for (const date of lessonDays) {
        if (examDays.has(date)) continue;
        const weekday = weekdayOf(date);
        // Distinct subjects of the day, with the period each one is first taught.
        const daySubjects = new Map<string, number>();
        for (const cell of cells.filter((c) => c.weekday === weekday).sort((a, b) => a.period - b.period)) {
          if (!daySubjects.has(cell.subjectId)) daySubjects.set(cell.subjectId, cell.period);
        }
        const all = [...daySubjects.keys()];
        const forced = all.filter((id) => teacherOf(cls, id) === world.teacherId);
        const extra = rng.sample(
          all.filter((id) => !forced.includes(id)),
          rng.pick(LESSONS_PER_DAY) - forced.length,
        );
        const chosen = all.filter((id) => forced.includes(id) || extra.includes(id));

        for (const subjectId of chosen) {
          const subject = school.subjects.find((x) => x.id === subjectId);
          if (!subject) continue;
          const index = progress.get(subjectId) ?? 0;
          progress.set(subjectId, index + 1);
          const content = lessonContent(subject.def, index, rng);
          const hasHomework = rng.chance(HOMEWORK_SHARE);
          const createdAt = cal.at(date, 0, postedAt(daySubjects.get(subjectId) ?? 1, rng));
          const lessonId = ids.next();
          const dueDate = cal.after(date);
          rows.lessons.push({
            id: lessonId,
            schoolId: school.id,
            classSectionId: cls.id,
            subjectId,
            teacherId: teacherOf(cls, subjectId),
            date,
            title: content.title,
            pages: content.pages,
            details: content.details,
            hasHomework,
            homeworkDetails: hasHomework ? content.homework : null,
            homeworkDueDate: hasHomework ? dueDate : null,
            createdAt,
            updatedAt: createdAt,
          });
          entries.push({ date, subjectId, title: content.title });

          // The demo guardian ticks most past homework and a little of what is still due.
          if (hasHomework) {
            for (const child of children) {
              if (rng.chance(dueDate < today ? 0.75 : 0.2)) {
                rows.homeworkDone.push({
                  lessonId,
                  studentId: child.id,
                  byUserId: world.guardianId,
                  doneAt: cal.at(date, 19, rng.int(0, 150)),
                });
              }
            }
          }
        }
      }
      log.set(cls.id, entries);
    }
  }

  buildAttendance(ctx, world, rng);
  return log;
}

/** Scripted absences of a demo child: some this month, the rest earlier in the academic year. */
function demoAbsenceDays(ctx: DemoContext, child: StudentModel, days: string[], rng: Rng): Set<string> {
  const plan = child.demo ? DEMO_ABSENCES[child.demo] : ([0, 0] as const);
  const month = monthBounds(ctx.today);
  const thisMonth = days.filter((d) => d >= month.from);
  const earlier = days.filter((d) => d < month.from && d >= ctx.year.startsOn);
  // مصعب was absent on the previous school day, so his absence screen has something new.
  const recent = child.demo === 'musab' && thisMonth.includes(ctx.dates.recent[1]) ? [ctx.dates.recent[1]] : [];
  const picked = [
    ...recent,
    ...rng.sample(
      thisMonth.filter((d) => !recent.includes(d)),
      plan[0] - recent.length,
    ),
    ...rng.sample(earlier, plan[1]),
  ];
  return new Set(picked.slice(0, plan[0] + plan[1]));
}

function buildAttendance(ctx: DemoContext, world: World, rng: Rng) {
  const { rows, ids, cal, dates, today } = ctx;
  const days = dates.recent.slice(0, ATTENDANCE_DAYS);
  const scripted = new Map(
    Object.values(world.children).map((child) => [child.id, demoAbsenceDays(ctx, child, days, rng)]),
  );

  for (const school of world.schools) {
    const recorders = school.supervisorIds;
    for (const cls of school.classes) {
      for (const date of days) {
        if (date === today && NOT_RECORDED_TODAY.has(cls.key)) continue;
        const sessionId = ids.next();
        const createdAt = cal.at(date, 8, rng.int(5, 50));
        rows.attendanceSessions.push({
          id: sessionId,
          schoolId: school.id,
          classSectionId: cls.id,
          date,
          recordedBy: rng.pick(recorders),
          createdAt,
          updatedAt: createdAt,
        });
        for (const student of cls.students) {
          const fixed = scripted.get(student.id);
          const absent = fixed ? fixed.has(date) : rng.chance(ABSENCE_RATE);
          if (!absent) continue;
          rows.absences.push({
            sessionId,
            studentId: student.id,
            note: rng.chance(0.3) ? rng.pick(ABSENCE_NOTES) : null,
            createdAt,
          });
        }
      }
    }
  }
}
