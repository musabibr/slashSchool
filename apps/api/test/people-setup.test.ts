import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_GRADE_BANDS, todayIn } from '@slash/shared';
import * as s from '../src/db/schema';
import { hashSecret } from '../src/lib/security';
import { PIN, setupTestApp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.close());

const base = () => `/api/schools/${t.fx.schoolA.id}`;
const one = async <T>(p: Promise<T[]>) => (await p)[0];

/** An active staff user (PIN = fixture PIN) with the given roles in school A. */
async function addStaffUser(phone: string, fullName: string, roles: Array<'teacher' | 'supervisor' | 'admin'>) {
  const user = await one(
    t.db
      .insert(s.users)
      .values({ phone, fullName, pinHash: await hashSecret(PIN), status: 'active' })
      .returning(),
  );
  await t.db.insert(s.memberships).values(roles.map((role) => ({ userId: user.id, schoolId: t.fx.schoolA.id, role })));
  return user;
}

// Runs first: the counts below assume the untouched fixture (plus the rows inserted here).
describe('dashboard (D1)', () => {
  it('computes counters, gender split, stages, today, events, announcements and fees', async () => {
    const { fx } = t;
    const today = todayIn('Africa/Khartoum');
    const day = (offset: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };

    // A withdrawn student is left out of every counter.
    const gone = await one(
      t.db
        .insert(s.students)
        .values({
          schoolId: fx.schoolA.id,
          classSectionId: fx.class6a.id,
          gradeLevelId: fx.grade6.id,
          code: 'S-90',
          firstName: 'منسحب',
          fatherName: 'أ',
          grandfatherName: 'ب',
          gender: 'female',
          status: 'withdrawn',
          registeredAt: '2025-07-01',
        })
        .returning(),
    );

    // Today: 5-أ recorded with one absence; 5-ب and 6-أ not recorded.
    const session = await one(
      t.db
        .insert(s.attendanceSessions)
        .values({ schoolId: fx.schoolA.id, classSectionId: fx.class5a.id, date: today, recordedBy: fx.users.supervisor.id })
        .returning(),
    );
    await t.db.insert(s.absences).values({ sessionId: session.id, studentId: fx.students.s3.id });

    // Events: one already over, six upcoming (only the next five are returned), one in school B.
    await t.db.insert(s.calendarEvents).values([
      { schoolId: fx.schoolA.id, title: 'انتهى', kind: 'event', startsOn: day(-10), endsOn: day(-9) },
      { schoolId: fx.schoolA.id, title: 'جارٍ', kind: 'holiday', startsOn: day(-1), endsOn: day(1) },
      ...[3, 2, 5, 4, 6].map((n) => ({
        schoolId: fx.schoolA.id,
        title: `حدث ${n}`,
        kind: 'event' as const,
        startsOn: day(n),
        endsOn: day(n),
      })),
      { schoolId: fx.schoolB.id, title: 'مدرسة ب', kind: 'event', startsOn: day(1), endsOn: day(1) },
    ]);

    // Announcements: the latest three published ones; a scheduled one and school B's are excluded.
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await t.db.insert(s.announcements).values([
      { schoolId: fx.schoolA.id, title: 'إعلان 1', body: '.', audienceType: 'school', publishedAt: at(40) },
      { schoolId: fx.schoolA.id, title: 'إعلان 2', body: '.', audienceType: 'school', publishedAt: at(30) },
      { schoolId: fx.schoolA.id, title: 'إعلان 3', body: '.', audienceType: 'school', publishedAt: at(20) },
      { schoolId: fx.schoolA.id, title: 'إعلان 4', body: '.', audienceType: 'school', publishedAt: at(10) },
      { schoolId: fx.schoolA.id, title: 'مجدول', body: '.', audienceType: 'school', publishedAt: at(-60) },
      { schoolId: fx.schoolB.id, title: 'مدرسة ب', body: '.', audienceType: 'school', publishedAt: at(1) },
    ]);

    // Fees: a 300,000 plan (100,000 overdue + 200,000 not yet due).
    const plan = await one(
      t.db.insert(s.feePlans).values({ schoolId: fx.schoolA.id, academicYearId: fx.yearA.id, name: 'رسوم' }).returning(),
    );
    await t.db.insert(s.planInstallments).values([
      { feePlanId: plan.id, seq: 1, amount: 100_000, dueDate: '2025-08-01' },
      { feePlanId: plan.id, seq: 2, amount: 200_000, dueDate: '2099-01-01' },
    ]);
    const [fee1, , feeGone] = await t.db
      .insert(s.studentFees)
      .values([
        { schoolId: fx.schoolA.id, studentId: fx.students.s1.id, feePlanId: plan.id },
        { schoolId: fx.schoolA.id, studentId: fx.students.s2.id, feePlanId: plan.id, discount: 100_000 },
        { schoolId: fx.schoolA.id, studentId: gone.id, feePlanId: plan.id },
      ])
      .returning();
    await t.db.insert(s.payments).values([
      { schoolId: fx.schoolA.id, studentFeeId: fee1.id, amount: 50_000, paidAt: '2025-08-02', method: 'cash' },
      { schoolId: fx.schoolA.id, studentFeeId: feeGone.id, amount: 300_000, paidAt: '2025-08-02', method: 'cash' },
    ]);

    const agent = await t.loginAs(fx.users.admin.phone);
    const res = await agent.get(`${base()}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ students: 4, supervisors: 1, teachers: 2, guardians: 2 });
    expect(res.body.gender).toEqual({ male: 3, female: 1 });
    expect(res.body.byStage).toEqual([{ stageName: 'المتوسطة', count: 4 }]);
    expect(res.body.today).toEqual({ date: today, classes: 3, recorded: 1, absent: 1 });
    expect(res.body.upcomingEvents.map((e: { title: string }) => e.title)).toEqual([
      'جارٍ',
      'حدث 2',
      'حدث 3',
      'حدث 4',
      'حدث 5',
    ]);
    expect(res.body.upcomingEvents[0]).toMatchObject({ kind: 'holiday', startsOn: day(-1), endsOn: day(1) });
    expect(res.body.recentAnnouncements.map((a: { title: string }) => a.title)).toEqual([
      'إعلان 4',
      'إعلان 3',
      'إعلان 2',
    ]);
    expect(typeof res.body.recentAnnouncements[0].publishedAt).toBe('string');
    // s1: net 300,000, paid 50,000, overdue 50,000. s2: net 200,000 (discount on the last installment),
    // nothing paid, overdue 100,000. The withdrawn student is not counted.
    expect(res.body.fees).toEqual({ expected: 500_000, collected: 50_000, overdue: 150_000 });
  });

  it('is scoped to the school and limited to admins', async () => {
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`${base()}/dashboard`)).status).toBe(403);
    const own = await adminB.get(`/api/schools/${t.fx.schoolB.id}/dashboard`);
    expect(own.status).toBe(200);
    expect(own.body.counts).toEqual({ students: 1, supervisors: 0, teachers: 0, guardians: 1 });
    expect(own.body.upcomingEvents.map((e: { title: string }) => e.title)).toEqual(['مدرسة ب']);
    expect(own.body.fees).toEqual({ expected: 0, collected: 0, overdue: 0 });

    for (const phone of [t.fx.users.supervisor.phone, t.fx.users.teacher.phone, t.fx.users.guardian.phone]) {
      const agent = await t.loginAs(phone);
      expect((await agent.get(`${base()}/dashboard`)).status).toBe(403);
    }
    expect((await t.anon().get(`${base()}/dashboard`)).status).toBe(401);
  });
});

describe('school structure', () => {
  it('returns years, the stage → grade → section tree, subjects and assignments', async () => {
    const { fx } = t;
    const agent = await t.loginAs(fx.users.admin.phone);
    const res = await agent.get(`${base()}/setup/structure`);
    expect(res.status).toBe(200);
    expect(res.body.currentAcademicYearId).toBe(fx.yearA.id);
    expect(res.body.academicYears).toEqual([
      { id: fx.yearA.id, name: '2025/2026', startsOn: '2025-07-01', endsOn: '2026-06-30', isCurrent: true },
    ]);
    expect(res.body.stages).toHaveLength(1);
    const [stage] = res.body.stages;
    expect(stage).toMatchObject({ id: fx.stageA.id, name: 'المتوسطة', sort: 1 });
    expect(stage.gradeLevels.map((g: { name: string }) => g.name)).toEqual(['الصف الخامس', 'الصف السادس']);
    expect(stage.gradeLevels[0].classSections).toEqual([
      { id: fx.class5a.id, name: 'أ', academicYearId: fx.yearA.id, studentCount: 3 },
      { id: fx.class5b.id, name: 'ب', academicYearId: fx.yearA.id, studentCount: 1 },
    ]);
    // The withdrawn student inserted above is not counted.
    expect(stage.gradeLevels[1].classSections).toEqual([
      { id: fx.class6a.id, name: 'أ', academicYearId: fx.yearA.id, studentCount: 0 },
    ]);
    expect(res.body.subjects.map((x: { name: string }) => x.name)).toEqual(['الرياضيات', 'اللغة العربية', 'العلوم']);
    expect(res.body.assignments).toHaveLength(3);
    expect(res.body.assignments).toContainEqual(
      expect.objectContaining({
        classSectionId: fx.class5a.id,
        subjectId: fx.math.id,
        teacherId: fx.users.teacher.id,
        teacherName: 'أستاذ أ',
      }),
    );
    // Nothing from school B leaks in.
    expect(JSON.stringify(res.body)).not.toContain(fx.classB.id);
  });

  it('is admin-only and tenant-isolated', async () => {
    for (const phone of [t.fx.users.supervisor.phone, t.fx.users.teacher.phone, t.fx.users.guardian.phone]) {
      const agent = await t.loginAs(phone);
      expect((await agent.get(`${base()}/setup/structure`)).status).toBe(403);
      expect((await agent.post(`${base()}/setup/subjects`).send({ name: 'مادة' })).status).toBe(403);
    }
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`${base()}/setup/structure`)).status).toBe(403);
    // School A ids through school B's own routes are not found.
    const b = `/api/schools/${t.fx.schoolB.id}/setup`;
    expect((await adminB.patch(`${b}/stages/${t.fx.stageA.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await adminB.delete(`${b}/subjects/${t.fx.math.id}`)).status).toBe(404);
    expect((await adminB.delete(`${b}/class-sections/${t.fx.class6a.id}`)).status).toBe(404);
    expect((await adminB.patch(`${b}/academic-years/${t.fx.yearA.id}`).send({ name: 'x' })).status).toBe(404);
    expect(
      (await adminB.post(`${b}/grade-levels`).send({ stageId: t.fx.stageA.id, name: 'الصف التاسع' })).status,
    ).toBe(404);
    expect((await adminB.post(`${b}/class-sections`).send({ gradeLevelId: t.fx.grade5.id, name: 'ج' })).status).toBe(
      404,
    );
  });

  describe('academic years', () => {
    it('validates dates and names', async () => {
      const agent = await t.loginAs(t.fx.users.admin.phone);
      const bad = await agent
        .post(`${base()}/setup/academic-years`)
        .send({ name: '2026/2027', startsOn: '2027-06-30', endsOn: '2026-07-01' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details).toContainEqual(expect.objectContaining({ path: 'endsOn' }));
      const badDate = await agent
        .post(`${base()}/setup/academic-years`)
        .send({ name: '2026/2027', startsOn: '2026-13-01', endsOn: '2027-06-30' });
      expect(badDate.status).toBe(400);
      const noName = await agent
        .post(`${base()}/setup/academic-years`)
        .send({ name: '  ', startsOn: '2026-07-01', endsOn: '2027-06-30' });
      expect(noName.status).toBe(400);
      const dup = await agent
        .post(`${base()}/setup/academic-years`)
        .send({ name: '2025/2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
      expect(dup.status).toBe(409);
    });

    it('creates, switches the current year, edits and deletes', async () => {
      const { fx } = t;
      const agent = await t.loginAs(fx.users.admin.phone);
      const created = await agent
        .post(`${base()}/setup/academic-years`)
        .send({ name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: '2026/2027', isCurrent: false });
      const id = created.body.id as string;

      // Setting it current clears the others.
      const current = await agent.patch(`${base()}/setup/academic-years/${id}`).send({ isCurrent: true });
      expect(current.status).toBe(200);
      expect(current.body.isCurrent).toBe(true);
      const years = await t.db.select().from(s.academicYears).where(eq(s.academicYears.schoolId, fx.schoolA.id));
      expect(years.filter((y) => y.isCurrent).map((y) => y.id)).toEqual([id]);
      // School B is untouched.
      const [yb] = await t.db.select().from(s.academicYears).where(eq(s.academicYears.id, fx.yearB.id));
      expect(yb.isCurrent).toBe(true);

      // The current year cannot simply be unset.
      expect((await agent.patch(`${base()}/setup/academic-years/${id}`).send({ isCurrent: false })).status).toBe(400);
      // Date order is checked against the stored dates too.
      const order = await agent.patch(`${base()}/setup/academic-years/${id}`).send({ endsOn: '2026-01-01' });
      expect(order.status).toBe(400);
      expect((await agent.patch(`${base()}/setup/academic-years/${id}`).send({})).status).toBe(400);

      // Back to the fixture year; then the empty year can go.
      expect((await agent.patch(`${base()}/setup/academic-years/${fx.yearA.id}`).send({ isCurrent: true })).status).toBe(
        200,
      );
      const renamed = await agent.patch(`${base()}/setup/academic-years/${id}`).send({ name: '2026-2027' });
      expect(renamed.body).toMatchObject({ name: '2026-2027', isCurrent: false });
      expect((await agent.delete(`${base()}/setup/academic-years/${id}`)).body).toEqual({ ok: true });
      expect((await agent.delete(`${base()}/setup/academic-years/${id}`)).status).toBe(404);
    });

    it('refuses to delete a year that has classes', async () => {
      const agent = await t.loginAs(t.fx.users.admin.phone);
      const res = await agent.delete(`${base()}/setup/academic-years/${t.fx.yearA.id}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('in_use');
    });
  });

  describe('stages, grade levels and class sections', () => {
    it('builds a branch of the tree and removes it again', async () => {
      const { fx } = t;
      const agent = await t.loginAs(fx.users.admin.phone);
      const stage = await agent.post(`${base()}/setup/stages`).send({ name: 'الثانوية' });
      expect(stage.status).toBe(201);
      expect(stage.body).toMatchObject({ name: 'الثانوية', sort: 2 });
      expect((await agent.post(`${base()}/setup/stages`).send({ name: 'الثانوية' })).status).toBe(409);
      expect((await agent.post(`${base()}/setup/stages`).send({ name: '' })).status).toBe(400);
      expect((await agent.post(`${base()}/setup/stages`).send({ name: 'س', sort: -1 })).status).toBe(400);

      const grade = await agent.post(`${base()}/setup/grade-levels`).send({ stageId: stage.body.id, name: 'الصف الأول' });
      expect(grade.status).toBe(201);
      expect(grade.body).toMatchObject({ stageId: stage.body.id, name: 'الصف الأول', sort: 1 });
      expect(
        (await agent.post(`${base()}/setup/grade-levels`).send({ stageId: stage.body.id, name: 'الصف الأول' })).status,
      ).toBe(409);
      expect((await agent.post(`${base()}/setup/grade-levels`).send({ stageId: 'nope', name: 'x' })).status).toBe(400);

      // Section defaults to the current year.
      const section = await agent.post(`${base()}/setup/class-sections`).send({ gradeLevelId: grade.body.id, name: 'أ' });
      expect(section.status).toBe(201);
      expect(section.body).toMatchObject({ name: 'أ', academicYearId: fx.yearA.id, studentCount: 0 });
      expect(
        (await agent.post(`${base()}/setup/class-sections`).send({ gradeLevelId: grade.body.id, name: 'أ' })).status,
      ).toBe(409);
      expect(
        (
          await agent
            .post(`${base()}/setup/class-sections`)
            .send({ gradeLevelId: grade.body.id, name: 'ب', academicYearId: fx.yearB.id })
        ).status,
      ).toBe(404);
      const renamed = await agent.patch(`${base()}/setup/class-sections/${section.body.id}`).send({ name: 'ج' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('ج');

      // The new class appears in the staff pickers.
      const scope = await agent.get(`${base()}/lookups/scope`);
      expect(scope.body.classes.map((c: { label: string }) => c.label)).toContain('الصف الأول - ج');

      // In-use parents cannot be deleted; children first.
      const blocked = await agent.delete(`${base()}/setup/stages/${stage.body.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('in_use');
      expect((await agent.delete(`${base()}/setup/grade-levels/${grade.body.id}`)).status).toBe(409);
      expect((await agent.delete(`${base()}/setup/class-sections/${section.body.id}`)).body).toEqual({ ok: true });
      expect((await agent.delete(`${base()}/setup/grade-levels/${grade.body.id}`)).body).toEqual({ ok: true });
      expect((await agent.delete(`${base()}/setup/stages/${stage.body.id}`)).body).toEqual({ ok: true });
    });

    it('renames and moves grade levels', async () => {
      const agent = await t.loginAs(t.fx.users.admin.phone);
      const res = await agent.patch(`${base()}/setup/grade-levels/${t.fx.grade6.id}`).send({ name: 'السادس', sort: 7 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'السادس', sort: 7, stageId: t.fx.stageA.id });
      expect(
        (await agent.patch(`${base()}/setup/grade-levels/${t.fx.grade6.id}`).send({ name: 'الصف الخامس' })).status,
      ).toBe(409);
      await agent.patch(`${base()}/setup/grade-levels/${t.fx.grade6.id}`).send({ name: 'الصف السادس', sort: 6 });
      const stage = await agent.patch(`${base()}/setup/stages/${t.fx.stageA.id}`).send({ name: 'المرحلة المتوسطة' });
      expect(stage.body.name).toBe('المرحلة المتوسطة');
      await agent.patch(`${base()}/setup/stages/${t.fx.stageA.id}`).send({ name: 'المتوسطة' });
    });

    it('refuses to delete classes and grade levels that hold students', async () => {
      const agent = await t.loginAs(t.fx.users.admin.phone);
      expect((await agent.delete(`${base()}/setup/class-sections/${t.fx.class5a.id}`)).status).toBe(409);
      expect((await agent.delete(`${base()}/setup/grade-levels/${t.fx.grade5.id}`)).status).toBe(409);
      expect((await agent.delete(`${base()}/setup/stages/${t.fx.stageA.id}`)).status).toBe(409);
      const [still] = await t.db.select().from(s.classSections).where(eq(s.classSections.id, t.fx.class5a.id));
      expect(still).toBeTruthy();
    });

    it('refuses to delete a class that has lessons even without students', async () => {
      const { fx } = t;
      const agent = await t.loginAs(fx.users.admin.phone);
      const section = await agent.post(`${base()}/setup/class-sections`).send({ gradeLevelId: fx.grade6.id, name: 'د' });
      await t.db.insert(s.lessons).values({
        schoolId: fx.schoolA.id,
        classSectionId: section.body.id,
        subjectId: fx.math.id,
        date: '2025-09-01',
        title: 'درس',
      });
      expect((await agent.delete(`${base()}/setup/class-sections/${section.body.id}`)).status).toBe(409);
    });
  });

  describe('subjects', () => {
    it('creates, renames and deletes; names are unique per school', async () => {
      const agent = await t.loginAs(t.fx.users.admin.phone);
      const created = await agent.post(`${base()}/setup/subjects`).send({ name: 'التربية الإسلامية' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: 'التربية الإسلامية', sort: 4 });
      expect((await agent.post(`${base()}/setup/subjects`).send({ name: 'الرياضيات' })).status).toBe(409);
      expect((await agent.post(`${base()}/setup/subjects`).send({})).status).toBe(400);
      // Another school may use the same name.
      const adminB = await t.loginAs(t.fx.users.adminB.phone);
      expect(
        (await adminB.post(`/api/schools/${t.fx.schoolB.id}/setup/subjects`).send({ name: 'التربية الإسلامية' })).status,
      ).toBe(201);

      const renamed = await agent
        .patch(`${base()}/setup/subjects/${created.body.id}`)
        .send({ name: 'القرآن الكريم', sort: 9 });
      expect(renamed.body).toMatchObject({ name: 'القرآن الكريم', sort: 9 });
      expect((await agent.patch(`${base()}/setup/subjects/${created.body.id}`).send({ name: 'العلوم' })).status).toBe(409);
      expect((await agent.delete(`${base()}/setup/subjects/${created.body.id}`)).body).toEqual({ ok: true });
    });

    it('refuses to delete a subject with lessons', async () => {
      const agent = await t.loginAs(t.fx.users.admin.phone);
      // The math lesson inserted for class د above.
      const res = await agent.delete(`${base()}/setup/subjects/${t.fx.math.id}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('in_use');
    });
  });

  describe('teaching assignments', () => {
    it('assigns, reassigns and removes a teacher', async () => {
      const { fx } = t;
      const agent = await t.loginAs(fx.users.admin.phone);
      const url = `${base()}/setup/assignments`;
      const set = await agent
        .put(url)
        .send({ classSectionId: fx.class6a.id, subjectId: fx.science.id, teacherId: fx.users.teacher2.id });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ classSectionId: fx.class6a.id, subjectId: fx.science.id, teacherName: 'أستاذ ثاني' });

      // The teacher can now act on that class/subject.
      const teacher2 = await t.loginAs(fx.users.teacher2.phone);
      const scope = await teacher2.get(`${base()}/lookups/scope`);
      expect(scope.body.classes.find((c: { id: string }) => c.id === fx.class6a.id)?.subjects).toEqual([
        { id: fx.science.id, name: 'العلوم' },
      ]);

      // Supervisors may teach too; the pair stays unique.
      const re = await agent
        .put(url)
        .send({ classSectionId: fx.class6a.id, subjectId: fx.science.id, teacherId: fx.users.supervisor.id });
      expect(re.body).toMatchObject({ id: set.body.id, teacherId: fx.users.supervisor.id, teacherName: 'مشرف أ' });
      const rows = await t.db
        .select()
        .from(s.teachingAssignments)
        .where(
          and(eq(s.teachingAssignments.classSectionId, fx.class6a.id), eq(s.teachingAssignments.subjectId, fx.science.id)),
        );
      expect(rows).toHaveLength(1);

      const removed = await agent.put(url).send({ classSectionId: fx.class6a.id, subjectId: fx.science.id, teacherId: null });
      expect(removed.body).toEqual({
        id: null,
        classSectionId: fx.class6a.id,
        subjectId: fx.science.id,
        teacherId: null,
        teacherName: null,
      });
      const after = await agent.get(`${base()}/setup/structure`);
      expect(after.body.assignments.some((a: { classSectionId: string }) => a.classSectionId === fx.class6a.id)).toBe(
        false,
      );
    });

    it('validates the class, subject and teacher', async () => {
      const { fx } = t;
      const agent = await t.loginAs(fx.users.admin.phone);
      const url = `${base()}/setup/assignments`;
      // Not staff here: a guardian, another school's admin.
      for (const teacherId of [fx.users.guardian.id, fx.users.adminB.id]) {
        const res = await agent.put(url).send({ classSectionId: fx.class6a.id, subjectId: fx.math.id, teacherId });
        expect(res.status).toBe(400);
      }
      expect(
        (await agent.put(url).send({ classSectionId: fx.classB.id, subjectId: fx.math.id, teacherId: fx.users.teacher.id }))
          .status,
      ).toBe(404);
      expect(
        (await agent.put(url).send({ classSectionId: fx.class6a.id, subjectId: fx.mathB.id, teacherId: fx.users.teacher.id }))
          .status,
      ).toBe(404);
      // teacherId must be given explicitly (null to remove).
      expect((await agent.put(url).send({ classSectionId: fx.class6a.id, subjectId: fx.math.id })).status).toBe(400);
      const teacher = await t.loginAs(fx.users.teacher.phone);
      expect(
        (await teacher.put(url).send({ classSectionId: fx.class5a.id, subjectId: fx.math.id, teacherId: fx.users.teacher.id }))
          .status,
      ).toBe(403);
    });
  });
});

describe('staff', () => {
  it('lists teachers with their current-year assignments', async () => {
    const { fx } = t;
    const agent = await t.loginAs(fx.users.admin.phone);
    const res = await agent.get(`${base()}/staff?role=teacher`);
    expect(res.status).toBe(200);
    expect(res.body.map((m: { fullName: string }) => m.fullName).sort()).toEqual(['أستاذ أ', 'أستاذ ثاني'].sort());
    const teacher = res.body.find((m: { userId: string }) => m.userId === fx.users.teacher.id);
    expect(teacher).toMatchObject({
      fullName: 'أستاذ أ',
      phone: fx.users.teacher.phone,
      status: 'active',
      roles: ['teacher'],
    });
    expect(teacher.assignments).toEqual([
      { classLabel: 'الصف الخامس - أ', subjectName: 'الرياضيات' },
      { classLabel: 'الصف الخامس - ب', subjectName: 'اللغة العربية' },
    ]);
    expect(typeof teacher.lastLoginAt).toBe('string');

    const supervisors = await agent.get(`${base()}/staff?role=supervisor`);
    expect(supervisors.body.map((m: { userId: string }) => m.userId)).toEqual([fx.users.supervisor.id]);
    const all = await agent.get(`${base()}/staff`);
    expect(all.body.map((m: { userId: string }) => m.userId)).toContain(fx.users.admin.id);
    expect(all.body.map((m: { userId: string }) => m.userId)).not.toContain(fx.users.guardian.id);
    expect((await agent.get(`${base()}/staff?role=guardian`)).status).toBe(400);
  });

  it('adds a new teacher with an activation code that works', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent
      .post(`${base()}/staff`)
      .send({ fullName: ' عثمان الأمين ', phone: '+249 91 555 0001', role: 'teacher' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fullName: 'عثمان الأمين', phone: '0915550001', status: 'pending' });
    expect(res.body.activationCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const list = await agent.get(`${base()}/staff?role=teacher`);
    expect(list.body.find((m: { userId: string }) => m.userId === res.body.userId)).toMatchObject({
      status: 'pending',
      assignments: [],
      lastLoginAt: null,
    });

    // Same phone + role again → conflict.
    expect(
      (await agent.post(`${base()}/staff`).send({ fullName: 'آخر', phone: '0915550001', role: 'teacher' })).status,
    ).toBe(409);

    // A fresh code revokes the first one; the new one activates the account.
    const again = await agent.post(`${base()}/staff/${res.body.userId}/activation-code`);
    expect(again.status).toBe(200);
    expect(again.body.code).not.toBe(res.body.activationCode);
    expect((await t.anon().post('/api/auth/activate').send({ code: res.body.activationCode })).status).toBe(400);
    const newbie = t.anon();
    expect((await newbie.post('/api/auth/set-pin').send({ code: again.body.code, pin: '5678' })).status).toBe(200);
    expect((await newbie.get(`${base()}/lookups/scope`)).status).toBe(200);

    // Activated: no more codes.
    expect((await agent.post(`${base()}/staff/${res.body.userId}/activation-code`)).status).toBe(409);
  });

  it('reuses an existing user (no code when already active)', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent
      .post(`${base()}/staff`)
      .send({ fullName: 'اسم مختلف', phone: t.fx.users.guardian2.phone, role: 'supervisor' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: t.fx.users.guardian2.id,
      fullName: 'ولي أمر ثاني',
      status: 'active',
      activationCode: null,
      expiresAt: null,
    });
    const supervisors = await agent.get(`${base()}/staff?role=supervisor`);
    expect(supervisors.body.find((m: { userId: string }) => m.userId === t.fx.users.guardian2.id)?.roles).toEqual([
      'supervisor',
    ]);
    // Clean up for the other tests.
    expect((await agent.delete(`${base()}/staff/${t.fx.users.guardian2.id}?role=supervisor`)).status).toBe(200);
  });

  it('validates the new staff member', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const cases = [
      { fullName: 'أ', phone: '123', role: 'teacher' },
      { fullName: '', phone: '0915550002', role: 'teacher' },
      { fullName: 'أ', phone: '0915550002', role: 'guardian' },
      { fullName: 'أ', role: 'teacher' },
    ];
    for (const body of cases) {
      const res = await agent.post(`${base()}/staff`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.details?.length).toBeGreaterThan(0);
    }
  });

  it('issues codes only for this school\'s pending staff', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    // A guardian (not staff), another school's admin, an active teacher.
    expect((await agent.post(`${base()}/staff/${t.fx.users.pending.id}/activation-code`)).status).toBe(404);
    expect((await agent.post(`${base()}/staff/${t.fx.users.adminB.id}/activation-code`)).status).toBe(404);
    expect((await agent.post(`${base()}/staff/${t.fx.users.teacher.id}/activation-code`)).status).toBe(409);
    expect((await agent.post(`${base()}/staff/not-a-uuid/activation-code`)).status).toBe(400);
  });

  it('removes a teacher with their assignments and open timetable periods', async () => {
    const { fx } = t;
    const leaving = await addStaffUser('0915550010', 'أستاذ مغادر', ['teacher']);
    await t.db.insert(s.teachingAssignments).values({
      schoolId: fx.schoolA.id,
      classSectionId: fx.class6a.id,
      subjectId: fx.arabic.id,
      teacherId: leaving.id,
    });
    const slot = await one(
      t.db
        .insert(s.timetableSlots)
        .values({
          schoolId: fx.schoolA.id,
          classSectionId: fx.class6a.id,
          weekday: 0,
          period: 1,
          subjectId: fx.arabic.id,
          teacherId: leaving.id,
        })
        .returning(),
    );
    // A period in a past year keeps its teacher (history).
    const pastYear = await one(
      t.db
        .insert(s.academicYears)
        .values({ schoolId: fx.schoolA.id, name: '2020/2021', startsOn: '2020-07-01', endsOn: '2021-06-30' })
        .returning(),
    );
    const pastClass = await one(
      t.db
        .insert(s.classSections)
        .values({ schoolId: fx.schoolA.id, academicYearId: pastYear.id, gradeLevelId: fx.grade6.id, name: 'أ' })
        .returning(),
    );
    const pastSlot = await one(
      t.db
        .insert(s.timetableSlots)
        .values({
          schoolId: fx.schoolA.id,
          classSectionId: pastClass.id,
          weekday: 0,
          period: 1,
          subjectId: fx.arabic.id,
          teacherId: leaving.id,
        })
        .returning(),
    );

    const leavingAgent = await t.loginAs(leaving.phone);
    expect((await leavingAgent.get(`${base()}/timetable/mine`)).status).toBe(200);

    const agent = await t.loginAs(fx.users.admin.phone);
    expect((await agent.delete(`${base()}/staff/${leaving.id}`)).status).toBe(400); // role is required
    const res = await agent.delete(`${base()}/staff/${leaving.id}?role=teacher`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const assignments = await t.db
      .select()
      .from(s.teachingAssignments)
      .where(eq(s.teachingAssignments.teacherId, leaving.id));
    expect(assignments).toHaveLength(0);
    const [slotAfter] = await t.db.select().from(s.timetableSlots).where(eq(s.timetableSlots.id, slot.id));
    expect(slotAfter.teacherId).toBeNull();
    const [pastAfter] = await t.db.select().from(s.timetableSlots).where(eq(s.timetableSlots.id, pastSlot.id));
    expect(pastAfter.teacherId).toBe(leaving.id);
    const audit = await t.db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entity, 'membership'), eq(s.auditLogs.entityId, leaving.id)));
    expect(audit.map((a) => a.action)).toEqual(['delete']);

    // The account still exists but has no access to the school any more.
    expect((await leavingAgent.get(`${base()}/timetable/mine`)).status).toBe(403);
    expect((await agent.delete(`${base()}/staff/${leaving.id}?role=teacher`)).status).toBe(404);
    await t.db.delete(s.academicYears).where(eq(s.academicYears.id, pastYear.id));
  });

  it('keeps the classes of someone who still supervises', async () => {
    const { fx } = t;
    const both = await addStaffUser('0915550011', 'مشرف وأستاذ', ['teacher', 'supervisor']);
    await t.db.insert(s.teachingAssignments).values({
      schoolId: fx.schoolA.id,
      classSectionId: fx.class6a.id,
      subjectId: fx.math.id,
      teacherId: both.id,
    });
    const agent = await t.loginAs(fx.users.admin.phone);
    const list = await agent.get(`${base()}/staff?role=supervisor`);
    expect(list.body.find((m: { userId: string }) => m.userId === both.id)?.roles).toEqual(['supervisor', 'teacher']);
    expect((await agent.delete(`${base()}/staff/${both.id}?role=teacher`)).status).toBe(200);
    const kept = await t.db.select().from(s.teachingAssignments).where(eq(s.teachingAssignments.teacherId, both.id));
    expect(kept).toHaveLength(1);
    const teachers = await agent.get(`${base()}/staff?role=teacher`);
    expect(teachers.body.some((m: { userId: string }) => m.userId === both.id)).toBe(false);
  });

  it('an admin cannot remove their own admin role, but can remove another admin', async () => {
    const { fx } = t;
    const agent = await t.loginAs(fx.users.admin.phone);
    const self = await agent.delete(`${base()}/staff/${fx.users.admin.id}?role=admin`);
    expect(self.status).toBe(400);
    const second = await addStaffUser('0915550012', 'مدير ثاني', ['admin']);
    expect((await agent.delete(`${base()}/staff/${second.id}?role=admin`)).status).toBe(200);
    const roles = await t.db.select().from(s.memberships).where(eq(s.memberships.userId, second.id));
    expect(roles).toHaveLength(0);
  });

  it('is admin-only and tenant-isolated', async () => {
    const { fx } = t;
    for (const phone of [fx.users.supervisor.phone, fx.users.teacher.phone, fx.users.guardian.phone]) {
      const agent = await t.loginAs(phone);
      expect((await agent.get(`${base()}/staff?role=teacher`)).status).toBe(403);
      expect(
        (await agent.post(`${base()}/staff`).send({ fullName: 'أ', phone: '0915550020', role: 'teacher' })).status,
      ).toBe(403);
      expect((await agent.delete(`${base()}/staff/${fx.users.teacher2.id}?role=teacher`)).status).toBe(403);
    }
    const adminB = await t.loginAs(fx.users.adminB.phone);
    expect((await adminB.get(`${base()}/staff`)).status).toBe(403);
    // School A's teacher is not school B's staff.
    const b = `/api/schools/${fx.schoolB.id}/staff`;
    expect((await adminB.delete(`${b}/${fx.users.teacher.id}?role=teacher`)).status).toBe(404);
    expect((await adminB.post(`${b}/${fx.users.teacher.id}/activation-code`)).status).toBe(404);
    expect((await adminB.get(`${b}?role=teacher`)).body).toEqual([]);
    const [still] = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.userId, fx.users.teacher.id), eq(s.memberships.role, 'teacher')));
    expect(still).toBeTruthy();
  });
});

describe('settings', () => {
  it('returns the school settings with the default grade bands', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.get(`${base()}/settings`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'مدرسة الاختبار أ',
      code: 'TEST_A',
      phone: null,
      address: null,
      timezone: 'Africa/Khartoum',
      weekStart: 0,
      gradeBands: DEFAULT_GRADE_BANDS,
    });
  });

  it('validates grade bands, week start and phone', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const bad = [
      { gradeBands: [] },
      { gradeBands: [{ min: 50, label: 'ناجح' }] }, // no band from 0
      {
        gradeBands: [
          { min: 0, label: 'ضعيف' },
          { min: 0, label: 'مقبول' },
        ],
      },
      { gradeBands: [{ min: 0, label: '' }] },
      { gradeBands: [{ min: 101, label: 'خارق' }, { min: 0, label: 'ضعيف' }] },
      { gradeBands: Array.from({ length: 11 }, (_, i) => ({ min: i * 9, label: `ت${i}` })) },
      { weekStart: 7 },
      { weekStart: 1.5 },
      { phone: '12' },
      { name: '' },
      {},
    ];
    for (const body of bad) {
      const res = await agent.patch(`${base()}/settings`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('updates the settings; the bands are used by the rest of the app', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.patch(`${base()}/settings`).send({
      name: 'مدرسة الاختبار أ الجديدة',
      phone: '+249 18 300 0000',
      address: 'أم درمان',
      weekStart: 6,
      gradeBands: [
        { min: 0, label: 'راسب' },
        { min: 80, label: 'ممتاز' },
        { min: 50, label: 'ناجح' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'مدرسة الاختبار أ الجديدة',
      phone: '0183000000',
      address: 'أم درمان',
      weekStart: 6,
      gradeBands: [
        { min: 80, label: 'ممتاز' },
        { min: 50, label: 'ناجح' },
        { min: 0, label: 'راسب' },
      ],
    });
    const scope = await agent.get(`${base()}/lookups/scope`);
    expect(scope.body.school).toMatchObject({ name: 'مدرسة الاختبار أ الجديدة', weekStart: 6 });
    expect(scope.body.school.gradeBands).toHaveLength(3);

    // Clearing optional fields; school B is untouched.
    const cleared = await agent.patch(`${base()}/settings`).send({ phone: '', address: null });
    expect(cleared.body).toMatchObject({ phone: null, address: null, weekStart: 6 });
    const [b] = await t.db.select().from(s.schools).where(eq(s.schools.id, t.fx.schoolB.id));
    expect(b).toMatchObject({ name: 'مدرسة الاختبار ب', weekStart: 0, gradeBands: null });

    await agent
      .patch(`${base()}/settings`)
      .send({ name: 'مدرسة الاختبار أ', weekStart: 0, gradeBands: DEFAULT_GRADE_BANDS });
  });

  it('is admin-only and tenant-isolated', async () => {
    for (const phone of [t.fx.users.supervisor.phone, t.fx.users.teacher.phone, t.fx.users.guardian.phone]) {
      const agent = await t.loginAs(phone);
      expect((await agent.get(`${base()}/settings`)).status).toBe(403);
      expect((await agent.patch(`${base()}/settings`).send({ weekStart: 1 })).status).toBe(403);
    }
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`${base()}/settings`)).status).toBe(403);
    expect((await adminB.patch(`${base()}/settings`).send({ name: 'مخترق' })).status).toBe(403);
    const own = await adminB.get(`/api/schools/${t.fx.schoolB.id}/settings`);
    expect(own.body.code).toBe('TEST_B');
  });
});
