import { and, asc, eq, inArray } from 'drizzle-orm';
import { addDays, todayIn, weekdayOf, type ExamPeriodKind } from '@slash/shared';
import type { Db } from '../../db/client';
import { assessments, examPeriods, memberships, schools, scores, subjects, teachingAssignments } from '../../db/schema';
import { classStudents, currentAcademicYear, listSchoolClasses } from '../../lib/scope';

/** Friday and Saturday are the weekend in the demo schools. */
const WEEKEND = new Set([5, 6]);

const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/** The school day `offset` school days away from `from` (negative = before). */
function schoolDay(from: string, offset: number): string {
  let date = from;
  let left = Math.abs(offset);
  const step = offset < 0 ? -1 : 1;
  while (left > 0) {
    date = addDays(date, step);
    if (!WEEKEND.has(weekdayOf(date))) left -= 1;
  }
  return date;
}

/** Stable pseudo-random number in [0, 1) for a string, so demo scores are the same on every seed. */
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

/** A believable score: each student has a level, each sitting a little noise; half points allowed. */
function demoScore(studentId: string, assessmentId: string, maxScore: number): number {
  const level = 0.5 + 0.45 * unit(studentId);
  const noise = (unit(`${studentId}:${assessmentId}`) - 0.5) * 0.3;
  const share = Math.min(1, Math.max(0.3, level + noise));
  return Math.round(share * maxScore * 2) / 2;
}

interface PeriodPlan {
  kind: ExamPeriodKind;
  name: (firstDate: string) => string;
  /** School-day offset (from today) of the first sitting; one subject per school day after it. */
  start: number;
  maxScore: number;
  graded: boolean;
  published: boolean;
}

const PERIODS: PeriodPlan[] = [
  {
    kind: 'monthly',
    name: (d) => `الامتحانات الشهرية - ${MONTHS[Number(d.slice(5, 7)) - 1]}`,
    start: -18,
    maxScore: 50,
    graded: true,
    published: true,
  },
  { kind: 'weekly', name: () => 'الامتحان الأسبوعي', start: -7, maxScore: 20, graded: true, published: false },
  { kind: 'term', name: () => 'امتحانات الفترة الأولى', start: 10, maxScore: 100, graded: false, published: false },
];

interface QuizPlan {
  subject: string;
  offset: number;
  title: string;
  details: string;
  maxScore: number;
}

/** Quiz announcements per class (P11 / S13): two already graded, two coming up. */
const QUIZZES: QuizPlan[] = [
  {
    subject: 'الرياضيات',
    offset: -9,
    title: 'اختبار قصير: الكسور العشرية',
    details: 'الدرس الأول والثاني — صفحة 15 إلى 30',
    maxScore: 30,
  },
  {
    subject: 'القرآن الكريم',
    offset: -3,
    title: 'تسميع سورة النور',
    details: 'سورة النور من الآية 1 إلى 50',
    maxScore: 20,
  },
  {
    subject: 'اللغة العربية',
    offset: 2,
    title: 'اختبار الإملاء',
    details: 'الهمزة المتوسطة — الدرس الرابع',
    maxScore: 20,
  },
  { subject: 'العلوم', offset: 5, title: 'اختبار قصير: الخلية', details: 'الوحدة الثانية كاملة', maxScore: 25 },
];

/**
 * Demo exams for every school already in the database: per grade level a published monthly exam with scores,
 * a graded but unpublished weekly exam (to try "نشر النتائج") and an upcoming term timetable; per class four
 * quiz announcements, the past ones graded. Call it after the base demo seed.
 */
