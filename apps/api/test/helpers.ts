/**
 * Test harness: an in-memory Postgres (PGlite) with migrations applied, the full Express app,
 * and a small two-school fixture. Every test file calls `setupTestApp()` once (beforeAll).
 */
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig, type Config } from '../src/config';
import { connectPglite, type Db } from '../src/db/client';
import { createApp } from '../src/app';
import * as s from '../src/db/schema';
import { hashSecret } from '../src/lib/security';

export const PIN = '1234';

export interface Fixture {
  schoolA: typeof s.schools.$inferSelect;
  schoolB: typeof s.schools.$inferSelect;
  yearA: typeof s.academicYears.$inferSelect;
  yearB: typeof s.academicYears.$inferSelect;
  stageA: typeof s.stages.$inferSelect;
  grade5: typeof s.gradeLevels.$inferSelect;
  grade6: typeof s.gradeLevels.$inferSelect;
  /** 5-أ */
  class5a: typeof s.classSections.$inferSelect;
  /** 5-ب */
  class5b: typeof s.classSections.$inferSelect;
  /** 6-أ */
  class6a: typeof s.classSections.$inferSelect;
  /** school B */
  classB: typeof s.classSections.$inferSelect;
  math: typeof s.subjects.$inferSelect;
  arabic: typeof s.subjects.$inferSelect;
  science: typeof s.subjects.$inferSelect;
  mathB: typeof s.subjects.$inferSelect;
  users: {
    admin: typeof s.users.$inferSelect;
    supervisor: typeof s.users.$inferSelect;
    /** teaches math in 5-أ and arabic in 5-ب */
    teacher: typeof s.users.$inferSelect;
    /** teaches arabic in 5-أ */
    teacher2: typeof s.users.$inferSelect;
    /** parent of s1 (5-أ, school A) and s4 (school B) */
    guardian: typeof s.users.$inferSelect;
    /** parent of s2 (5-أ) */
    guardian2: typeof s.users.$inferSelect;
    /** admin of school B only */
    adminB: typeof s.users.$inferSelect;
    /** pending (not activated) user */
    pending: typeof s.users.$inferSelect;
  };
  students: {
    /** 5-أ, guardian */
    s1: typeof s.students.$inferSelect;
    /** 5-أ, guardian2 */
    s2: typeof s.students.$inferSelect;
    /** 5-أ, no guardian */
    s3: typeof s.students.$inferSelect;
    /** school B, guardian */
    s4: typeof s.students.$inferSelect;
    /** 5-ب, no guardian */
    s5: typeof s.students.$inferSelect;
  };
}

export interface TestContext {
  app: Express;
  db: Db;
  config: Config;
  fx: Fixture;
  /** A supertest agent logged in (cookie) as the user with this phone. */
  loginAs(phone: string): Promise<ReturnType<typeof request.agent>>;
  /** Unauthenticated agent. */
  anon(): ReturnType<typeof request.agent>;
  close(): Promise<void>;
}

