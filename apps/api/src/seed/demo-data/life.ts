import {
  addDays,
  BADGE_MODULES,
  formatDate,
  WEEKDAY_LABELS,
  weekdayOf,
  type AudienceType,
  type CalendarKind,
  type EvaluationRating,
  type PaymentMethod,
} from '@slash/shared';
import { byGender, EVALUATION_COMMENTS, FEE_INSTALLMENTS, REGULATIONS } from './content';
import { teacherOf, type DemoContext, type SchoolModel, type StudentModel, type World } from './context';
import type { Rng } from './random';
import { maxDate, minDate } from './time';

export function buildSchoolLife(ctx: DemoContext, world: World): void {
  const rng = ctx.rng.fork('life');
  buildBehavior(ctx, world, rng.fork('behavior'));
  buildEvaluations(ctx, world, rng.fork('evaluations'));
  buildFees(ctx, world, rng.fork('fees'));
  buildAnnouncements(ctx, world);
  buildCalendar(ctx, world);
  buildReadCursors(ctx, world);
}

// ───────────────────────────── Behavior ─────────────────────────────

const RANDOM_INCIDENTS = 11;
const HAIRCUT = 1;

function buildBehavior(ctx: DemoContext, world: World, rng: Rng) {
  const { rows, ids, cal, dates } = ctx;
  const regulationIds = new Map<string, string[]>();
  for (const school of world.schools) {
    regulationIds.set(
      school.id,
      REGULATIONS.map((reg, i) => {
        const id = ids.next();
        rows.regulations.push({
          id,
          schoolId: school.id,
          code: String(i + 1).padStart(2, '0'),
          title: reg.title,
          defaultPenalty: reg.defaultPenalty,
        });
        return id;
      }),
    );
  }

  const incident = (student: StudentModel, reg: number, date: string, withPenalty: boolean, recordedBy: string) => {
    const regulationId = regulationIds.get(student.school.id)?.[reg];
    if (!regulationId) throw new Error(`demo regulation missing: ${reg}`);
    rows.behaviorIncidents.push({
      id: ids.next(),
      schoolId: student.school.id,
      studentId: student.id,
      regulationId,
      date,
      details: byGender(REGULATIONS[reg].details, student.gender),
      penalty: withPenalty ? REGULATIONS[reg].defaultPenalty : null,
      recordedBy,
      createdAt: cal.at(date, 10, rng.int(0, 120)),
    });
  };

  // The sketch's P14: مصعب has two violations (uniform, haircut) and one penalty.
  const { musab, ismail, mohamed } = world.children;
  incident(musab, 0, dates.recent[4], true, world.supervisorId);
  incident(musab, HAIRCUT, dates.recent[9], false, world.supervisorId);
  incident(ismail, 2, dates.recent[6], false, world.supervisorId);
  incident(mohamed, 4, dates.recent[3], true, world.adminId);

  const pool = world.students.filter((st) => !st.special);
  for (let i = 0; i < RANDOM_INCIDENTS; i++) {
    const student = rng.pick(pool);
    let reg = rng.int(0, REGULATIONS.length - 1);
    if (reg === HAIRCUT && student.gender === 'female') reg = 2;
    incident(
      student,
      reg,
      rng.pick(dates.recent.slice(1, 30)),
      rng.chance(0.65),
      rng.pick([...student.school.supervisorIds, world.adminId]),
    );
  }
}

// ───────────────────────────── Evaluations ─────────────────────────────

const RATING_WEIGHTS: ReadonlyArray<readonly [EvaluationRating, number]> = [
  ['excellent', 25],
  ['calm', 55],
  ['needs_attention', 15],
  ['disruptive', 5],
];
const COMMENT_CHANCE: Record<EvaluationRating, number> = {
  excellent: 0.6,
  calm: 0.3,
  needs_attention: 0.9,
  disruptive: 1,
};
/** Evaluation rounds per class: school days ago. */
const EVALUATION_DAYS = [0, 2, 5];
/** مصعب per round: [rating, comment index]. */
const MUSAB_EVALUATIONS: ReadonlyArray<readonly [EvaluationRating, number]> = [
  ['calm', 0],
  ['needs_attention', 0],
  ['excellent', 0],
];

