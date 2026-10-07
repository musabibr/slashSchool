import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { addDays, todayIn } from '@slash/shared';
import * as s from '../src/db/schema';
import { setupTestApp, type TestContext } from './helpers';

type Agent = Awaited<ReturnType<TestContext['loginAs']>>;

interface ListItem {
  id: string;
  code: string;
  fullName: string;
  classSectionId: string | null;
  classLabel: string | null;
  gradeLevelName: string | null;
  status: string;
  registeredAt: string;
  guardianCount: number;
}

interface IssuedGuardian {
  userId: string;
  fullName: string;
  phone: string;
  status: string;
  relation: string;
  activationCode: string | null;
  otherSchool: boolean;
}

interface ProfileGuardian {
  userId: string;
  fullName: string;
  phone: string;
  relation: string;
  isPrimary: boolean;
  occupation: string | null;
  whatsapp: string | null;
  canIssueCode: boolean;
}

let t: TestContext;
let admin: Agent;
let supervisor: Agent;
let teacher: Agent;
let guardian: Agent;
let adminB: Agent;
let today: string;

const url = (path = '') => `/api/schools/${t.fx.schoolA.id}/students${path}`;
const guardiansUrl = (path = '') => `/api/schools/${t.fx.schoolA.id}/guardians${path}`;

/** A valid D3 admission body; `over` replaces whole sections. */
const admission = (over: Record<string, unknown> = {}) => ({
  student: {
    firstName: 'ريم',
    fatherName: 'عثمان',
    grandfatherName: 'الطيب',
    greatGrandfatherName: 'محمد',
    gender: 'female',
    birthDate: '2015-03-04',
    gradeLevelId: t.fx.grade5.id,
    classSectionId: t.fx.class5b.id,
  },
  mother: { name: 'آمنة علي حسن', phone: '0123456789', whatsapp: '' },
  guardian: {
    firstName: 'عثمان',
    fatherName: 'الطيب',
    grandfatherName: 'محمد',
    greatGrandfatherName: '',
    phone: '+249 91 777 0001',
    whatsapp: '0917770001',
    relation: 'father',
    occupation: 'مهندس',
    workplace: 'الخرطوم',
    locality: 'كرري',
    residence: 'الحتانة',
  },
  ...over,
});

async function studentByCode(code: string) {
  const [row] = await t.db
    .select()
    .from(s.students)
    .where(and(eq(s.students.schoolId, t.fx.schoolA.id), eq(s.students.code, code)));
  return row;
}

beforeAll(async () => {
  t = await setupTestApp();
  today = todayIn(t.fx.schoolA.timezone);
  [admin, supervisor, teacher, guardian, adminB] = await Promise.all([
    t.loginAs(t.fx.users.admin.phone),
    t.loginAs(t.fx.users.supervisor.phone),
    t.loginAs(t.fx.users.teacher.phone),
    t.loginAs(t.fx.users.guardian.phone),
    t.loginAs(t.fx.users.adminB.phone),
  ]);
});
afterAll(() => t.close());