export async function createFixture(db: Db): Promise<Fixture> {
  const pinHash = await hashSecret(PIN);
  const one = async <T>(p: Promise<T[]>) => (await p)[0];

  const schoolA = await one(db.insert(s.schools).values({ name: 'مدرسة الاختبار أ', code: 'TEST_A' }).returning());
  const schoolB = await one(db.insert(s.schools).values({ name: 'مدرسة الاختبار ب', code: 'TEST_B' }).returning());
  const yearA = await one(
    db
      .insert(s.academicYears)
      .values({
        schoolId: schoolA.id,
        name: '2025/2026',
        startsOn: '2025-07-01',
        endsOn: '2026-06-30',
        isCurrent: true,
      })
      .returning(),
  );
  const yearB = await one(
    db
      .insert(s.academicYears)
      .values({
        schoolId: schoolB.id,
        name: '2025/2026',
        startsOn: '2025-07-01',
        endsOn: '2026-06-30',
        isCurrent: true,
      })
      .returning(),
  );
  const stageA = await one(db.insert(s.stages).values({ schoolId: schoolA.id, name: 'المتوسطة', sort: 1 }).returning());
  const stageB = await one(db.insert(s.stages).values({ schoolId: schoolB.id, name: 'الثانوية', sort: 1 }).returning());
  const grade5 = await one(
    db
      .insert(s.gradeLevels)
      .values({ schoolId: schoolA.id, stageId: stageA.id, name: 'الصف الخامس', sort: 5 })
      .returning(),
  );
  const grade6 = await one(
    db
      .insert(s.gradeLevels)
      .values({ schoolId: schoolA.id, stageId: stageA.id, name: 'الصف السادس', sort: 6 })
      .returning(),
  );
  const gradeB = await one(
    db
      .insert(s.gradeLevels)
      .values({ schoolId: schoolB.id, stageId: stageB.id, name: 'الصف الأول', sort: 1 })
      .returning(),
  );
  const cls = (schoolId: string, academicYearId: string, gradeLevelId: string, name: string) =>
    one(db.insert(s.classSections).values({ schoolId, academicYearId, gradeLevelId, name }).returning());
  const class5a = await cls(schoolA.id, yearA.id, grade5.id, 'أ');
  const class5b = await cls(schoolA.id, yearA.id, grade5.id, 'ب');
  const class6a = await cls(schoolA.id, yearA.id, grade6.id, 'أ');
  const classB = await cls(schoolB.id, yearB.id, gradeB.id, 'أ');

  const subj = (schoolId: string, name: string, sort: number) =>
    one(db.insert(s.subjects).values({ schoolId, name, sort }).returning());
  const math = await subj(schoolA.id, 'الرياضيات', 1);
  const arabic = await subj(schoolA.id, 'اللغة العربية', 2);
  const science = await subj(schoolA.id, 'العلوم', 3);
  const mathB = await subj(schoolB.id, 'الرياضيات', 1);

  const user = (phone: string, fullName: string, active = true) =>
    one(
      db
        .insert(s.users)
        .values({ phone, fullName, pinHash: active ? pinHash : null, status: active ? 'active' : 'pending' })
        .returning(),
    );
  const users = {
    admin: await user('0900000101', 'مدير أ'),
    supervisor: await user('0900000102', 'مشرف أ'),
    teacher: await user('0900000103', 'أستاذ أ'),
    teacher2: await user('0900000104', 'أستاذ ثاني'),
    guardian: await user('0900000105', 'ولي أمر'),
    guardian2: await user('0900000106', 'ولي أمر ثاني'),
    adminB: await user('0900000107', 'مدير ب'),
    pending: await user('0900000108', 'غير مفعل', false),
  };
  await db.insert(s.memberships).values([
    { userId: users.admin.id, schoolId: schoolA.id, role: 'admin' },
    { userId: users.supervisor.id, schoolId: schoolA.id, role: 'supervisor' },
    { userId: users.teacher.id, schoolId: schoolA.id, role: 'teacher' },
    { userId: users.teacher2.id, schoolId: schoolA.id, role: 'teacher' },
    { userId: users.guardian.id, schoolId: schoolA.id, role: 'guardian' },
    { userId: users.guardian.id, schoolId: schoolB.id, role: 'guardian' },
    { userId: users.guardian2.id, schoolId: schoolA.id, role: 'guardian' },
    { userId: users.adminB.id, schoolId: schoolB.id, role: 'admin' },
  ]);
  await db.insert(s.teachingAssignments).values([
    { schoolId: schoolA.id, classSectionId: class5a.id, subjectId: math.id, teacherId: users.teacher.id },
    { schoolId: schoolA.id, classSectionId: class5b.id, subjectId: arabic.id, teacherId: users.teacher.id },
    { schoolId: schoolA.id, classSectionId: class5a.id, subjectId: arabic.id, teacherId: users.teacher2.id },
  ]);

  const student = (
    schoolId: string,
    classSectionId: string,
    gradeLevelId: string,
    code: string,
    firstName: string,
    gender: 'male' | 'female' = 'male',
  ) =>
    one(
      db
        .insert(s.students)
        .values({
          schoolId,
          classSectionId,
          gradeLevelId,
          code,
          firstName,
          fatherName: 'إبراهيم',
          grandfatherName: 'عبدالله',
          gender,
          registeredAt: '2025-07-01',
        })
        .returning(),
    );
  const students = {
    s1: await student(schoolA.id, class5a.id, grade5.id, 'S-1', 'مصعب'),
    s2: await student(schoolA.id, class5a.id, grade5.id, 'S-2', 'أحمد'),
    s3: await student(schoolA.id, class5a.id, grade5.id, 'S-3', 'سارة', 'female'),
    s4: await student(schoolB.id, classB.id, gradeB.id, 'S-1', 'محمد'),
    s5: await student(schoolA.id, class5b.id, grade5.id, 'S-4', 'عمر'),
  };
  await db.insert(s.studentGuardians).values([
    { schoolId: schoolA.id, studentId: students.s1.id, userId: users.guardian.id, relation: 'father', isPrimary: true },
    { schoolId: schoolB.id, studentId: students.s4.id, userId: users.guardian.id, relation: 'father', isPrimary: true },
    {
      schoolId: schoolA.id,
      studentId: students.s2.id,
      userId: users.guardian2.id,
      relation: 'mother',
      isPrimary: true,
    },
  ]);

  return {
    schoolA,
    schoolB,
    yearA,
    yearB,
    stageA,
    grade5,
    grade6,
    class5a,
    class5b,
    class6a,
    classB,
    math,
    arabic,
    science,
    mathB,
    users,
    students,
  };
}

export async function setupTestApp(): Promise<TestContext> {
  const handle = await connectPglite(null);
  await handle.migrate();
  const config: Config = { ...loadConfig({ NODE_ENV: 'test' }), webDistDir: '/nonexistent', demoMode: false };
  const app = createApp({ db: handle.db, config });
  const fx = await createFixture(handle.db);
  return {
    app,
    db: handle.db,
    config,
    fx,
    async loginAs(phone: string) {
      const agent = request.agent(app);
      const res = await agent.post('/api/auth/login').send({ phone, pin: PIN });
      if (res.status !== 200) throw new Error(`login failed for ${phone}: ${res.status} ${JSON.stringify(res.body)}`);
      return agent;
    },
    anon: () => request.agent(app),
    close: () => handle.close(),
  };
}