function buildEvaluations(ctx: DemoContext, world: World, rng: Rng) {
  const { rows, ids, cal, dates } = ctx;
  for (const school of world.schools) {
    const subjects = school.subjects;
    for (const cls of school.classes) {
      const ci = cls.index;
      // The demo teacher's subject first, so the teacher's evaluation screen has data.
      const own = subjects.find((x) => teacherOf(cls, x.id) === world.teacherId);
      const rounds = [own ?? subjects[ci % subjects.length]];
      for (let k = 2; rounds.length < EVALUATION_DAYS.length; k += 2) {
        const next = subjects[(ci + k) % subjects.length];
        if (!rounds.includes(next)) rounds.push(next);
      }
      rounds.forEach((subject, round) => {
        const date = dates.recent[EVALUATION_DAYS[round]];
        const teacherId = teacherOf(cls, subject.id);
        for (const student of cls.students) {
          const scripted = student.demo === 'musab' ? MUSAB_EVALUATIONS[round] : undefined;
          const rating = scripted?.[0] ?? rng.weighted(RATING_WEIGHTS);
          const comments = EVALUATION_COMMENTS[rating];
          const comment = scripted
            ? byGender(comments[scripted[1]], student.gender)
            : rng.chance(COMMENT_CHANCE[rating])
              ? byGender(rng.pick(comments), student.gender)
              : null;
          rows.evaluations.push({
            id: ids.next(),
            schoolId: school.id,
            studentId: student.id,
            subjectId: subject.id,
            teacherId,
            date,
            rating,
            comment,
            createdAt: cal.at(date, 12, rng.int(0, 60)),
          });
        }
      });
    }
  }
}

// ───────────────────────────── Fees ─────────────────────────────

type PayPattern = 'full' | 'onTrack' | 'partial' | 'none';
const PAY_PATTERNS: ReadonlyArray<readonly [PayPattern, number]> = [
  ['full', 30],
  ['onTrack', 35],
  ['partial', 20],
  ['none', 15],
];
const PAYMENT_METHODS: ReadonlyArray<readonly [PaymentMethod, number]> = [
  ['cash', 50],
  ['bankak', 35],
  ['bank_transfer', 15],
];
const INSTALLMENT_NAMES = ['القسط الأول', 'القسط الثاني', 'القسط الثالث'];

/** Installment due dates of the academic year: at its start, mid-January and mid-April. */
function installmentDueDates(startYear: number): string[] {
  return [`${startYear}-07-15`, `${startYear + 1}-01-15`, `${startYear + 1}-04-15`];
}

/** Each installment's amount after the discount (taken from the last installments first). */
function discountedDues(amounts: readonly number[], discount: number): number[] {
  const dues = [...amounts];
  let left = discount;
  for (let k = dues.length - 1; k >= 0 && left > 0; k--) {
    const cut = Math.min(dues[k], left);
    dues[k] -= cut;
    left -= cut;
  }
  return dues;
}

const roundDown = (value: number, step: number) => Math.floor(value / step) * step;