export async function seedAssessmentDemo(db: Db, opts: { today?: string } = {}): Promise<void> {
  const allSchools = await db.select().from(schools);
  for (const school of allSchools) {
    const today = opts.today ?? todayIn(school.timezone);
    const year = await currentAcademicYear(db, school.id);
    const classes = await listSchoolClasses(db, school.id);
    if (!year || !classes.length) continue;
    const inYear = (date: string) => date >= year.startsOn && date <= year.endsOn;

    const [author] = await db
      .select({ id: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.schoolId, school.id), inArray(memberships.role, ['admin', 'supervisor'])))
      .limit(1);
    const createdBy = author?.id ?? null;

    const schoolSubjects = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.schoolId, school.id))
      .orderBy(asc(subjects.sort), asc(subjects.name));
    const assigned = await db
      .select({ classSectionId: teachingAssignments.classSectionId, subjectId: teachingAssignments.subjectId })
      .from(teachingAssignments)
      .where(eq(teachingAssignments.schoolId, school.id));
    const subjectsOf = (classId: string) => {
      const ids = new Set(assigned.filter((a) => a.classSectionId === classId).map((a) => a.subjectId));
      return ids.size ? schoolSubjects.filter((s) => ids.has(s.id)) : schoolSubjects;
    };
    const rosters = new Map<string, string[]>();
    for (const c of classes)
      rosters.set(
        c.id,
        (await classStudents(db, c.id)).map((s) => s.id),
      );

    const pendingScores: Array<typeof scores.$inferInsert> = [];
    const grade = (assessmentId: string, classId: string, maxScore: number) => {
      for (const studentId of rosters.get(classId) ?? []) {
        pendingScores.push({
          assessmentId,
          studentId,
          score: demoScore(studentId, assessmentId, maxScore),
          enteredBy: createdBy,
        });
      }
    };

    // Exam periods, one set per grade level.
    const gradeIds = [...new Set(classes.map((c) => c.gradeLevelId))];
    for (const gradeLevelId of gradeIds) {
      const gradeClasses = classes.filter((c) => c.gradeLevelId === gradeLevelId);
      const gradeSubjects = schoolSubjects.filter((s) => gradeClasses.some((c) => subjectsOf(c.id).includes(s)));
      if (!gradeSubjects.length) continue;
      for (const plan of PERIODS) {
        const dates = gradeSubjects.map((_, i) => schoolDay(today, plan.start + i));
        if (!dates.every(inYear) || (plan.graded && dates.some((d) => d >= today))) continue;
        const [period] = await db
          .insert(examPeriods)
          .values({
            schoolId: school.id,
            academicYearId: year.id,
            gradeLevelId,
            kind: plan.kind,
            name: plan.name(dates[0]),
            resultsPublishedAt: plan.published ? new Date(Date.now() - 2 * 86_400_000) : null,
            createdBy,
          })
          .returning({ id: examPeriods.id });
        const sittings = await db
          .insert(assessments)
          .values(
            gradeClasses.flatMap((c) =>
              gradeSubjects.map((s, i) => ({
                schoolId: school.id,
                examPeriodId: period.id,
                classSectionId: c.id,
                subjectId: s.id,
                kind: plan.kind,
                title: s.name,
                date: dates[i],
                maxScore: plan.maxScore,
                createdBy,
              })),
            ),
          )
          .returning({ id: assessments.id, classSectionId: assessments.classSectionId });
        if (plan.graded) for (const s of sittings) grade(s.id, s.classSectionId, plan.maxScore);
      }
    }

    // Quiz announcements per class.
    for (const c of classes) {
      const offered = subjectsOf(c.id);
      for (const plan of QUIZZES) {
        const subject = offered.find((s) => s.name === plan.subject);
        const date = schoolDay(today, plan.offset);
        if (!subject || !inYear(date)) continue;
        const [quiz] = await db
          .insert(assessments)
          .values({
            schoolId: school.id,
            classSectionId: c.id,
            subjectId: subject.id,
            kind: 'quiz',
            title: plan.title,
            date,
            maxScore: plan.maxScore,
            details: plan.details,
            createdBy,
          })
          .returning({ id: assessments.id });
        if (date < today) grade(quiz.id, c.id, plan.maxScore);
      }
    }

    for (let i = 0; i < pendingScores.length; i += 500) {
      await db.insert(scores).values(pendingScores.slice(i, i + 500));
    }
  }
}
