import { addDays, eachDay, weekdayOf } from '@slash/shared';
import type { DatePlan, ExamWindow } from './context';
import { arabicMonthOf, monthStart, SchoolCalendar } from './time';

/** School days of lessons (per class, 3–4 subjects a day). */
export const LESSON_DAYS = 15;
/** School days with an attendance session for every class. */
export const ATTENDANCE_DAYS = 40;

/** Wednesday on or before `date` (a Wednesday + Thursday break makes a long weekend). */
function wednesdayOnOrBefore(date: string): string {
  let d = date;
  while (weekdayOf(d) !== 3) d = addDays(d, -1);
  return d;
}

function sundayOnOrBefore(date: string): string {
  let d = date;
  while (weekdayOf(d) !== 0) d = addDays(d, -1);
  return d;
}

/**
 * Every key date of the demo, relative to `today`: holidays, the exam windows (an earlier term,
 * last month's monthly exams, next week's monthly exams), quiz days, the parents' meeting, and the
 * instants used for "new" badges.
 */
export function planDates(today: string, now: Date): { cal: SchoolCalendar; dates: DatePlan } {
  const breakStart = wednesdayOnOrBefore(addDays(today, -17));
  const pastBreak = [breakStart, addDays(breakStart, 1)];
  const futureStart = sundayOnOrBefore(addDays(today, 50));
  const futureBreak = eachDay(futureStart, addDays(futureStart, 4));
  const cal = new SchoolCalendar(today, new Set([...pastBreak, ...futureBreak]), now);
  const recent = cal.recent(ATTENDANCE_DAYS);

  /** Four sitting days (two subjects a day) from the 15th of a month. */
  const pastWindow = (name: string, month: string, publishAfterDays: number): ExamWindow => {
    const days = cal.run(addDays(month, 14), 4);
    return {
      name,
      days,
      createdAt: cal.at(addDays(days[0], -12), 10),
      publishedAt: cal.at(cal.after(addDays(days[days.length - 1], publishAfterDays)), 12),
    };
  };
  const lastMonth = monthStart(today, -1);
  const upcomingDays = cal.run(addDays(today, 7), 4);

  // The meeting is "tomorrow" relative to its announcement, and always on a school day.
  let meetingAnnouncedOn = today;
  while (![6, 0, 1, 2, 3].includes(weekdayOf(meetingAnnouncedOn))) {
    meetingAnnouncedOn = addDays(meetingAnnouncedOn, -1);
  }

  return {
    cal,
    dates: {
      recent,
      cursorAt: cal.at(recent[1], 7),
      linkedAt: cal.at(addDays(today, -21), 9),
      pastBreak,
      futureBreak,
      term: pastWindow('امتحانات الفترة الأولى', monthStart(today, -2), 6),
      lastMonthly: pastWindow(`الامتحانات الشهرية - ${arabicMonthOf(lastMonth)}`, lastMonth, 4),
      upcomingMonthly: {
        name: `الامتحانات الشهرية - ${arabicMonthOf(upcomingDays[0])}`,
        days: upcomingDays,
        createdAt: cal.at(recent[2], 11),
        publishedAt: null,
      },
      quizDays: cal.run(cal.after(today), 3),
      meetingAnnouncedOn,
      meetingOn: addDays(meetingAnnouncedOn, 1),
    },
  };
}
