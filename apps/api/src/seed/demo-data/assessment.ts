import { addDays, ASSESSMENT_KIND_LABELS, type ExamPeriodKind } from '@slash/shared';
import type { SubjectDef } from './content';
import {
  subjectNamed,
  teacherOf,
  type ClassModel,
  type DemoContext,
  type ExamWindow,
  type StudentModel,
  type SubjectModel,
  type World,
} from './context';
import type { LessonLogEntry } from './activity';
import type { Rng } from './random';

/** مصعب's marks (by subject name): a fair term, a weaker monthly — hence the call to the school. */
const MUSAB_SCORES: Record<'term' | 'monthly' | 'quiz', Record<string, number>> = {
  term: {
    الرياضيات: 72,
    'اللغة العربية': 78,
    'اللغة الإنجليزية': 61,
    العلوم: 80,
    'التربية الإسلامية': 88,
    'القرآن الكريم': 44,
    الحاسوب: 75,
  },
  monthly: {
    الرياضيات: 33,
    'اللغة العربية': 36,
    'اللغة الإنجليزية': 27,
    العلوم: 38,
    'التربية الإسلامية': 42,
    'القرآن الكريم': 24,
    الحاسوب: 35,
  },
  quiz: { الرياضيات: 15, 'اللغة الإنجليزية': 16, العلوم: 17 },
};

/** Graded quizzes per class: [middle subject, secondary subject], on these recent school days. */
const PAST_QUIZZES: ReadonlyArray<{ subjects: readonly [string, string]; daysAgo: number }> = [
  { subjects: ['الرياضيات', 'الرياضيات'], daysAgo: 2 },
  { subjects: ['اللغة الإنجليزية', 'الفيزياء'], daysAgo: 6 },
  { subjects: ['العلوم', 'الكيمياء'], daysAgo: 10 },
];

/** A student's mark out of `max`, around their ability. */
function markFor(student: StudentModel, max: number, rng: Rng, scripted?: number): number {
  if (student.demo === 'musab' && scripted !== undefined) return scripted;
  const share = Math.min(1, Math.max(0.15, student.ability + (rng.next() - 0.5) * 0.26));
  return Math.round(share * max);
}

/** Latest lesson topic of a subject in a class on or before `date`. */
function latestTopics(log: Map<string, LessonLogEntry[]>, cls: ClassModel, subject: SubjectModel, date: string) {
  const titles = (log.get(cls.id) ?? [])
    .filter((e) => e.subjectId === subject.id && e.date <= date)
    .map((e) => e.title);
  const fallback = subject.def.topics[0] ?? subject.def.name;
  return { latest: titles[titles.length - 1] ?? fallback, previous: titles[titles.length - 2] ?? null };
}

/**
 * Per grade level: an earlier published term, last month's published monthly exams (scores for every
 * student and subject) and next week's monthly exams (timetable only). Per class: three graded quizzes
 * and two or three announced ones.
 */