describe('GET /students (D2)', () => {
  it('lists the school’s students with class, grade and guardian count', async () => {
    const res = await admin.get(url());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    const items = res.body.items as ListItem[];
    expect(items.map((x) => x.code).sort()).toEqual(['S-1', 'S-2', 'S-3', 'S-4']);
    const s1 = items.find((x) => x.id === t.fx.students.s1.id)!;
    expect(s1).toMatchObject({
      fullName: 'مصعب إبراهيم عبدالله',
      classLabel: 'الصف الخامس - أ',
      gradeLevelName: 'الصف الخامس',
      status: 'active',
      registeredAt: '2025-07-01',
      guardianCount: 1,
    });
    expect(items.find((x) => x.id === t.fx.students.s3.id)!.guardianCount).toBe(0);
    // Same registration date: newest code first.
    expect(items.map((x) => x.code)).toEqual(['S-4', 'S-3', 'S-2', 'S-1']);
  });

  it('filters by class, grade level, status and search (any name part, code, Arabic letter variants)', async () => {
    const byClass = await admin.get(url(`?classId=${t.fx.class5b.id}`));
    expect(byClass.body.items.map((x: ListItem) => x.id)).toEqual([t.fx.students.s5.id]);
    const byGrade = await admin.get(url(`?gradeLevelId=${t.fx.grade5.id}`));
    expect(byGrade.body.total).toBe(4);
    const byGrade6 = await admin.get(url(`?gradeLevelId=${t.fx.grade6.id}`));
    expect(byGrade6.body.total).toBe(0);
    // "احمد" (no hamza) finds "أحمد".
    const variant = await admin.get(url(`?q=${encodeURIComponent('احمد')}`));
    expect(variant.body.items.map((x: ListItem) => x.id)).toEqual([t.fx.students.s2.id]);
    const twoParts = await admin.get(url(`?q=${encodeURIComponent('مصعب ابراهيم')}`));
    expect(twoParts.body.items.map((x: ListItem) => x.id)).toEqual([t.fx.students.s1.id]);
    const byCode = await admin.get(url('?q=S-3'));
    expect(byCode.body.items.map((x: ListItem) => x.id)).toEqual([t.fx.students.s3.id]);
    const wildcard = await admin.get(url(`?q=${encodeURIComponent('%')}`));
    expect(wildcard.body.total).toBe(0);
    const expelled = await admin.get(url('?status=expelled'));
    expect(expelled.body.total).toBe(0);
    const empty = await admin.get(url('?q=&classId=&status='));
    expect(empty.body.total).toBe(4);
  });

  it('paginates with limit/offset and keeps the total', async () => {
    const page1 = await admin.get(url('?limit=2&offset=0'));
    const page2 = await admin.get(url('?limit=2&offset=2'));
    expect(page1.body.total).toBe(4);
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    expect(new Set([...page1.body.items, ...page2.body.items].map((x: ListItem) => x.id)).size).toBe(4);
  });

  it('validates the query', async () => {
    expect((await admin.get(url('?limit=500'))).status).toBe(400);
    expect((await admin.get(url('?classId=abc'))).status).toBe(400);
    expect((await admin.get(url('?status=gone'))).status).toBe(400);
  });

  it('is for admins and supervisors of the school only', async () => {
    expect((await supervisor.get(url())).status).toBe(200);
    expect((await teacher.get(url())).status).toBe(403);
    expect((await guardian.get(url())).status).toBe(403);
    expect((await adminB.get(url())).status).toBe(403);
    expect((await t.anon().get(url())).status).toBe(401);
  });
});