function buildFees(ctx: DemoContext, world: World, rng: Rng) {
  const { rows, ids, cal, today, year } = ctx;
  const dueDates = installmentDueDates(year.startYear);
  const earliest = addDays(year.startsOn, -25);
  const randomDay = (from: string, to: string) => {
    const span = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
    return addDays(from, rng.int(0, span));
  };

  for (const school of world.schools) {
    const payments: Array<{ studentFeeId: string; amount: number; paidAt: string; method: PaymentMethod }> = [];
    const amounts = FEE_INSTALLMENTS[school.key];
    for (const grade of school.grades) {
      const feePlanId = ids.next();
      const planCreatedAt = cal.at(addDays(year.startsOn, -20), 10);
      rows.feePlans.push({
        id: feePlanId,
        schoolId: school.id,
        academicYearId: school.academicYearId,
        gradeLevelId: grade.id,
        name: `رسوم العام الدراسي ${year.name}`,
        createdAt: planCreatedAt,
      });
      amounts.forEach((amount, i) => {
        rows.planInstallments.push({ id: ids.next(), feePlanId, seq: i + 1, amount, dueDate: dueDates[i] });
      });

      for (const student of grade.classes.flatMap((c) => c.students)) {
        const studentFeeId = ids.next();
        rows.studentFees.push({
          id: studentFeeId,
          schoolId: school.id,
          studentId: student.id,
          feePlanId,
          discount: student.discount,
          createdAt: planCreatedAt,
        });
        const pay = (amount: number, paidAt: string, method: PaymentMethod) =>
          payments.push({ studentFeeId, amount, paidAt, method });

        if (student.demo === 'musab') {
          // The sketch's P9: 300,000 + 100,000 paid of 600,000.
          const first = minDate(addDays(year.startsOn, 9), addDays(today, -10));
          pay(300_000, first, 'cash');
          pay(100_000, maxDate(first, minDate(addDays(year.startsOn, 102), addDays(today, -3))), 'bankak');
          continue;
        }

        const dues = discountedDues(amounts, student.discount);
        const net = dues.reduce((a, b) => a + b, 0);
        const owedNow = Math.max(
          dues[0],
          dues.reduce((sum, due, i) => sum + (dueDates[i] < today ? due : 0), 0),
        );
        const pattern: PayPattern =
          student.demo === 'ismail' ? 'onTrack' : student.demo === 'mohamed' ? 'full' : rng.weighted(PAY_PATTERNS);
        const target = {
          full: net,
          onTrack: owedNow,
          partial: Math.max(50_000, roundDown(owedNow * (0.3 + rng.next() * 0.5), 25_000)),
          none: 0,
        }[pattern];

        let left = target;
        let last = earliest;
        dues.forEach((due, i) => {
          const amount = Math.min(due, left);
          if (amount <= 0) return;
          left -= amount;
          const planned = addDays(dueDates[i], rng.int(-14, 10));
          let paidAt = planned < last ? last : planned;
          if (paidAt > today) paidAt = randomDay(minDate(last, today), today);
          last = paidAt;
          const method = rng.weighted(PAYMENT_METHODS);
          if (amount >= 200_000 && rng.chance(0.3)) {
            const half = roundDown(amount / 2, 25_000);
            pay(half, paidAt, method);
            const later = minDate(addDays(paidAt, rng.int(7, 30)), today);
            pay(amount - half, later, method);
            last = later;
          } else {
            pay(amount, paidAt, method);
          }
        });
      }
    }

    // Receipt numbers follow the payment dates.
    payments
      .map((p, i) => ({ p, i }))
      .sort((a, b) => a.p.paidAt.localeCompare(b.p.paidAt) || a.i - b.i)
      .forEach(({ p }, n) => {
        rows.payments.push({
          id: ids.next(),
          schoolId: school.id,
          studentFeeId: p.studentFeeId,
          amount: p.amount,
          paidAt: p.paidAt,
          method: p.method,
          receiptNo: String(1001 + n),
          note: p.method === 'bankak' ? `رقم العملية ${rng.int(100_000_000, 999_999_999)}` : null,
          recordedBy: world.adminId,
          createdAt: cal.at(p.paidAt, 11, rng.int(0, 240)),
        });
      });
  }
}

// ───────────────────────────── Announcements ─────────────────────────────

interface AnnouncementDef {
  title: string;
  body: string;
  audience: AudienceType;
  audienceId: string | null;
  publishedAt: Date;
}

