import { and, asc, eq, inArray } from 'drizzle-orm';
import { addDays, todayIn, weekdayOf, type EvaluationRating } from '@slash/shared';
import type { Db } from '../../db/client';
import * as s from '../../db/schema';
import { DEMO_ACCOUNTS, DEMO_SCHOOLS } from '../../seed/demo-accounts';

/**
 * Demo data for the behavior module: a regulations catalog in each demo school, incidents for the
 * demo guardian's children and a few classmates, and recent teacher evaluations — so P14, S15, S17
 * and the regulations page open with realistic content. Runs after `seedDemo`; a school that already
 * has regulations is left untouched, so calling it twice is harmless.
 */

type RegulationKey = 'late' | 'uniform' | 'books' | 'phone' | 'absence' | 'chaos' | 'fight' | 'damage';

const REGULATIONS: Array<{ key: RegulationKey; code: string; title: string; defaultPenalty: string | null }> = [
  { key: 'late', code: '1', title: 'التأخر عن الطابور الصباحي', defaultPenalty: 'تنبيه شفهي' },
  { key: 'uniform', code: '2', title: 'عدم الالتزام بالزي المدرسي', defaultPenalty: 'إنذار أول وإخطار ولي الأمر' },
  { key: 'books', code: '3', title: 'عدم إحضار الكتب والأدوات المدرسية', defaultPenalty: null },
  {
    key: 'phone',
    code: '4',
    title: 'إحضار الهاتف الجوال إلى المدرسة',
    defaultPenalty: 'مصادرة الهاتف وتسليمه لولي الأمر',
  },
  { key: 'absence', code: '5', title: 'الغياب بدون عذر', defaultPenalty: 'استدعاء ولي الأمر' },
  { key: 'chaos', code: '6', title: 'إثارة الفوضى داخل الفصل', defaultPenalty: 'إنذار كتابي' },
  {
    key: 'fight',
    code: '7',
    title: 'الاعتداء على زميل',
    defaultPenalty: 'الإيقاف عن الدراسة يومين واستدعاء ولي الأمر',
  },
  { key: 'damage', code: '8', title: 'إتلاف ممتلكات المدرسة', defaultPenalty: 'إصلاح التلف على نفقة ولي الأمر' },
];

interface PlannedIncident {
  reg: RegulationKey;
  /** School days before today. */
  back: number;
  details: string;
  /** undefined → the regulation's default penalty. */
  penalty?: string | null;
}

/** Per demo child, in order: the middle-school children (by code), then the secondary one. */
const CHILD_INCIDENTS: PlannedIncident[][] = [
  [
    { reg: 'late', back: 2, details: 'حضر بعد انتهاء الطابور الصباحي بربع ساعة' },
    { reg: 'uniform', back: 11, details: 'حضر بدون الزي المدرسي الرسمي' },
    { reg: 'books', back: 24, details: 'لم يحضر كتاب الرياضيات وكراسة الواجب' },
  ],
  [{ reg: 'phone', back: 6, details: 'ضُبط معه هاتف جوال أثناء حصة العلوم' }],
  [],
];

const CLASSMATE_INCIDENTS: PlannedIncident[] = [
  { reg: 'chaos', back: 1, details: 'الحديث المستمر ومقاطعة المعلم أثناء الشرح' },
  { reg: 'late', back: 4, details: 'التأخر عن الحصة الأولى', penalty: null },
];

const EVALUATION_DAYS = 8;
const SUBJECTS_PER_DAY = 2;
/** Rows per INSERT, well below Postgres' 65,535 bind-parameter limit. */
const INSERT_CHUNK = 500;

const COMMENTS: Record<EvaluationRating, Array<string | null>> = {
  excellent: ['مشاركة ممتازة وحل جميع التمارين', null, 'أحسنت، استمر على هذا المستوى'],
  calm: [null, null, 'منتبه ومنضبط داخل الحصة'],
  needs_attention: ['يحتاج إلى مزيد من التركيز أثناء الشرح', 'لم يكمل الواجب المنزلي'],
  disruptive: ['كثير الحديث مع زملائه أثناء الحصة'],
};

/** Deterministic, mostly positive spread of ratings. */
function ratingFor(seed: number): EvaluationRating {
  const n = seed % 10;
  if (n < 4) return 'excellent';
  if (n < 8) return 'calm';
  if (n < 9) return 'needs_attention';
  return 'disruptive';
}

/** The school day `n` school days before `today` (Friday and Saturday are the weekend). */
function schoolDaysBack(today: string, n: number): string {
  let d = today;
  let left = n;
  while (left > 0) {
    d = addDays(d, -1);
    const wd = weekdayOf(d);
    if (wd !== 5 && wd !== 6) left--;
  }
  return d;
}

