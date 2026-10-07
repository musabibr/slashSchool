import { and, asc, eq, inArray } from 'drizzle-orm';
import { addDays, formatDate, joinName, todayIn, type AudienceType, type CalendarKind } from '@slash/shared';
import type { Db } from '../../db/client';
import * as s from '../../db/schema';
import { currentAcademicYear, listSchoolClasses } from '../../lib/scope';
import { DEMO_ACCOUNTS } from '../../seed/demo-accounts';

const DAY_MS = 86_400_000;

interface PlannedAnnouncement {
  audience: AudienceType;
  /** Days before now it was published. */
  daysAgo: number;
  title: string;
  body: (ctx: { gradeName: string; classLabel: string; studentName: string; date: (n: number) => string }) => string;
}

/**
 * P16 examples: to everyone, to one grade, to one class and to one guardian ("please come to school…").
 * The demo guardian was linked 21 days ago, so the ones published since then show as unread on P3.
 */
const ANNOUNCEMENTS: PlannedAnnouncement[] = [
  {
    audience: 'school',
    daysAgo: 40,
    title: 'مرحباً بكم في العام الدراسي الجديد',
    body: () =>
      'تتقدم إدارة المدرسة بالتهنئة لأبنائنا الطلاب وأولياء الأمور ببداية العام الدراسي، ونرجو الالتزام بالزي المدرسي ومواعيد الطابور الصباحي (7:30 صباحاً).',
  },
  {
    audience: 'school',
    daysAgo: 9,
    title: 'اجتماع مجلس الآباء',
    body: ({ date }) =>
      `يتشرف مجلس الآباء بدعوتكم لحضور الاجتماع الدوري يوم ${date(3)} الساعة 10 صباحاً بمسرح المدرسة، لمناقشة نتائج الامتحانات الشهرية وخطة الفترة القادمة.`,
  },
  {
    audience: 'grade_level',
    daysAgo: 4,
    title: 'رحلة علمية',
    body: ({ gradeName, date }) =>
      `إلى طلاب ${gradeName}: تنظم المدرسة رحلة علمية إلى متحف السودان القومي يوم ${date(8)}. الرجاء إحضار استمارة الموافقة موقعة من ولي الأمر ورسوم الرحلة (5,000 جنيه) قبل يوم الخميس.`,
  },
  {
    audience: 'class_section',
    daysAgo: 2,
    title: 'تغيير موعد اختبار الرياضيات',
    body: ({ classLabel, date }) =>
      `طلاب ${classLabel}: تم تأجيل اختبار الرياضيات إلى يوم ${date(5)} بدلاً من يوم الإثنين، والمقرر من الصفحة 15 إلى الصفحة 50.`,
  },
  {
    audience: 'student',
    daysAgo: 1,
    title: 'الرجاء الحضور إلى المدرسة',
    body: ({ studentName }) =>
      `السيد ولي أمر الطالب ${studentName}، الرجاء الحضور إلى المدرسة يوم الأحد القادم الساعة 9 صباحاً لمقابلة المشرف الأكاديمي بخصوص مستوى الطالب.`,
  },
];

interface PlannedEvent {
  kind: CalendarKind;
  title: string;
  /** Days from today (negative = past); `days` = length in days. */
  start: number;
  days?: number;
  details?: string;
  /** Days before now it was added (recent ones show the calendar badge). */
  addedDaysAgo: number;
}

const EVENTS: PlannedEvent[] = [
  {
    kind: 'holiday',
    title: 'عطلة منتصف الفترة',
    start: -12,
    days: 3,
    details: 'تستأنف الدراسة بعد انتهاء العطلة مباشرة',
    addedDaysAgo: 45,
  },
  {
    kind: 'meeting',
    title: 'اجتماع مجلس الآباء',
    start: 3,
    details: 'الساعة 10 صباحاً بمسرح المدرسة',
    addedDaysAgo: 9,
  },
  { kind: 'event', title: 'اليوم الرياضي', start: 6, details: 'منافسات بين الفصول وتوزيع جوائز', addedDaysAgo: 2 },
  { kind: 'event', title: 'رحلة علمية إلى المتحف القومي', start: 8, addedDaysAgo: 4 },
  {
    kind: 'exam',
    title: 'الامتحانات الشهرية',
    start: 13,
    days: 5,
    details: 'يُعلن جدول الامتحانات في قسم الإمتحانات',
    addedDaysAgo: 40,
  },
  { kind: 'event', title: 'حفل تكريم المتفوقين', start: 24, addedDaysAgo: 40 },
  { kind: 'holiday', title: 'عطلة الفترة الأولى', start: 33, days: 7, addedDaysAgo: 45 },
];