function buildAnnouncements(ctx: DemoContext, world: World) {
  const { rows, ids, cal, dates, today, year } = ctx;
  const d = dates.recent;
  const meeting = cal.at(dates.meetingAnnouncedOn, 13);
  const exams = dates.upcomingMonthly.days[0];
  const dueDates = installmentDueDates(year.startYear);
  const nextDue = dueDates.findIndex((due) => due >= today);
  const feeReminder =
    nextDue >= 0
      ? `نذكر أولياء الأمور الكرام بأن موعد سداد ${INSTALLMENT_NAMES[nextDue]} من الرسوم الدراسية هو ${formatDate(dueDates[nextDue])}، ويمكن السداد نقداً بمكتب الحسابات أو عبر تطبيق بنكك.`
      : 'نرجو من أولياء الأمور الكرام سداد ما تبقى من الرسوم الدراسية في أقرب وقت.';
  const grade = (school: SchoolModel, name: string) => {
    const found = school.grades.find((g) => g.def.name === name);
    if (!found) throw new Error(`demo grade missing: ${name}`);
    return found.id;
  };
  const classOf = (school: SchoolModel, key: string) => {
    const found = school.classes.find((c) => c.key === key);
    if (!found) throw new Error(`demo class missing: ${key}`);
    return found.id;
  };
  const common = (): AnnouncementDef[] => [
    {
      title: 'غداً إجتماع أولياء الأمور',
      body: 'ندعوكم لحضور اجتماع أولياء الأمور غداً الساعة العاشرة صباحاً بقاعة المدرسة لمناقشة مستوى الطلاب ونتائج الامتحانات الشهرية.',
      audience: 'school',
      audienceId: null,
      publishedAt: meeting,
    },
    {
      title: 'جدول الامتحانات الشهرية',
      body: `تبدأ الامتحانات الشهرية يوم ${WEEKDAY_LABELS[weekdayOf(exams)]} ${formatDate(exams)}، ويمكنكم الاطلاع على الجدول في قسم الإمتحانات.`,
      audience: 'school',
      audienceId: null,
      publishedAt: cal.at(d[2], 12),
    },
    {
      title: 'تذكير بسداد الرسوم الدراسية',
      body: feeReminder,
      audience: 'school',
      audienceId: null,
      publishedAt: cal.at(d[8], 10),
    },
  ];
  const { middle, secondary } = world;
  const { musab, mohamed } = world.children;
  const perSchool: Array<[SchoolModel, AnnouncementDef[]]> = [
    [
      middle,
      [
        {
          title: 'استدعاء ولي أمر',
          body: 'الرجاء الحضور للمدرسة لمناقشة نتيجة الطالب مصعب إبراهيم',
          audience: 'student',
          audienceId: musab.id,
          publishedAt: cal.at(d[0], 10, 30),
        },
        {
          title: 'إلى طلاب الصف الخامس',
          body: 'على جميع طلاب الصف الخامس إحضار الأدوات الهندسية (المسطرة والفرجار والمنقلة) ابتداءً من الأسبوع القادم.',
          audience: 'grade_level',
          audienceId: grade(middle, 'الصف الخامس'),
          publishedAt: cal.at(d[3], 9),
        },
        {
          title: 'رحلة علمية',
          body: 'تنظم المدرسة رحلة علمية لطلاب الصف السادس - أ إلى متحف السودان القومي، الرجاء إرسال موافقة ولي الأمر مع الطالب.',
          audience: 'class_section',
          audienceId: classOf(middle, 'middle:الصف السادس:أ'),
          publishedAt: cal.at(d[4], 11),
        },
        {
          title: 'مسابقة القرآن الكريم',
          body: 'باب التسجيل مفتوح لمسابقة حفظ القرآن الكريم السنوية، سجّلوا أبناءكم لدى مشرف الصف قبل موعد المسابقة.',
          audience: 'school',
          audienceId: null,
          publishedAt: cal.at(d[9], 9, 30),
        },
        ...common(),
      ],
    ],
    [
      secondary,
      [
        {
          title: 'تهنئة',
          body: 'تهنئ إدارة المدرسة الطالب محمد إبراهيم على تفوقه في الامتحانات الشهرية، مع تمنياتنا له بدوام التوفيق.',
          audience: 'student',
          audienceId: mohamed.id,
          publishedAt: cal.at(d[3], 12),
        },
        {
          title: 'حصص التقوية',
          body: 'تبدأ حصص التقوية في الرياضيات والفيزياء لطلاب الصف الأول الثانوي يوم السبت من التاسعة صباحاً حتى الثانية عشرة ظهراً.',
          audience: 'grade_level',
          audienceId: grade(secondary, 'الصف الأول الثانوي'),
          publishedAt: cal.at(d[5], 10),
        },
        {
          title: 'زيارة جامعة الخرطوم',
          body: 'زيارة تعريفية لطلاب الصف الثاني الثانوي - أ إلى كليات جامعة الخرطوم، التجمع بالمدرسة الساعة الثامنة صباحاً.',
          audience: 'class_section',
          audienceId: classOf(secondary, 'secondary:الصف الثاني الثانوي:أ'),
          publishedAt: cal.at(d[6], 11),
        },
        ...common(),
      ],
    ],
  ];
  for (const [school, list] of perSchool) {
    for (const a of list) {
      rows.announcements.push({
        id: ids.next(),
        schoolId: school.id,
        title: a.title,
        body: a.body,
        audienceType: a.audience,
        audienceId: a.audienceId,
        createdBy: world.adminId,
        publishedAt: a.publishedAt,
        createdAt: a.publishedAt,
      });
    }
  }
}

// ───────────────────────────── Calendar ─────────────────────────────

interface CalendarDef {
  title: string;
  kind: CalendarKind;
  startsOn: string;
  endsOn?: string;
  details?: string;
  /** Default: planned two months ago (before every past event). */
  createdAt?: Date;
}

