import { eq } from 'drizzle-orm';
import { todayIn } from '@slash/shared';
import type { Db } from '../db/client';
import * as s from '../db/schema';
import { hashCode, hashSecret } from '../lib/security';
import { DEMO_ACCOUNTS, DEMO_ACTIVATION, DEMO_LINK_CODE, DEMO_PIN, DEMO_SCHOOLS } from './demo-accounts';

/**
 * Seeds the demo dataset: the two schools from the sketch, their structure and staff, the demo
 * guardian with three children, and the activation / link codes shown on the login page.
 * `today` is the school-local date the data is centred on.
 */
export async function seedDemo(db: Db, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? todayIn('Africa/Khartoum');
  const year = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= 7 ? year : year - 1;
  const pinHash = await hashSecret(DEMO_PIN);
  const one = async <T>(p: Promise<T[]>) => (await p)[0];

  const user = (phone: string, fullName: string, active = true) =>
    one(
      db
        .insert(s.users)
        .values({ phone, fullName, pinHash: active ? pinHash : null, status: active ? 'active' : 'pending' })
        .returning(),
    );
  const account = (role: string) => DEMO_ACCOUNTS.find((a) => a.role === role)!;
  const admin = await user(account('admin').phone, account('admin').fullName);
  const supervisor = await user(account('supervisor').phone, account('supervisor').fullName);
  const teacher = await user(account('teacher').phone, account('teacher').fullName);
  const guardian = await user(account('guardian').phone, account('guardian').fullName);

  const schoolDefs = [
    {
      def: DEMO_SCHOOLS.middle,
      stage: 'المرحلة المتوسطة',
      grades: [
        ['الصف الخامس', ['أ', 'ب']],
        ['الصف السادس', ['أ']],
      ] as const,
    },
    { def: DEMO_SCHOOLS.secondary, stage: 'المرحلة الثانوية', grades: [['الصف الأول الثانوي', ['أ']]] as const },
  ];
  const subjectNames = ['الرياضيات', 'اللغة العربية', 'اللغة الإنجليزية', 'العلوم', 'القرآن الكريم'];
  const classes: Record<string, { schoolId: string; classId: string; gradeId: string }> = {};

  for (const { def, stage, grades } of schoolDefs) {
    const school = await one(
      db
        .insert(s.schools)
        .values({ name: def.name, code: def.code, phone: '0183000000', address: 'كرري، أم درمان' })
        .returning(),
    );
    await db.insert(s.memberships).values([
      { userId: admin.id, schoolId: school.id, role: 'admin' },
      { userId: supervisor.id, schoolId: school.id, role: 'supervisor' },
      { userId: guardian.id, schoolId: school.id, role: 'guardian' },
    ]);
    const ay = await one(
      db
        .insert(s.academicYears)
        .values({
          schoolId: school.id,
          name: `${startYear}/${startYear + 1}`,
          startsOn: `${startYear}-07-01`,
          endsOn: `${startYear + 1}-06-30`,
          isCurrent: true,
        })
        .returning(),
    );
    const st = await one(db.insert(s.stages).values({ schoolId: school.id, name: stage, sort: 1 }).returning());
    const subjects = await db
      .insert(s.subjects)
      .values(subjectNames.map((name, i) => ({ schoolId: school.id, name, sort: i + 1 })))
      .returning();
    let sort = 1;
    for (const [gradeName, sections] of grades) {
      const grade = await one(
        db
          .insert(s.gradeLevels)
          .values({ schoolId: school.id, stageId: st.id, name: gradeName, sort: sort++ })
          .returning(),
      );
      for (const section of sections) {
        const cls = await one(
          db
            .insert(s.classSections)
            .values({ schoolId: school.id, academicYearId: ay.id, gradeLevelId: grade.id, name: section })
            .returning(),
        );
        classes[`${def.code}:${gradeName}:${section}`] = { schoolId: school.id, classId: cls.id, gradeId: grade.id };
        if (def.code === DEMO_SCHOOLS.middle.code) {
          await db.insert(s.teachingAssignments).values(
            subjects.map((subj) => ({
              schoolId: school.id,
              classSectionId: cls.id,
              subjectId: subj.id,
              teacherId: subj.name === 'الرياضيات' ? teacher.id : supervisor.id,
            })),
          );
        }
      }
    }
    if (def.code === DEMO_SCHOOLS.middle.code) {
      await db.insert(s.memberships).values({ userId: teacher.id, schoolId: school.id, role: 'teacher' });
    }
  }

  const firstNames = ['أحمد', 'سارة', 'محمد', 'فاطمة', 'عمر', 'مريم', 'يوسف', 'آمنة', 'خالد', 'هبة', 'عثمان', 'رنا'];
  const students: Array<{ id: string; schoolId: string; firstName: string }> = [];
  const counters: Record<string, number> = {};
  const addStudent = async (
    key: string,
    firstName: string,
    father: string,
    grandfather: string,
    gender: 'male' | 'female',
  ) => {
    const c = classes[key];
    counters[c.schoolId] = (counters[c.schoolId] ?? 0) + 1;
    const row = await one(
      db
        .insert(s.students)
        .values({
          schoolId: c.schoolId,
          code: `S-${counters[c.schoolId]}`,
          firstName,
          fatherName: father,
          grandfatherName: grandfather,
          gender,
          gradeLevelId: c.gradeId,
          classSectionId: c.classId,
          registeredAt: `${startYear}-07-0${(counters[c.schoolId] % 9) + 1}`,
        })
        .returning(),
    );
    students.push({ id: row.id, schoolId: row.schoolId, firstName });
    return row;
  };

  const m = DEMO_SCHOOLS.middle.code;
  const sec = DEMO_SCHOOLS.secondary.code;
  const linkedAt = new Date(Date.now() - 21 * 86_400_000);
  const children = [
    await addStudent(`${m}:الصف الخامس:ب`, 'مصعب', 'إبراهيم', 'عبدالله', 'male'),
    await addStudent(`${m}:الصف السادس:أ`, 'إسماعيل', 'إبراهيم', 'عبدالله', 'male'),
    await addStudent(`${sec}:الصف الأول الثانوي:أ`, 'محمد', 'إبراهيم', 'عبدالله', 'male'),
  ];
  await db.insert(s.studentGuardians).values(
    children.map((c) => ({
      schoolId: c.schoolId,
      studentId: c.id,
      userId: guardian.id,
      relation: 'father' as const,
      isPrimary: true,
      occupation: 'موظف',
      workplace: 'الخرطوم',
      locality: 'كرري',
      residence: 'الحتانة',
      whatsapp: guardian.phone,
      createdAt: linkedAt,
    })),
  );

  // Classmates with (mostly pending) guardians.
  let phoneSeq = 100;
  for (const key of Object.keys(classes)) {
    for (let i = 0; i < 8; i++) {
      const gender = i % 5 < 3 ? 'female' : 'male';
      const first = firstNames[(i * 7 + key.length) % firstNames.length];
      const student = await addStudent(key, first, 'عوض', 'محمد', gender);
      const g = await user(
        `09110${String(phoneSeq++).padStart(5, '0')}`,
        `عوض محمد ${first === 'أحمد' ? 'علي' : 'أحمد'}`,
        false,
      );
      await db.insert(s.memberships).values({ userId: g.id, schoolId: student.schoolId, role: 'guardian' });
      await db
        .insert(s.studentGuardians)
        .values({
          schoolId: student.schoolId,
          studentId: student.id,
          userId: g.id,
          relation: 'father',
          isPrimary: true,
        });
    }
  }

  // Pending guardian for the activation flow.
  const pending = await user(DEMO_ACTIVATION.phone, DEMO_ACTIVATION.fullName, false);
  const pendingChild = students.find(
    (x) => x.schoolId === classes[`${m}:الصف الخامس:أ`].schoolId && x.firstName !== 'مصعب',
  )!;
  await db.insert(s.memberships).values({ userId: pending.id, schoolId: pendingChild.schoolId, role: 'guardian' });
  await db
    .insert(s.studentGuardians)
    .values({ schoolId: pendingChild.schoolId, studentId: pendingChild.id, userId: pending.id, relation: 'father' });
  await db.insert(s.activationCodes).values({
    userId: pending.id,
    codeHash: hashCode(DEMO_ACTIVATION.code),
    expiresAt: new Date(Date.now() + 3650 * 86_400_000),
  });

  // A secondary-school student the demo guardian can link with "+".
  const linkable = students.find(
    (x) => x.schoolId === classes[`${sec}:الصف الأول الثانوي:أ`].schoolId && x.firstName !== 'محمد',
  )!;
  await db
    .update(s.students)
    .set({ linkCodeHash: hashCode(DEMO_LINK_CODE) })
    .where(eq(s.students.id, linkable.id));
}