/** A Khartoum (UTC+2) wall-clock time on a calendar date. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+02:00`);

const codeNumber = (code: string) => Number(code.replace(/\D/g, '')) || 0;

export async function seedBehaviorDemo(db: Db, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? todayIn('Africa/Khartoum');
  const schoolCodes: string[] = [DEMO_SCHOOLS.middle.code, DEMO_SCHOOLS.secondary.code];
  const schools = await db.select().from(s.schools).where(inArray(s.schools.code, schoolCodes));
  if (!schools.length) return;
  schools.sort((a, b) => schoolCodes.indexOf(a.code) - schoolCodes.indexOf(b.code));

  const phoneOf = (role: string) => DEMO_ACCOUNTS.find((a) => a.role === role)?.phone ?? '';
  const [supervisor] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.phone, phoneOf('supervisor')));
  const [guardian] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.phone, phoneOf('guardian')));

  const children = guardian
    ? (
        await db
          .select({ student: s.students })
          .from(s.studentGuardians)
          .innerJoin(s.students, eq(s.students.id, s.studentGuardians.studentId))
          .where(eq(s.studentGuardians.userId, guardian.id))
      )
        .map((r) => r.student)
        .sort(
          (a, b) =>
            schools.findIndex((x) => x.id === a.schoolId) - schools.findIndex((x) => x.id === b.schoolId) ||
            codeNumber(a.code) - codeNumber(b.code),
        )
    : [];

  for (const school of schools) {
    const [hasCatalog] = await db
      .select({ id: s.regulations.id })
      .from(s.regulations)
      .where(eq(s.regulations.schoolId, school.id))
      .limit(1);
    if (hasCatalog) continue;

    const [year] = await db
      .select()
      .from(s.academicYears)
      .where(and(eq(s.academicYears.schoolId, school.id), eq(s.academicYears.isCurrent, true)));
    const yearStart = year?.startsOn ?? '0000-01-01';
    const dayBack = (n: number) => {
      const d = schoolDaysBack(today, n);
      return d >= yearStart ? d : null;
    };

    // Regulations catalog.
    const regs = await db
      .insert(s.regulations)
      .values(
        REGULATIONS.map((r) => ({
          schoolId: school.id,
          code: r.code,
          title: r.title,
          defaultPenalty: r.defaultPenalty,
        })),
      )
      .returning();
    const regByKey = new Map(REGULATIONS.map((r, i) => [r.key, regs[i]]));

    // Incidents: the demo children, then two classmates in each child's class.
    const incidents: Array<typeof s.behaviorIncidents.$inferInsert> = [];
    const plan = (studentId: string, item: PlannedIncident) => {
      const reg = regByKey.get(item.reg);
      const date = dayBack(item.back);
      if (!reg || !date) return;
      incidents.push({
        schoolId: school.id,
        studentId,
        regulationId: reg.id,
        date,
        details: item.details,
        penalty: item.penalty === undefined ? reg.defaultPenalty : item.penalty,
        recordedBy: supervisor?.id ?? null,
        createdAt: at(date, '08:30'),
      });
    };
    const schoolChildren = children.filter((c) => c.schoolId === school.id);
    for (const child of schoolChildren) {
      for (const item of CHILD_INCIDENTS[children.indexOf(child)] ?? []) plan(child.id, item);
    }
    const childClassIds = [...new Set(schoolChildren.map((c) => c.classSectionId).filter((id): id is string => !!id))];
    const classmates = childClassIds.length
      ? await db
          .select({ id: s.students.id, classSectionId: s.students.classSectionId })
          .from(s.students)
          .where(and(inArray(s.students.classSectionId, childClassIds), eq(s.students.status, 'active')))
          .orderBy(asc(s.students.code))
      : [];
    for (const classId of childClassIds) {
      const others = classmates.filter((m) => m.classSectionId === classId && !children.some((c) => c.id === m.id));
      CLASSMATE_INCIDENTS.forEach((item, i) => {
        const mate = others[i];
        if (mate) plan(mate.id, item);
      });
    }
    if (incidents.length) await db.insert(s.behaviorIncidents).values(incidents);

    // Teacher evaluations for the past school days (today is left for the demo user to fill in).
    const classes = await db
      .select()
      .from(s.classSections)
      .where(
        and(eq(s.classSections.schoolId, school.id), year ? eq(s.classSections.academicYearId, year.id) : undefined),
      );
    const assignments = await db
      .select({
        classSectionId: s.teachingAssignments.classSectionId,
        subjectId: s.teachingAssignments.subjectId,
        teacherId: s.teachingAssignments.teacherId,
        sort: s.subjects.sort,
      })
      .from(s.teachingAssignments)
      .innerJoin(s.subjects, eq(s.subjects.id, s.teachingAssignments.subjectId))
      .where(eq(s.teachingAssignments.schoolId, school.id))
      .orderBy(asc(s.subjects.sort));
    const schoolSubjects = await db
      .select()
      .from(s.subjects)
      .where(eq(s.subjects.schoolId, school.id))
      .orderBy(asc(s.subjects.sort));
    const roster = await db
      .select({ id: s.students.id, classSectionId: s.students.classSectionId })
      .from(s.students)
      .where(and(eq(s.students.schoolId, school.id), eq(s.students.status, 'active')))
      .orderBy(asc(s.students.code));

    const rows: Array<typeof s.evaluations.$inferInsert> = [];
    for (const cls of classes) {
      const own = assignments.filter((a) => a.classSectionId === cls.id);
      // Classes without assignments are taught by the supervisor in the demo.
      const teaching = own.length
        ? own
        : schoolSubjects.map((subj) => ({ subjectId: subj.id, teacherId: supervisor?.id ?? null }));
      if (!teaching.length) continue;
      const pupils = roster.filter((p) => p.classSectionId === cls.id);
      for (let day = 1; day <= EVALUATION_DAYS; day++) {
        const date = dayBack(day);
        if (!date) continue;
        for (let k = 0; k < Math.min(SUBJECTS_PER_DAY, teaching.length); k++) {
          const subjectIndex = (day * SUBJECTS_PER_DAY + k) % teaching.length;
          const { subjectId, teacherId } = teaching[subjectIndex];
          pupils.forEach((pupil, i) => {
            const seed = i * 7 + day * 3 + subjectIndex * 5;
            const rating = ratingFor(seed);
            const comments = COMMENTS[rating];
            rows.push({
              schoolId: school.id,
              studentId: pupil.id,
              subjectId,
              teacherId,
              date,
              rating,
              comment: comments[seed % comments.length],
              createdAt: at(date, '11:00'),
            });
          });
        }
      }
    }
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await db
        .insert(s.evaluations)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoNothing();
    }
  }
}