/**
 * Demo data for announcements (P16) and the academic calendar (P15) in every school: messages to the whole
 * school, to a grade, to a class and to one guardian, plus calendar events around today, so the guardian home
 * opens with unread badges. Call after the schools, staff, students and guardians are seeded (e.g. at the end
 * of `seedDemo`). A school that already has announcements or events is left untouched, so it is safe to re-run.
 */
export async function seedCommsDemo(db: Db, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? todayIn('Africa/Khartoum');
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY_MS);
  const date = (n: number) => formatDate(addDays(today, n));

  const guardianPhone = DEMO_ACCOUNTS.find((a) => a.role === 'guardian')?.phone ?? '';
  const [demoGuardian] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, guardianPhone));
  const schools = await db.select().from(s.schools).orderBy(asc(s.schools.createdAt));

  for (const school of schools) {
    const [hasAnnouncements] = await db
      .select({ id: s.announcements.id })
      .from(s.announcements)
      .where(eq(s.announcements.schoolId, school.id))
      .limit(1);
    const [hasEvents] = await db
      .select({ id: s.calendarEvents.id })
      .from(s.calendarEvents)
      .where(eq(s.calendarEvents.schoolId, school.id))
      .limit(1);
    if (hasAnnouncements || hasEvents) continue;

    const year = await currentAcademicYear(db, school.id);
    const classes = await listSchoolClasses(db, school.id);
    const [admin] = await db
      .select({ id: s.memberships.userId })
      .from(s.memberships)
      .where(and(eq(s.memberships.schoolId, school.id), eq(s.memberships.role, 'admin')))
      .limit(1);

    // Aim the targeted messages at the demo guardian's child in this school (else the first student).
    const children = demoGuardian
      ? await db
          .select({ student: s.students })
          .from(s.studentGuardians)
          .innerJoin(s.students, eq(s.students.id, s.studentGuardians.studentId))
          .where(and(eq(s.studentGuardians.userId, demoGuardian.id), eq(s.studentGuardians.schoolId, school.id)))
          .orderBy(asc(s.students.code))
      : [];
    const classIds = classes.map((c) => c.id);
    const [firstStudent] = classIds.length
      ? await db
          .select()
          .from(s.students)
          .where(and(eq(s.students.schoolId, school.id), inArray(s.students.classSectionId, classIds)))
          .orderBy(asc(s.students.createdAt))
          .limit(1)
      : [];
    const student = children[0]?.student ?? firstStudent;
    const cls = classes.find((c) => c.id === student?.classSectionId) ?? classes[0];

    if (cls && student) {
      const ctx = {
        gradeName: cls.gradeLevelName,
        classLabel: cls.label,
        studentName: joinName(student.firstName, student.fatherName, student.grandfatherName),
        date,
      };
      const audienceIdOf: Record<AudienceType, string | null> = {
        school: null,
        grade_level: cls.gradeLevelId,
        class_section: cls.id,
        student: student.id,
      };
      await db.insert(s.announcements).values(
        ANNOUNCEMENTS.map((a) => ({
          schoolId: school.id,
          title: a.title,
          body: a.body(ctx),
          audienceType: a.audience,
          audienceId: audienceIdOf[a.audience],
          createdBy: admin?.id ?? null,
          publishedAt: ago(a.daysAgo),
          createdAt: ago(a.daysAgo),
        })),
      );
    }

    const yearEvents: PlannedEvent[] = [];
    if (year) {
      const startOffset = Math.round((Date.parse(year.startsOn) - Date.parse(today)) / DAY_MS);
      yearEvents.push({ kind: 'event', title: 'بداية العام الدراسي', start: startOffset, addedDaysAgo: 60 });
    }
    await db.insert(s.calendarEvents).values(
      [...yearEvents, ...EVENTS].map((e) => {
        const startsOn = addDays(today, e.start);
        return {
          schoolId: school.id,
          title: e.title,
          kind: e.kind,
          startsOn,
          endsOn: addDays(startsOn, (e.days ?? 1) - 1),
          details: e.details ?? null,
          createdBy: admin?.id ?? null,
          createdAt: ago(e.addedDaysAgo),
        };
      }),
    );
  }
}
