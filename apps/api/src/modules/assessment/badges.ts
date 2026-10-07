import { and, count, countDistinct, eq, gt, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessments, examPeriods, scores } from '../../db/schema';

interface BadgeStudent {
  id: string;
  schoolId: string;
  classSectionId: string | null;
}

/**
 * "الإمتحانات" badge (P3): quiz announcements plus exam timetables (counted once per period) added to the
 * student's class after `since`.
 */
export async function countNewExams(db: Db, student: BadgeStudent, since: Date): Promise<number> {
  if (!student.classSectionId) return 0;
  const inClass = and(
    eq(assessments.schoolId, student.schoolId),
    eq(assessments.classSectionId, student.classSectionId),
    gt(assessments.createdAt, since),
  );
  const [[quizzes], [periods]] = await Promise.all([
    db
      .select({ n: count() })
      .from(assessments)
      .where(and(inClass, eq(assessments.kind, 'quiz'))),
    db
      .select({ n: countDistinct(assessments.examPeriodId) })
      .from(assessments)
      .where(and(inClass, isNotNull(assessments.examPeriodId))),
  ]);
  return (quizzes?.n ?? 0) + (periods?.n ?? 0);
}

/**
 * "النتائج" badge (P3): quiz scores of the student entered or changed after `since`, plus exam periods of the
 * student's class whose results were published after `since`.
 */
export async function countNewResults(db: Db, student: BadgeStudent, since: Date): Promise<number> {
  const [[quizScores], [periods]] = await Promise.all([
    db
      .select({ n: count() })
      .from(scores)
      .innerJoin(assessments, eq(assessments.id, scores.assessmentId))
      .where(
        and(
          eq(scores.studentId, student.id),
          eq(assessments.schoolId, student.schoolId),
          eq(assessments.kind, 'quiz'),
          gt(scores.updatedAt, since),
        ),
      ),
    student.classSectionId
      ? db
          .select({ n: countDistinct(examPeriods.id) })
          .from(examPeriods)
          .innerJoin(assessments, eq(assessments.examPeriodId, examPeriods.id))
          .where(
            and(
              eq(examPeriods.schoolId, student.schoolId),
              eq(assessments.classSectionId, student.classSectionId),
              gt(examPeriods.resultsPublishedAt, since),
            ),
          )
      : Promise.resolve([{ n: 0 }]),
  ]);
  return (quizScores?.n ?? 0) + (periods?.n ?? 0);
}