export function buildAssessments(ctx: DemoContext, world: World, log: Map<string, LessonLogEntry[]>): void {
  const { rows, ids, cal, dates } = ctx;
  const rng = ctx.rng.fork('assessment');
  const periods: ReadonlyArray<{ window: ExamWindow; kind: ExamPeriodKind; max: (d: SubjectDef) => number }> = [
    { window: dates.term, kind: 'term', max: (d) => d.termMax },
    { window: dates.lastMonthly, kind: 'monthly', max: (d) => d.monthlyMax },
    { window: dates.upcomingMonthly, kind: 'monthly', max: (d) => d.monthlyMax },
  ];
  const examDays = new Set(periods.flatMap((p) => p.window.days));

  for (const school of world.schools) {
    for (const grade of school.grades) {
      for (const { window, kind, max } of periods) {
        const periodId = ids.next();
        rows.examPeriods.push({
          id: periodId,
          schoolId: school.id,
          academicYearId: school.academicYearId,
          gradeLevelId: grade.id,
          kind,
          name: window.name,
          resultsPublishedAt: window.publishedAt,
          createdBy: world.supervisorId,
          createdAt: window.createdAt,
        });
        for (const cls of grade.classes) {
          school.subjects.forEach((subject, index) => {
            const date = window.days[Math.min(Math.floor(index / 2), window.days.length - 1)];
            const assessmentId = ids.next();
            const maxScore = max(subject.def);
            rows.assessments.push({
              id: assessmentId,
              schoolId: school.id,
              examPeriodId: periodId,
              classSectionId: cls.id,
              subjectId: subject.id,
              kind,
              title: `${ASSESSMENT_KIND_LABELS[kind]} - ${subject.def.name}`,
              date,
              maxScore,
              details: null,
              createdBy: world.supervisorId,
              createdAt: window.createdAt,
              updatedAt: window.createdAt,
            });
            if (!window.publishedAt) return;
            const enteredBy = teacherOf(cls, subject.id);
            for (const student of cls.students) {
              rows.scores.push({
                assessmentId,
                studentId: student.id,
                score: markFor(
                  student,
                  maxScore,
                  rng,
                  MUSAB_SCORES[kind === 'term' ? 'term' : 'monthly'][subject.def.name],
                ),
                enteredBy,
                updatedAt: cal.at(cal.after(date), 13, rng.int(0, 90)),
              });
            }
          });
        }
      }
    }

    for (const cls of school.classes) {
      const ci = cls.index;
      const subjectIndex = school.key === 'middle' ? 0 : 1;

      // Graded quizzes.
      for (const quiz of PAST_QUIZZES) {
        const subject = subjectNamed(school, quiz.subjects[subjectIndex]);
        let date = dates.recent[quiz.daysAgo + (ci % 2)];
        while (examDays.has(date)) date = cal.onOrBefore(addDays(date, -1));
        const { latest } = latestTopics(log, cls, subject, date);
        const teacher = teacherOf(cls, subject.id);
        const createdAt = cal.at(cal.onOrBefore(addDays(date, -3)), 12, rng.int(0, 59));
        const assessmentId = ids.next();
        rows.assessments.push({
          id: assessmentId,
          schoolId: school.id,
          examPeriodId: null,
          classSectionId: cls.id,
          subjectId: subject.id,
          kind: 'quiz',
          title: `اختبار قصير - ${latest}`,
          date,
          maxScore: subject.def.quizMax,
          details: `يشمل درس ${latest} والتمارين عليه`,
          createdBy: teacher,
          createdAt,
          updatedAt: createdAt,
        });
        for (const student of cls.students) {
          rows.scores.push({
            assessmentId,
            studentId: student.id,
            score: markFor(student, subject.def.quizMax, rng, MUSAB_SCORES.quiz[subject.def.name]),
            enteredBy: teacher,
            updatedAt: cal.at(cal.after(date), 13, rng.int(0, 90)),
          });
        }
      }

      // Announced quizzes (P11), all before next week's monthly exams.
      const upcoming: Array<{ subject: SubjectModel; title: string; details: string }> = [];
      upcoming.push({
        subject: subjectNamed(school, 'القرآن الكريم'),
        title: 'اختبار تسميع',
        details: school.key === 'middle' ? 'سورة النور من الآية 1 إلى 50' : 'سورة يس من الآية 1 إلى 40',
      });
      const topicQuiz = (name: string) => {
        const subject = subjectNamed(school, name);
        const { latest, previous } = latestTopics(log, cls, subject, ctx.today);
        upcoming.push({
          subject,
          title: `اختبار قصير - ${latest}`,
          details: previous ? `يشمل درسي ${previous} و${latest}` : `يشمل درس ${latest}`,
        });
      };
      topicQuiz('الرياضيات');
      if (ci % 2 === 0) topicQuiz(school.key === 'middle' ? 'اللغة العربية' : 'الأحياء');

      upcoming.forEach(({ subject, title, details }, k) => {
        const createdAt = cal.at(dates.recent[ci % 2], 12, rng.int(0, 50));
        rows.assessments.push({
          id: ids.next(),
          schoolId: school.id,
          examPeriodId: null,
          classSectionId: cls.id,
          subjectId: subject.id,
          kind: 'quiz',
          title,
          date: dates.quizDays[(k + ci) % dates.quizDays.length],
          maxScore: subject.def.quizMax,
          details,
          createdBy: teacherOf(cls, subject.id),
          createdAt,
          updatedAt: createdAt,
        });
      });
    }
  }
}