function buildCalendar(ctx: DemoContext, world: World) {
  const { rows, ids, cal, dates, today } = ctx;
  const planned = cal.at(addDays(today, -60), 10);
  const upcomingLast = dates.upcomingMonthly.days[dates.upcomingMonthly.days.length - 1];
  const last = <T>(list: readonly T[]) => list[list.length - 1];
  const examDays = new Set([...dates.lastMonthly.days, ...dates.upcomingMonthly.days]);
  /** The nearest school day without exams, looking back (-1) or ahead (+1). */
  const freeDay = (date: string, step: 1 | -1) => {
    let d = date;
    while (!cal.isSchoolDay(d) || examDays.has(d)) d = addDays(d, step);
    return d;
  };
  for (const school of world.schools) {
    const events: CalendarDef[] = [
      { title: 'عطلة منتصف الفترة', kind: 'holiday', startsOn: dates.pastBreak[0], endsOn: last(dates.pastBreak) },
      {
        title: dates.lastMonthly.name,
        kind: 'exam',
        startsOn: dates.lastMonthly.days[0],
        endsOn: last(dates.lastMonthly.days),
      },
      {
        title: 'حملة النظافة والتشجير',
        kind: 'event',
        startsOn: freeDay(addDays(today, -26), -1),
        details: 'يشارك فيها الطلاب في تنظيف الفصول وزراعة الأشجار بفناء المدرسة',
      },
      {
        title: 'يوم الصحة المدرسية',
        kind: 'event',
        startsOn: freeDay(addDays(today, -9), -1),
        details: 'فحص طبي مجاني للطلاب بالتعاون مع وزارة الصحة',
      },
      {
        title: 'اجتماع أولياء الأمور',
        kind: 'meeting',
        startsOn: dates.meetingOn,
        details: 'الساعة العاشرة صباحاً بقاعة المدرسة',
        createdAt: cal.at(dates.meetingAnnouncedOn, 12, 45),
      },
      {
        title: dates.upcomingMonthly.name,
        kind: 'exam',
        startsOn: dates.upcomingMonthly.days[0],
        endsOn: upcomingLast,
        createdAt: dates.upcomingMonthly.createdAt,
      },
      {
        title: school.key === 'middle' ? 'رحلة مدرسية إلى حديقة القرشي' : 'زيارة جامعة الخرطوم',
        kind: 'event',
        startsOn: freeDay(addDays(upcomingLast, 3), 1),
      },
      {
        title: 'مسابقة القرآن الكريم السنوية',
        kind: 'event',
        startsOn: freeDay(addDays(upcomingLast, 6), 1),
        details: 'تصفيات المسابقة بين الفصول في مسرح المدرسة',
      },
      {
        title: 'اليوم الرياضي المدرسي',
        kind: 'event',
        startsOn: freeDay(addDays(upcomingLast, 10), 1),
        details: 'منافسات في كرة القدم وألعاب القوى بين الفصول',
        createdAt: cal.at(dates.recent[0], 9, 15),
      },
      {
        title: 'حفل تكريم الطلاب المتفوقين',
        kind: 'event',
        startsOn: freeDay(addDays(today, 27), 1),
        details: 'تكريم أوائل الفصول في الامتحانات الشهرية بحضور أولياء الأمور',
      },
      {
        title: 'المعرض العلمي السنوي',
        kind: 'event',
        startsOn: freeDay(addDays(today, 34), 1),
        details: 'يعرض فيه الطلاب مشاريعهم العلمية، والدعوة عامة لأولياء الأمور',
      },
      {
        title: 'عطلة نهاية الفترة الدراسية',
        kind: 'holiday',
        startsOn: dates.futureBreak[0],
        endsOn: last(dates.futureBreak),
      },
    ];
    for (const e of events) {
      rows.calendarEvents.push({
        id: ids.next(),
        schoolId: school.id,
        title: e.title,
        kind: e.kind,
        startsOn: e.startsOn,
        endsOn: e.endsOn ?? e.startsOn,
        details: e.details ?? null,
        createdBy: world.adminId,
        createdAt: e.createdAt ?? planned,
      });
    }
  }
}

// ───────────────────────────── Badges ─────────────────────────────

/**
 * The demo guardian last opened every module (and every subject) at the start of the previous school
 * day, so the home badges count only what is genuinely recent.
 */
function buildReadCursors(ctx: DemoContext, world: World) {
  const { rows, dates } = ctx;
  for (const child of Object.values(world.children)) {
    for (const module of BADGE_MODULES) {
      rows.readCursors.push({
        userId: world.guardianId,
        studentId: child.id,
        module,
        scope: '',
        lastSeenAt: dates.cursorAt,
      });
    }
    for (const module of ['lessons', 'homework'] as const) {
      for (const subject of child.school.subjects) {
        rows.readCursors.push({
          userId: world.guardianId,
          studentId: child.id,
          module,
          scope: subject.id,
          lastSeenAt: dates.cursorAt,
        });
      }
    }
  }
}