describe('GET /students/:id (D4)', () => {
  it('returns the profile with guardians', async () => {
    const res = await supervisor.get(url(`/${t.fx.students.s1.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: t.fx.students.s1.id,
      code: 'S-1',
      fullName: 'مصعب إبراهيم عبدالله',
      classLabel: 'الصف الخامس - أ',
      gradeLevelName: 'الصف الخامس',
      stageId: t.fx.stageA.id,
      stageName: 'المتوسطة',
      status: 'active',
      hasLinkCode: false,
    });
    expect(res.body.linkCodeHash).toBeUndefined();
    const guardians = res.body.guardians as ProfileGuardian[];
    expect(guardians).toHaveLength(1);
    expect(guardians[0]).toMatchObject({
      userId: t.fx.users.guardian.id,
      phone: t.fx.users.guardian.phone,
      relation: 'father',
      isPrimary: true,
      // The guardian also belongs to school B, so school A cannot reset the account.
      canIssueCode: false,
    });
  });

  it('denies other schools, teachers and guardians', async () => {
    expect((await admin.get(url(`/${t.fx.students.s4.id}`))).status).toBe(404);
    expect((await adminB.get(url(`/${t.fx.students.s1.id}`))).status).toBe(403);
    expect((await teacher.get(url(`/${t.fx.students.s1.id}`))).status).toBe(403);
    expect((await guardian.get(url(`/${t.fx.students.s1.id}`))).status).toBe(403);
    expect((await admin.get(url('/not-a-uuid'))).status).toBe(400);
  });
});

describe('POST /students (D3 admission)', () => {
  let created: { student: { id: string; code: string; fullName: string }; guardians: IssuedGuardian[] };

  it('registers the student, creates the guardian account and issues an activation code', async () => {
    const res = await admin.post(url()).send(admission({ motherAccount: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created = res.body;
    expect(created.student).toMatchObject({ code: 'S-5', fullName: 'ريم عثمان الطيب' });
    expect(created.guardians).toHaveLength(2);
    const [father, mother] = created.guardians;
    expect(father).toMatchObject({
      fullName: 'عثمان الطيب محمد',
      phone: '0917770001',
      relation: 'father',
      status: 'pending',
      otherSchool: false,
    });
    expect(father.activationCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
    expect(mother).toMatchObject({ fullName: 'آمنة علي حسن', phone: '0123456789', relation: 'mother' });
    expect(mother.activationCode).toBeTruthy();

    const row = await studentByCode('S-5');
    expect(row).toMatchObject({
      gender: 'female',
      birthDate: '2015-03-04',
      gradeLevelId: t.fx.grade5.id,
      classSectionId: t.fx.class5b.id,
      registeredAt: today,
      motherName: 'آمنة علي حسن',
      motherPhone: '0123456789',
      motherWhatsapp: null,
      status: 'active',
    });
    const links = await t.db.select().from(s.studentGuardians).where(eq(s.studentGuardians.studentId, row.id));
    expect(links.find((l) => l.userId === father.userId)).toMatchObject({
      isPrimary: true,
      occupation: 'مهندس',
      whatsapp: '0917770001',
      residence: 'الحتانة',
    });
    expect(links.find((l) => l.userId === mother.userId)).toMatchObject({ isPrimary: false, relation: 'mother' });
    const membership = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.userId, father.userId), eq(s.memberships.schoolId, t.fx.schoolA.id)));
    expect(membership.map((m) => m.role)).toEqual(['guardian']);
    const audits = await t.db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entity, 'student'), eq(s.auditLogs.entityId, row.id)));
    expect(audits.map((a) => a.action)).toEqual(['create']);

    // The code works on the activation screen.
    const activate = await t.anon().post('/api/auth/activate').send({ code: father.activationCode });
    expect(activate.status).toBe(200);
    expect(activate.body.fullName).toBe('عثمان الطيب محمد');
  });

  it('allocates the next code and reuses existing accounts without issuing codes for them', async () => {
    const res = await admin.post(url()).send(
      admission({
        student: {
          firstName: 'هبة',
          fatherName: 'إبراهيم',
          grandfatherName: 'عبدالله',
          gender: 'female',
          gradeLevelId: t.fx.grade6.id,
          registeredAt: '2025-09-01',
        },
        mother: {},
        guardian: {
          firstName: 'أي',
          fatherName: 'اسم',
          grandfatherName: 'آخر',
          phone: t.fx.users.guardian.phone,
          relation: 'father',
        },
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.student.code).toBe('S-6');
    // Existing, activated account: its own name is kept and no code is issued.
    expect(res.body.guardians).toEqual([
      expect.objectContaining({
        userId: t.fx.users.guardian.id,
        fullName: 'ولي أمر',
        status: 'active',
        activationCode: null,
        otherSchool: true,
      }),
    ]);
    const row = await studentByCode('S-6');
    expect(row).toMatchObject({ classSectionId: null, gradeLevelId: t.fx.grade6.id, registeredAt: '2025-09-01' });
  });

  it('never issues a code for an account used by another school', async () => {
    // A pending account that only school B knows (e.g. a teacher being onboarded there).
    const [other] = await t.db.insert(s.users).values({ phone: '0917770099', fullName: 'موظف ب' }).returning();
    await t.db.insert(s.memberships).values({ userId: other.id, schoolId: t.fx.schoolB.id, role: 'teacher' });
    const res = await admin.post(url()).send(
      admission({
        guardian: { firstName: 'س', fatherName: 'ص', grandfatherName: 'ع', phone: other.phone },
        mother: {},
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.guardians[0]).toMatchObject({
      userId: other.id,
      status: 'pending',
      activationCode: null,
      otherSchool: true,
    });
    const codes = await t.db.select().from(s.activationCodes).where(eq(s.activationCodes.userId, other.id));
    expect(codes).toHaveLength(0);
  });

  it('validates required fields, phones, dates and the class/grade pair', async () => {
    const missing = await admin.post(url()).send({ student: {}, guardian: {} });
    expect(missing.status).toBe(400);
    const paths = (missing.body.error.details as Array<{ path: string }>).map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'student.firstName',
        'student.fatherName',
        'student.grandfatherName',
        'student.gender',
        'student.gradeLevelId',
        'guardian.firstName',
        'guardian.phone',
      ]),
    );

    const badPhone = await admin.post(url()).send(admission({ guardian: { ...admission().guardian, phone: '123' } }));
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error.details[0]).toMatchObject({ path: 'guardian.phone', message: 'رقم الهاتف غير صالح' });

    const badMother = await admin.post(url()).send(admission({ mother: { name: 'أم' }, motherAccount: true }));
    expect(badMother.status).toBe(400);
    expect(badMother.body.error.details[0].path).toBe('mother.phone');

    const sameMother = await admin
      .post(url())
      .send(admission({ mother: { name: 'أم', phone: '0917770001' }, motherAccount: true }));
    expect(sameMother.status).toBe(400);

    const future = await admin
      .post(url())
      .send(admission({ student: { ...admission().student, birthDate: addDays(today, 1) } }));
    expect(future.status).toBe(400);
    expect(future.body.error.details[0].path).toBe('student.birthDate');

    const wrongClass = await admin
      .post(url())
      .send(admission({ student: { ...admission().student, classSectionId: t.fx.class6a.id } }));
    expect(wrongClass.status).toBe(400);
    expect(wrongClass.body.error.details[0].path).toBe('student.classSectionId');

    const otherSchoolClass = await admin
      .post(url())
      .send(admission({ student: { ...admission().student, classSectionId: t.fx.classB.id } }));
    expect(otherSchoolClass.status).toBe(404);

    const [gradeB] = await t.db.select().from(s.gradeLevels).where(eq(s.gradeLevels.schoolId, t.fx.schoolB.id));
    const otherSchoolGrade = await admin
      .post(url())
      .send(admission({ student: { ...admission().student, gradeLevelId: gradeB.id, classSectionId: null } }));
    expect(otherSchoolGrade.status).toBe(404);

    expect(await studentByCode('S-8')).toBeUndefined();
  });

  it('is for admins only', async () => {
    expect((await supervisor.post(url()).send(admission())).status).toBe(403);
    expect((await teacher.post(url()).send(admission())).status).toBe(403);
    expect((await guardian.post(url()).send(admission())).status).toBe(403);
    expect((await adminB.post(url()).send(admission())).status).toBe(403);
  });
});

describe('PATCH /students/:id', () => {
  it('updates names, mother fields and moves the student to a class of another grade', async () => {
    const res = await admin.patch(url(`/${t.fx.students.s3.id}`)).send({
      firstName: ' سارة ',
      greatGrandfatherName: 'أحمد',
      motherName: 'زينب محمد علي',
      motherPhone: '0912000111',
      classSectionId: t.fx.class6a.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      firstName: 'سارة',
      greatGrandfatherName: 'أحمد',
      motherName: 'زينب محمد علي',
      motherPhone: '0912000111',
      classSectionId: t.fx.class6a.id,
      gradeLevelId: t.fx.grade6.id,
      classLabel: 'الصف السادس - أ',
    });
  });

  it('changing only the grade level takes the student out of a class of another level', async () => {
    const res = await admin.patch(url(`/${t.fx.students.s3.id}`)).send({ gradeLevelId: t.fx.grade5.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gradeLevelId: t.fx.grade5.id, classSectionId: null, classLabel: null });
    const back = await admin
      .patch(url(`/${t.fx.students.s3.id}`))
      .send({ gradeLevelId: t.fx.grade5.id, classSectionId: t.fx.class5a.id, greatGrandfatherName: null });
    expect(back.body).toMatchObject({ classSectionId: t.fx.class5a.id, greatGrandfatherName: null });
  });

  it('validates and authorizes', async () => {
    expect((await admin.patch(url(`/${t.fx.students.s3.id}`)).send({ firstName: '' })).status).toBe(400);
    expect((await admin.patch(url(`/${t.fx.students.s3.id}`)).send({ motherPhone: '12' })).status).toBe(400);
    const mismatch = await admin
      .patch(url(`/${t.fx.students.s3.id}`))
      .send({ gradeLevelId: t.fx.grade6.id, classSectionId: t.fx.class5a.id });
    expect(mismatch.status).toBe(400);
    expect((await admin.patch(url(`/${t.fx.students.s3.id}`)).send({ classSectionId: t.fx.classB.id })).status).toBe(
      404,
    );
    expect((await admin.patch(url(`/${t.fx.students.s4.id}`)).send({ firstName: 'x' })).status).toBe(404);
    expect((await supervisor.patch(url(`/${t.fx.students.s3.id}`)).send({ firstName: 'x' })).status).toBe(403);
    expect((await adminB.patch(url(`/${t.fx.students.s3.id}`)).send({ firstName: 'x' })).status).toBe(403);
  });
});

describe('PATCH /students/:id/status', () => {
  it('requires a reason to expel', async () => {
    const res = await admin.patch(url(`/${t.fx.students.s5.id}/status`)).send({ status: 'expelled' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'reason', message: 'سبب الفصل مطلوب' });
    expect((await admin.patch(url(`/${t.fx.students.s5.id}/status`)).send({ status: 'gone' })).status).toBe(400);
  });

  it('expels, withdraws and reactivates with an audit trail', async () => {
    const expel = await admin
      .patch(url(`/${t.fx.students.s5.id}/status`))
      .send({ status: 'expelled', reason: 'مخالفات متكررة' });
    expect(expel.status).toBe(200);
    expect(expel.body).toMatchObject({ status: 'expelled', statusReason: 'مخالفات متكررة' });
    expect(expel.body.statusChangedAt).toBeTruthy();

    const listed = await admin.get(url('?status=expelled'));
    expect(listed.body.items.map((x: ListItem) => x.id)).toEqual([t.fx.students.s5.id]);

    const reactivate = await admin.patch(url(`/${t.fx.students.s5.id}/status`)).send({ status: 'active' });
    expect(reactivate.body).toMatchObject({ status: 'active', statusReason: null });
    const withdraw = await admin.patch(url(`/${t.fx.students.s5.id}/status`)).send({ status: 'withdrawn' });
    expect(withdraw.body.status).toBe('withdrawn');
    // Same status again: no new audit entry.
    await admin.patch(url(`/${t.fx.students.s5.id}/status`)).send({ status: 'withdrawn' });
    await admin.patch(url(`/${t.fx.students.s5.id}/status`)).send({ status: 'active' });

    const audits = await t.db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entity, 'student'), eq(s.auditLogs.entityId, t.fx.students.s5.id)))
      .orderBy(asc(s.auditLogs.createdAt));
    expect(audits.map((a) => a.action)).toEqual(['expel', 'status', 'status', 'status']);
    expect(audits[0]).toMatchObject({
      actorId: t.fx.users.admin.id,
      before: { status: 'active', reason: null },
      after: { status: 'expelled', reason: 'مخالفات متكررة' },
    });
  });

  it('is for this school’s admins only', async () => {
    const body = { status: 'withdrawn' };
    expect((await supervisor.patch(url(`/${t.fx.students.s5.id}/status`)).send(body)).status).toBe(403);
    expect((await teacher.patch(url(`/${t.fx.students.s5.id}/status`)).send(body)).status).toBe(403);
    expect((await adminB.patch(url(`/${t.fx.students.s5.id}/status`)).send(body)).status).toBe(403);
    expect((await admin.patch(url(`/${t.fx.students.s4.id}/status`)).send(body)).status).toBe(404);
  });
});

describe('POST /students/:id/link-code', () => {
  it('issues a link code a guardian can use with "+"', async () => {
    const res = await admin.post(url(`/${t.fx.students.s5.id}/link-code`));
    expect(res.status).toBe(201);
    expect(res.body.code).toBeTruthy();
    expect((await admin.get(url(`/${t.fx.students.s5.id}`))).body.hasLinkCode).toBe(true);
    const guardian2 = await t.loginAs(t.fx.users.guardian2.phone);
    const link = await guardian2.post('/api/me/children/link').send({ code: res.body.code });
    expect(link.status).toBe(201);
  });

  it('is for this school’s admins only', async () => {
    expect((await supervisor.post(url(`/${t.fx.students.s5.id}/link-code`))).status).toBe(403);
    expect((await adminB.post(url(`/${t.fx.students.s5.id}/link-code`))).status).toBe(403);
    expect((await admin.post(url(`/${t.fx.students.s4.id}/link-code`))).status).toBe(404);
  });
});

describe('student guardians', () => {
  it('adds a guardian with an activation code; the first guardian becomes primary', async () => {
    const res = await admin.post(url(`/${t.fx.students.s3.id}/guardians`)).send({
      fullName: 'خالد عمر',
      phone: '0918880001',
      relation: 'uncle',
      whatsapp: '0918880001',
      occupation: 'تاجر',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ fullName: 'خالد عمر', relation: 'uncle', status: 'pending' });
    expect(res.body.activationCode).toBeTruthy();
    const profile = await admin.get(url(`/${t.fx.students.s3.id}`));
    expect(profile.body.guardians).toEqual([
      expect.objectContaining({ phone: '0918880001', isPrimary: true, occupation: 'تاجر', canIssueCode: true }),
    ]);
  });

  it('rejects duplicates and invalid input', async () => {
    const dup = await admin
      .post(url(`/${t.fx.students.s3.id}/guardians`))
      .send({ fullName: 'خالد عمر', phone: '0918880001', relation: 'uncle' });
    expect(dup.status).toBe(409);
    const bad = await admin
      .post(url(`/${t.fx.students.s3.id}/guardians`))
      .send({ fullName: '', phone: 'x', relation: 'friend' });
    expect(bad.status).toBe(400);
    expect((bad.body.error.details as Array<{ path: string }>).map((d) => d.path).sort()).toEqual([
      'fullName',
      'phone',
      'relation',
    ]);
  });

  it('updates the link details and moves the primary flag', async () => {
    const add = await admin
      .post(url(`/${t.fx.students.s3.id}/guardians`))
      .send({ fullName: 'فاطمة حسن', phone: '0918880002', relation: 'mother' });
    expect(add.status).toBe(201);
    const res = await admin
      .patch(url(`/${t.fx.students.s3.id}/guardians/${add.body.userId}`))
      .send({ isPrimary: true, occupation: 'معلمة', whatsapp: '0918880002' });
    expect(res.status).toBe(200);
    const guardians = res.body.guardians as ProfileGuardian[];
    expect(guardians[0]).toMatchObject({ userId: add.body.userId, isPrimary: true, occupation: 'معلمة' });
    expect(guardians.filter((g) => g.isPrimary)).toHaveLength(1);
    const unset = await admin
      .patch(url(`/${t.fx.students.s3.id}/guardians/${add.body.userId}`))
      .send({ isPrimary: false });
    expect(unset.status).toBe(400);
    const notLinked = await admin
      .patch(url(`/${t.fx.students.s3.id}/guardians/${t.fx.users.guardian.id}`))
      .send({ occupation: 'x' });
    expect(notLinked.status).toBe(404);
  });

  it('removes a guardian (promoting another to primary) but never the last one', async () => {
    const before = (await admin.get(url(`/${t.fx.students.s3.id}`))).body.guardians as ProfileGuardian[];
    const primary = before.find((g) => g.isPrimary)!;
    const del = await admin.delete(url(`/${t.fx.students.s3.id}/guardians/${primary.userId}`));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
    const after = (await admin.get(url(`/${t.fx.students.s3.id}`))).body.guardians as ProfileGuardian[];
    expect(after).toHaveLength(1);
    expect(after[0].isPrimary).toBe(true);
    // The removed account has no other child at the school: its guardian membership is gone.
    const membership = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.userId, primary.userId), eq(s.memberships.schoolId, t.fx.schoolA.id)));
    expect(membership).toHaveLength(0);

    const last = await admin.delete(url(`/${t.fx.students.s3.id}/guardians/${after[0].userId}`));
    expect(last.status).toBe(400);
    expect(last.body.error.message).toBe('لا يمكن حذف ولي الأمر الوحيد للطالب');
  });

  it('is for this school’s admins only', async () => {
    const body = { fullName: 'س', phone: '0918880009', relation: 'other' };
    expect((await supervisor.post(url(`/${t.fx.students.s3.id}/guardians`)).send(body)).status).toBe(403);
    expect((await adminB.post(url(`/${t.fx.students.s3.id}/guardians`)).send(body)).status).toBe(403);
    expect((await guardian.post(url(`/${t.fx.students.s1.id}/guardians`)).send(body)).status).toBe(403);
    expect((await admin.post(url(`/${t.fx.students.s4.id}/guardians`)).send(body)).status).toBe(404);
    expect((await adminB.delete(url(`/${t.fx.students.s1.id}/guardians/${t.fx.users.guardian.id}`))).status).toBe(403);
  });
});

describe('POST /students/import', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    studentFirstName: 'يوسف',
    studentFatherName: 'عوض',
    studentGrandfatherName: 'محمد',
    gender: 'ذكر',
    gradeLevel: 'الصف الخامس',
    classSection: 'أ',
    birthDate: '4/3/2015',
    guardianName: 'عوض محمد أحمد',
    guardianPhone: 917000001,
    relation: 'والد',
    ...over,
  });

  it('reports every problem per row on a dry run', async () => {
    const res = await admin.post(url('/import')).send({
      dryRun: true,
      rows: [
        row(),
        row({ studentFirstName: '', gender: 'ولد؟', gradeLevel: 'الصف العاشر', guardianPhone: '12' }),
        row({ classSection: 'ج', relation: 'جار', birthDate: '2015-13-40' }),
        row(),
        row({
          studentFirstName: 'مصعب',
          studentFatherName: 'إبراهيم',
          studentGrandfatherName: 'عبدالله',
          guardianPhone: t.fx.users.guardian.phone,
        }),
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.rowCount).toBe(5);
    const errors = res.body.errors as Array<{ row: number; messages: string[] }>;
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(errors[0].messages).toEqual(
      expect.arrayContaining([
        'الاسم الأول للطالب مطلوب',
        'الجنس "ولد؟" غير معروف (ذكر / أنثى)',
        'السنة الدراسية "الصف العاشر" غير موجودة',
        'رقم ولي الأمر "12" غير صالح',
      ]),
    );
    expect(errors[1].messages).toEqual(
      expect.arrayContaining([
        'الفصل "ج" غير موجود في الصف الخامس',
        'صلة القرابة "جار" غير معروفة',
        'تاريخ الميلاد "2015-13-40" غير صالح (YYYY-MM-DD)',
      ]),
    );
    expect(errors[2].messages).toEqual(['الطالب مكرر في الملف (الصف 1)']);
    expect(errors[3].messages).toEqual(['الطالب مسجل مسبقاً بنفس الاسم ورقم ولي الأمر']);

    // Nothing is written, even when importing for real with errors.
    const real = await admin.post(url('/import')).send({ dryRun: false, rows: [row(), row()] });
    expect(real.status).toBe(200);
    expect(real.body.valid).toBe(false);
    const before = await admin.get(url(`?q=${encodeURIComponent('يوسف')}`));
    expect(before.body.total).toBe(0);
  });

  it('imports valid rows in one go and returns the guardians’ activation codes', async () => {
    const rows = [
      row(),
      // Same guardian (phone written differently): one account, one code.
      row({
        studentFirstName: 'مريم',
        gender: 'أنثى',
        classSection: '',
        guardianPhone: '+249917000001',
        birthDate: '',
      }),
      // Grade and section in one column, English values, existing active account.
      row({
        studentFirstName: 'عمر',
        studentFatherName: 'ولي',
        gender: 'male',
        gradeLevel: 'الخامس - ب',
        classSection: undefined,
        guardianName: 'اسم مختلف',
        guardianPhone: t.fx.users.guardian2.phone,
        relation: 'mother',
        motherName: 'هدى',
        motherPhone: '0919000000',
      }),
    ];
    const dry = await admin.post(url('/import')).send({ dryRun: true, rows });
    expect(dry.body, JSON.stringify(dry.body)).toMatchObject({ valid: true, errors: [] });
    expect(dry.body.created).toBeUndefined();

    const res = await admin.post(url('/import')).send({ dryRun: false, rows });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ valid: true, created: 3 });
    expect(res.body.codes).toEqual([
      {
        guardianName: 'عوض محمد أحمد',
        phone: '0917000001',
        code: expect.any(String),
        students: ['يوسف عوض محمد', 'مريم عوض محمد'],
      },
    ]);
    const activate = await t.anon().post('/api/auth/activate').send({ code: res.body.codes[0].code });
    expect(activate.status).toBe(200);

    const yusuf = await studentByCode('S-8');
    expect(yusuf).toMatchObject({
      firstName: 'يوسف',
      gender: 'male',
      birthDate: '2015-03-04',
      gradeLevelId: t.fx.grade5.id,
      classSectionId: t.fx.class5a.id,
      registeredAt: today,
    });
    const maryam = await studentByCode('S-9');
    expect(maryam).toMatchObject({ firstName: 'مريم', gender: 'female', classSectionId: null, birthDate: null });
    const omar = await studentByCode('S-10');
    expect(omar).toMatchObject({ classSectionId: t.fx.class5b.id, motherName: 'هدى', motherPhone: '0919000000' });
    const omarLinks = await t.db.select().from(s.studentGuardians).where(eq(s.studentGuardians.studentId, omar.id));
    expect(omarLinks).toEqual([
      expect.objectContaining({ userId: t.fx.users.guardian2.id, relation: 'mother', isPrimary: true }),
    ]);

    // Importing the same file again is caught as duplicates.
    const again = await admin.post(url('/import')).send({ dryRun: true, rows });
    expect(again.body.valid).toBe(false);
    expect(again.body.errors).toHaveLength(3);
  });

  it('validates the payload and authorizes', async () => {
    expect((await admin.post(url('/import')).send({ rows: [] })).status).toBe(400);
    expect((await admin.post(url('/import')).send({ rows: 'x' })).status).toBe(400);
    const tooMany = Array.from({ length: 2001 }, () => ({}));
    expect((await admin.post(url('/import')).send({ rows: tooMany, dryRun: true })).status).toBe(400);
    expect((await supervisor.post(url('/import')).send({ rows: [row()], dryRun: true })).status).toBe(403);
    expect((await teacher.post(url('/import')).send({ rows: [row()], dryRun: true })).status).toBe(403);
    expect((await adminB.post(url('/import')).send({ rows: [row()], dryRun: true })).status).toBe(403);
  });
});

describe('GET /guardians and activation codes', () => {
  it('lists the school’s guardians with their children', async () => {
    const res = await admin.get(guardiansUrl());
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{
      userId: string;
      fullName: string;
      status: string;
      canIssueCode: boolean;
      children: Array<{ studentId: string; fullName: string; classLabel: string | null }>;
    }>;
    expect(res.body.total).toBe(items.length);
    const g1 = items.find((g) => g.userId === t.fx.users.guardian.id)!;
    // Only this school's children (s4 is in school B).
    expect(g1.children.map((c) => c.studentId)).not.toContain(t.fx.students.s4.id);
    expect(g1.children.find((c) => c.studentId === t.fx.students.s1.id)).toMatchObject({
      fullName: 'مصعب إبراهيم عبدالله',
      classLabel: 'الصف الخامس - أ',
    });
    expect(g1.canIssueCode).toBe(false);
    // School B's teacher was linked as a guardian above, so it is listed, but cannot be reset from here.
    expect(items.find((g) => g.fullName === 'موظف ب')!.canIssueCode).toBe(false);
  });

  it('searches by guardian name, phone or child name, and filters by status', async () => {
    const byPhone = await admin.get(guardiansUrl('?q=0917000001'));
    expect(byPhone.body.items.map((g: { fullName: string }) => g.fullName)).toEqual(['عوض محمد أحمد']);
    const byIntlPhone = await admin.get(guardiansUrl(`?q=${encodeURIComponent('249917000001')}`));
    expect(byIntlPhone.body.total).toBe(1);
    const byChild = await admin.get(guardiansUrl(`?q=${encodeURIComponent('مصعب')}`));
    expect(byChild.body.items.map((g: { userId: string }) => g.userId)).toEqual([t.fx.users.guardian.id]);
    const byName = await admin.get(guardiansUrl(`?q=${encodeURIComponent('عوض احمد')}`));
    expect(byName.body.total).toBe(1);
    const pending = await admin.get(guardiansUrl('?status=pending'));
    expect(pending.body.items.every((g: { status: string }) => g.status === 'pending')).toBe(true);
    expect(pending.body.total).toBeGreaterThan(0);
    const page = await admin.get(guardiansUrl('?limit=1'));
    expect(page.body.items).toHaveLength(1);
    expect((await admin.get(guardiansUrl('?status=x'))).status).toBe(400);
  });

  it('issues an activation code for a guardian of the school', async () => {
    const [awad] = (await admin.get(guardiansUrl('?q=0917000001'))).body.items as Array<{ userId: string }>;
    const res = await admin.post(guardiansUrl(`/${awad.userId}/activation-code`));
    expect(res.status).toBe(201);
    expect(res.body.code).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const activate = await t.anon().post('/api/auth/activate').send({ code: res.body.code });
    expect(activate.status).toBe(200);
  });

  it('refuses accounts used by another school and users that are not the school’s guardians', async () => {
    const shared = await admin.post(guardiansUrl(`/${t.fx.users.guardian.id}/activation-code`));
    expect(shared.status).toBe(403);
    const notGuardian = await admin.post(guardiansUrl(`/${t.fx.users.teacher.id}/activation-code`));
    expect(notGuardian.status).toBe(404);
    expect((await admin.post(guardiansUrl('/nope/activation-code'))).status).toBe(400);
  });

  it('is for this school’s admins only', async () => {
    expect((await supervisor.get(guardiansUrl())).status).toBe(403);
    expect((await teacher.get(guardiansUrl())).status).toBe(403);
    expect((await guardian.get(guardiansUrl())).status).toBe(403);
    expect((await adminB.get(guardiansUrl())).status).toBe(403);
    expect((await adminB.post(guardiansUrl(`/${t.fx.users.guardian2.id}/activation-code`))).status).toBe(403);
    // School B's admin cannot reach school A's guardians through school B either.
    const viaB = await adminB.post(
      `/api/schools/${t.fx.schoolB.id}/guardians/${t.fx.users.guardian2.id}/activation-code`,
    );
    expect(viaB.status).toBe(404);
  });
});

describe('large import', () => {
  it('imports the maximum of 2,000 rows in one request', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      studentFirstName: `طالب${i}`,
      studentFatherName: 'محمد',
      studentGrandfatherName: 'أحمد',
      studentGreatGrandfatherName: 'علي',
      gender: i % 2 ? 'ذكر' : 'أنثى',
      gradeLevel: 'الصف السادس',
      classSection: 'أ',
      birthDate: '2014-01-15',
      guardianName: `ولي أمر ${Math.floor(i / 2)}`,
      guardianPhone: `0955${String(Math.floor(i / 2)).padStart(6, '0')}`,
      relation: 'والد',
      motherName: 'فاطمة محمد علي',
      motherPhone: '0911222333',
    }));
    // Batched inserts (500 rows per statement) keep this to a few dozen queries.
    const res = await admin.post(url('/import')).send({ dryRun: false, rows });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    expect(res.body.created).toBe(2000);
    expect(res.body.codes).toHaveLength(1000);
    const codes = new Set((await t.db.select({ code: s.students.code }).from(s.students)).map((r) => r.code));
    expect(codes.has('S-2010')).toBe(true);
  }, 120_000);
});
