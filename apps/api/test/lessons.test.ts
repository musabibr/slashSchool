import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { addDays, dateRangeBounds, DATE_RANGES, todayIn } from '@slash/shared';
import * as s from '../src/db/schema';
import { setupTestApp, type TestContext } from './helpers';

type Agent = Awaited<ReturnType<TestContext['loginAs']>>;

interface StaffLesson {
  id: string;
  classSectionId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  date: string;
  title: string;
  pages: string | null;
  details: string | null;
  hasHomework: boolean;
  homeworkDetails: string | null;
  homeworkDueDate: string | null;
  teacherId: string | null;
  teacherName: string | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number; url: string }>;
  homeworkDoneCount: number;
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface GuardianLesson {
  id: string;
  subjectId: string;
  date: string;
  title: string;
  hasHomework: boolean;
  isNew: boolean;
  attachments: unknown[];
  done?: boolean;
}

interface SubjectTile {
  id: string;
  name: string;
  badge: number;
  lastDate: string | null;
}

let t: TestContext;
let admin: Agent;
let supervisor: Agent;
let teacher: Agent;
let teacher2: Agent;
let guardian: Agent;
let guardian2: Agent;
let adminB: Agent;
let today: string;

const staffUrl = (path = '') => `/api/schools/${t.fx.schoolA.id}/lessons${path}`;
const studentUrl = (studentId: string, path: string) => `/api/students/${studentId}${path}`;

/** Math in 5-أ: the teacher's own assignment. */
const mathLesson = (over: Record<string, unknown> = {}) => ({
  classSectionId: t.fx.class5a.id,
  subjectId: t.fx.math.id,
  title: 'الكسور العشرية',
  pages: '15 - 50',
  details: 'مقدمة عن الكسور',
  hasHomework: true,
  homeworkDetails: 'حل تمارين صفحة 20',
  ...over,
});

async function create(agent: Agent, body: Record<string, unknown>): Promise<StaffLesson> {
  const res = await agent.post(staffUrl()).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as StaffLesson;
}

async function upload(agent: Agent, schoolId: string, name = 'ورقة.pdf', type = 'application/pdf'): Promise<string> {
  const res = await agent
    .post(`/api/schools/${schoolId}/files`)
    .set('Content-Type', type)
    .set('X-File-Name', encodeURIComponent(name))
    .send(Buffer.from('%PDF-1.4 test'));
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const paths = (res: { body: { error?: { details?: Array<{ path: string }> } } }) =>
  (res.body.error?.details ?? []).map((d) => d.path);

beforeAll(async () => {
  t = await setupTestApp();
  const u = t.fx.users;
  [admin, supervisor, teacher, teacher2, guardian, guardian2, adminB] = await Promise.all(
    [u.admin, u.supervisor, u.teacher, u.teacher2, u.guardian, u.guardian2, u.adminB].map((x) => t.loginAs(x.phone)),
  );
  today = todayIn(t.fx.schoolA.timezone);
});
afterAll(() => t.close());

describe('staff: create', () => {
  it('teacher adds a lesson with homework and an attachment (date defaults to school today)', async () => {
    const fileId = await upload(teacher, t.fx.schoolA.id);
    const lesson = await create(
      teacher,
      mathLesson({ attachmentIds: [fileId, fileId], homeworkDueDate: addDays(today, 2) }),
    );
    expect(lesson).toMatchObject({
      classSectionId: t.fx.class5a.id,
      classLabel: 'الصف الخامس - أ',
      subjectId: t.fx.math.id,
      subjectName: 'الرياضيات',
      date: today,
      title: 'الكسور العشرية',
      pages: '15 - 50',
      details: 'مقدمة عن الكسور',
      hasHomework: true,
      homeworkDetails: 'حل تمارين صفحة 20',
      homeworkDueDate: addDays(today, 2),
      teacherId: t.fx.users.teacher.id,
      teacherName: 'أستاذ أ',
      homeworkDoneCount: 0,
      studentCount: 3,
    });
    expect(lesson.attachments).toEqual([
      { id: fileId, fileName: 'ورقة.pdf', mimeType: 'application/pdf', size: 13, url: `/api/files/${fileId}` },
    ]);
    expect(typeof lesson.createdAt).toBe('string');
  });

  it('clears homework fields when there is no homework; optional text may be empty', async () => {
    const lesson = await create(
      teacher,
      mathLesson({ hasHomework: false, homeworkDueDate: today, pages: '', details: null, date: '2025-10-01' }),
    );
    expect(lesson).toMatchObject({
      date: '2025-10-01',
      hasHomework: false,
      homeworkDetails: null,
      homeworkDueDate: null,
      pages: null,
      details: null,
      attachments: [],
    });
  });

  it('validates input with per-field messages', async () => {
    const empty = await teacher.post(staffUrl()).send({});
    expect(empty.status).toBe(400);
    expect(paths(empty)).toEqual(expect.arrayContaining(['classSectionId', 'subjectId', 'title', 'hasHomework']));

    const noDetails = await teacher.post(staffUrl()).send(mathLesson({ homeworkDetails: '  ' }));
    expect(noDetails.status).toBe(400);
    expect(paths(noDetails)).toEqual(['homeworkDetails']);
    expect(noDetails.body.error.details[0].message).toBe('تفاصيل الواجب المنزلي مطلوبة');

    const early = await teacher
      .post(staffUrl())
      .send(mathLesson({ date: '2025-10-10', homeworkDueDate: '2025-10-09' }));
    expect(early.status).toBe(400);
    expect(paths(early)).toEqual(['homeworkDueDate']);

    const badDate = await teacher.post(staffUrl()).send(mathLesson({ date: '2025-02-30' }));
    expect(badDate.status).toBe(400);
    expect(paths(badDate)).toEqual(['date']);

    const blankTitle = await teacher.post(staffUrl()).send(mathLesson({ title: '   ' }));
    expect(blankTitle.status).toBe(400);
    expect(paths(blankTitle)).toEqual(['title']);

    const tooMany = await teacher
      .post(staffUrl())
      .send(mathLesson({ attachmentIds: Array.from({ length: 11 }, () => crypto.randomUUID()) }));
    expect(tooMany.status).toBe(400);
    expect(paths(tooMany)).toEqual(['attachmentIds']);

    const badHw = await teacher.post(staffUrl()).send(mathLesson({ hasHomework: 'yes' }));
    expect(badHw.status).toBe(400);
  });

  it('rejects attachments and classes that do not belong to the school', async () => {
    const otherFile = await upload(adminB, t.fx.schoolB.id);
    const res = await teacher.post(staffUrl()).send(mathLesson({ attachmentIds: [otherFile] }));
    expect(res.status).toBe(404);
    const unknown = await teacher.post(staffUrl()).send(mathLesson({ attachmentIds: [crypto.randomUUID()] }));
    expect(unknown.status).toBe(404);
    const otherClass = await admin.post(staffUrl()).send(mathLesson({ classSectionId: t.fx.classB.id }));
    expect(otherClass.status).toBe(404);
    const otherSubject = await admin.post(staffUrl()).send(mathLesson({ subjectId: t.fx.mathB.id }));
    expect(otherSubject.status).toBe(404);
  });

  it('teachers can only add lessons to their own (class, subject) pairs', async () => {
    expect((await teacher.post(staffUrl()).send(mathLesson({ classSectionId: t.fx.class5b.id }))).status).toBe(403);
    expect((await teacher.post(staffUrl()).send(mathLesson({ subjectId: t.fx.arabic.id }))).status).toBe(403);
    expect((await teacher2.post(staffUrl()).send(mathLesson())).status).toBe(403);
  });

  it('admins and supervisors may add lessons to any class', async () => {
    const sup = await create(supervisor, mathLesson({ classSectionId: t.fx.class6a.id, subjectId: t.fx.science.id }));
    expect(sup).toMatchObject({ classLabel: 'الصف السادس - أ', teacherName: 'مشرف أ', studentCount: 0 });
    const adm = await create(admin, mathLesson({ subjectId: t.fx.arabic.id, hasHomework: false }));
    expect(adm.teacherId).toBe(t.fx.users.admin.id);
  });

  it("other schools' admins and guardians cannot use staff routes", async () => {
    expect((await adminB.post(staffUrl()).send(mathLesson())).status).toBe(403);
    expect((await adminB.get(staffUrl())).status).toBe(403);
    expect((await guardian.post(staffUrl()).send(mathLesson())).status).toBe(403);
    expect((await guardian.get(staffUrl())).status).toBe(403);
    expect((await t.anon().get(staffUrl())).status).toBe(401);
  });
});

describe('staff: list & read', () => {
  let older: StaffLesson;
  let newer: StaffLesson;
  let science6: StaffLesson;

  beforeAll(async () => {
    older = await create(teacher, mathLesson({ title: 'قديم', date: '2025-09-01', hasHomework: false }));
    newer = await create(teacher, mathLesson({ title: 'جديد', date: '2025-09-02', hasHomework: false }));
    science6 = await create(supervisor, mathLesson({ classSectionId: t.fx.class6a.id, subjectId: t.fx.science.id }));
    await create(teacher, mathLesson({ classSectionId: t.fx.class5b.id, subjectId: t.fx.arabic.id, title: 'نحو' }));
  });

  it('teachers see only lessons of their assignments, newest first', async () => {
    const res = await teacher.get(staffUrl());
    expect(res.status).toBe(200);
    const list = res.body as StaffLesson[];
    const pairs = new Set(list.map((l) => `${l.classSectionId}:${l.subjectId}`));
    expect([...pairs].sort()).toEqual(
      [`${t.fx.class5a.id}:${t.fx.math.id}`, `${t.fx.class5b.id}:${t.fx.arabic.id}`].sort(),
    );
    expect(list.some((l) => l.id === science6.id)).toBe(false);
    const keys = list.map((l) => `${l.date}|${l.createdAt}`);
    expect(keys).toEqual([...keys].sort().reverse());
    expect(list.findIndex((l) => l.id === newer.id)).toBeLessThan(list.findIndex((l) => l.id === older.id));
  });

  it('admins and supervisors see the whole school', async () => {
    const list = (await supervisor.get(staffUrl())).body as StaffLesson[];
    expect(list.some((l) => l.id === science6.id)).toBe(true);
    expect(list.some((l) => l.subjectId === t.fx.arabic.id && l.classSectionId === t.fx.class5a.id)).toBe(true);
  });

  it('filters by class, subject and dates, with paging', async () => {
    const byClass = (await admin.get(staffUrl(`?classId=${t.fx.class6a.id}`))).body as StaffLesson[];
    expect(byClass.length).toBeGreaterThan(0);
    expect(byClass.every((l) => l.classSectionId === t.fx.class6a.id)).toBe(true);

    const bySubject = (await admin.get(staffUrl(`?subjectId=${t.fx.arabic.id}&classId=`))).body as StaffLesson[];
    expect(bySubject.every((l) => l.subjectId === t.fx.arabic.id)).toBe(true);

    const range = (await teacher.get(staffUrl('?from=2025-09-01&to=2025-09-02'))).body as StaffLesson[];
    expect(range.map((l) => l.id)).toEqual([newer.id, older.id]);

    const page1 = (await teacher.get(staffUrl('?from=2025-09-01&to=2025-09-02&limit=1'))).body as StaffLesson[];
    const page2 = (await teacher.get(staffUrl('?from=2025-09-01&to=2025-09-02&limit=1&offset=1')))
      .body as StaffLesson[];
    expect(page1.map((l) => l.id)).toEqual([newer.id]);
    expect(page2.map((l) => l.id)).toEqual([older.id]);
  });

  it('rejects bad list parameters', async () => {
    expect((await admin.get(staffUrl('?limit=101'))).status).toBe(400);
    expect((await admin.get(staffUrl('?limit=0'))).status).toBe(400);
    expect((await admin.get(staffUrl('?offset=-1'))).status).toBe(400);
    expect((await admin.get(staffUrl('?classId=nope'))).status).toBe(400);
    expect((await admin.get(staffUrl('?from=2025-13-01'))).status).toBe(400);
  });

  it('reads one lesson within scope; 404 outside it', async () => {
    const own = await teacher.get(staffUrl(`/${older.id}`));
    expect(own.status).toBe(200);
    expect(own.body.title).toBe('قديم');
    expect((await teacher.get(staffUrl(`/${science6.id}`))).status).toBe(404);
    expect((await supervisor.get(staffUrl(`/${science6.id}`))).status).toBe(200);
    expect((await teacher.get(staffUrl(`/${crypto.randomUUID()}`))).status).toBe(404);
    expect((await teacher.get(staffUrl('/not-a-uuid'))).status).toBe(400);
    expect((await adminB.get(`/api/schools/${t.fx.schoolB.id}/lessons/${older.id}`)).status).toBe(404);
  });
});

describe('staff: update & delete', () => {
  let lesson: StaffLesson;
  let fileA: string;
  let fileB: string;

  beforeAll(async () => {
    fileA = await upload(teacher, t.fx.schoolA.id, 'a.png', 'image/png');
    fileB = await upload(teacher, t.fx.schoolA.id, 'b.pdf');
    lesson = await create(teacher, mathLesson({ date: '2025-10-05', attachmentIds: [fileA] }));
  });

  it('applies a partial update and keeps the other fields', async () => {
    const res = await teacher.patch(staffUrl(`/${lesson.id}`)).send({ title: 'عنوان معدل' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'عنوان معدل',
      pages: '15 - 50',
      details: 'مقدمة عن الكسور',
      hasHomework: true,
      homeworkDetails: 'حل تمارين صفحة 20',
      date: '2025-10-05',
    });
    expect(res.body.attachments.map((a: { id: string }) => a.id)).toEqual([fileA]);
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(lesson.updatedAt).getTime());
  });

  it('clears optional fields with null, replaces attachments, and validates homework', async () => {
    const cleared = await teacher
      .patch(staffUrl(`/${lesson.id}`))
      .send({ pages: null, attachmentIds: [fileB, fileA], homeworkDueDate: '2025-10-07' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.pages).toBeNull();
    expect(cleared.body.homeworkDueDate).toBe('2025-10-07');
    expect(cleared.body.attachments.map((a: { id: string }) => a.id).sort()).toEqual([fileA, fileB].sort());

    const tooLate = await teacher.patch(staffUrl(`/${lesson.id}`)).send({ date: '2025-10-08' });
    expect(tooLate.status).toBe(400);
    expect(paths(tooLate)).toEqual(['homeworkDueDate']);

    const noHw = await teacher.patch(staffUrl(`/${lesson.id}`)).send({ hasHomework: false, attachmentIds: [] });
    expect(noHw.status).toBe(200);
    expect(noHw.body).toMatchObject({
      hasHomework: false,
      homeworkDetails: null,
      homeworkDueDate: null,
      attachments: [],
    });

    const missing = await teacher.patch(staffUrl(`/${lesson.id}`)).send({ hasHomework: true });
    expect(missing.status).toBe(400);
    expect(paths(missing)).toEqual(['homeworkDetails']);

    const blank = await teacher.patch(staffUrl(`/${lesson.id}`)).send({ title: '' });
    expect(blank.status).toBe(400);

    const foreign = await teacher
      .patch(staffUrl(`/${lesson.id}`))
      .send({ attachmentIds: [await upload(adminB, t.fx.schoolB.id)] });
    expect(foreign.status).toBe(404);
  });

  it('moves a lesson only to a pair the teacher may teach', async () => {
    const denied = await teacher.patch(staffUrl(`/${lesson.id}`)).send({ subjectId: t.fx.science.id });
    expect(denied.status).toBe(403);
    const moved = await teacher
      .patch(staffUrl(`/${lesson.id}`))
      .send({ classSectionId: t.fx.class5b.id, subjectId: t.fx.arabic.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ classLabel: 'الصف الخامس - ب', subjectName: 'اللغة العربية', studentCount: 1 });
    const back = await teacher
      .patch(staffUrl(`/${lesson.id}`))
      .send({ classSectionId: t.fx.class5a.id, subjectId: t.fx.math.id });
    expect(back.status).toBe(200);
  });

  it('denies edits outside the teacher assignment or school', async () => {
    expect((await teacher2.patch(staffUrl(`/${lesson.id}`)).send({ title: 'x' })).status).toBe(403);
    const sup = await create(supervisor, mathLesson({ classSectionId: t.fx.class6a.id, subjectId: t.fx.science.id }));
    expect((await teacher.patch(staffUrl(`/${sup.id}`)).send({ title: 'x' })).status).toBe(403);
    expect((await teacher.delete(staffUrl(`/${sup.id}`))).status).toBe(403);
    expect(
      (await adminB.patch(`/api/schools/${t.fx.schoolB.id}/lessons/${lesson.id}`).send({ title: 'x' })).status,
    ).toBe(404);
    expect((await adminB.delete(`/api/schools/${t.fx.schoolB.id}/lessons/${lesson.id}`)).status).toBe(404);
    expect((await guardian.patch(staffUrl(`/${lesson.id}`)).send({ title: 'x' })).status).toBe(403);
    expect((await guardian.delete(staffUrl(`/${lesson.id}`))).status).toBe(403);
  });

  it('deletes a lesson', async () => {
    expect((await teacher2.delete(staffUrl(`/${lesson.id}`))).status).toBe(403);
    const res = await teacher.delete(staffUrl(`/${lesson.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await teacher.get(staffUrl(`/${lesson.id}`))).status).toBe(404);
    expect((await teacher.delete(staffUrl(`/${lesson.id}`))).status).toBe(404);
  });
});

describe('guardian: subjects, lessons and homework', () => {
  const s1 = () => t.fx.students.s1.id;
  const subjectsOf = async (agent: Agent, module: 'lessons' | 'homework', studentId = s1()) => {
    const res = await agent.get(studentUrl(studentId, `/subjects?module=${module}`));
    expect(res.status).toBe(200);
    return res.body as SubjectTile[];
  };
  const badgeOf = (tiles: SubjectTile[], subjectId: string) => tiles.find((x) => x.id === subjectId)?.badge;

  it('lists the class subjects with per-subject badges that clear when the subject is opened', async () => {
    // Start from a clean slate: open math and arabic lessons + homework.
    for (const sub of [t.fx.math.id, t.fx.arabic.id]) {
      expect((await guardian.get(studentUrl(s1(), `/lessons?subjectId=${sub}`))).status).toBe(200);
      expect((await guardian.get(studentUrl(s1(), `/homework?subjectId=${sub}`))).status).toBe(200);
    }
    expect(badgeOf(await subjectsOf(guardian, 'lessons'), t.fx.math.id)).toBe(0);

    await create(teacher, mathLesson({ title: 'ب1', hasHomework: false }));
    await create(teacher, mathLesson({ title: 'ب2', date: addDays(today, -1) }));
    await create(teacher2, mathLesson({ subjectId: t.fx.arabic.id, title: 'ب3', hasHomework: false }));

    const lessonsTiles = await subjectsOf(guardian, 'lessons');
    expect(lessonsTiles.map((x) => x.id)).toEqual(expect.arrayContaining([t.fx.math.id, t.fx.arabic.id]));
    expect(badgeOf(lessonsTiles, t.fx.math.id)).toBe(2);
    expect(badgeOf(lessonsTiles, t.fx.arabic.id)).toBe(1);
    expect(lessonsTiles.find((x) => x.id === t.fx.math.id)?.lastDate).toBe(today);

    const homeworkTiles = await subjectsOf(guardian, 'homework');
    expect(badgeOf(homeworkTiles, t.fx.math.id)).toBe(1);
    expect(badgeOf(homeworkTiles, t.fx.arabic.id)).toBe(0);

    // Opening the subjects grid clears the module-level (home) badge.
    const [cursor] = await t.db
      .select()
      .from(s.readCursors)
      .where(
        and(
          eq(s.readCursors.userId, t.fx.users.guardian.id),
          eq(s.readCursors.studentId, s1()),
          eq(s.readCursors.module, 'lessons'),
          eq(s.readCursors.scope, ''),
        ),
      );
    expect(cursor).toBeDefined();

    const opened = await guardian.get(studentUrl(s1(), `/lessons?subjectId=${t.fx.math.id}`));
    const fresh = (opened.body as GuardianLesson[]).filter((l) => l.isNew).map((l) => l.title);
    expect(fresh.sort()).toEqual(['ب1', 'ب2']);
    const after = await subjectsOf(guardian, 'lessons');
    expect(badgeOf(after, t.fx.math.id)).toBe(0);
    expect(badgeOf(after, t.fx.arabic.id)).toBe(1);
    // The homework badge is tracked separately.
    expect(badgeOf(await subjectsOf(guardian, 'homework'), t.fx.math.id)).toBe(1);
  });

  it('includes subjects that have lessons in the class without an assignment', async () => {
    await create(supervisor, mathLesson({ subjectId: t.fx.science.id, title: 'الخلية', hasHomework: false }));
    const lessonsTiles = await subjectsOf(guardian, 'lessons');
    expect(lessonsTiles.map((x) => x.name)).toEqual(['الرياضيات', 'اللغة العربية', 'العلوم']);
    // No homework in science → it is not offered in the homework grid.
    expect((await subjectsOf(guardian, 'homework')).some((x) => x.id === t.fx.science.id)).toBe(false);
  });

  it('staff viewing a student get no badges and do not clear the guardian cursors', async () => {
    const before = await t.db.select().from(s.readCursors).where(eq(s.readCursors.userId, t.fx.users.admin.id));
    const tiles = await subjectsOf(admin, 'lessons');
    expect(tiles.every((x) => x.badge === 0)).toBe(true);
    const lessons = await admin.get(studentUrl(s1(), `/lessons?subjectId=${t.fx.arabic.id}`));
    expect(lessons.status).toBe(200);
    expect((lessons.body as GuardianLesson[]).every((l) => !l.isNew)).toBe(true);
    const afterRows = await t.db.select().from(s.readCursors).where(eq(s.readCursors.userId, t.fx.users.admin.id));
    expect(afterRows).toHaveLength(before.length);
    expect(badgeOf(await subjectsOf(guardian, 'lessons'), t.fx.arabic.id)).toBe(1);
    // A teacher of the class can read too.
    expect((await teacher.get(studentUrl(s1(), '/lessons'))).status).toBe(200);
  });

  it('filters lessons by date range (week starts on the school week start)', async () => {
    const dates = [today, addDays(today, -3), addDays(today, -10), addDays(today, -40)];
    const created: StaffLesson[] = [];
    for (const date of dates) {
      created.push(
        await create(admin, mathLesson({ subjectId: t.fx.science.id, title: `مدى ${date}`, date, hasHomework: false })),
      );
    }
    for (const range of DATE_RANGES) {
      const res = await guardian.get(studentUrl(s1(), `/lessons?subjectId=${t.fx.science.id}&range=${range}`));
      expect(res.status).toBe(200);
      const got = (res.body as GuardianLesson[]).filter((l) => l.title.startsWith('مدى')).map((l) => l.id);
      const { from, to } = dateRangeBounds(range, today, t.fx.schoolA.weekStart);
      const expected = created
        .filter((l) => (!from || l.date >= from) && (!to || l.date <= to))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((l) => l.id);
      expect(got, range).toEqual(expected);
    }
    expect((await guardian.get(studentUrl(s1(), '/lessons?range=year'))).status).toBe(400);
    expect((await guardian.get(studentUrl(s1(), `/lessons?subjectId=${t.fx.mathB.id}`))).status).toBe(404);
  });

  it('only shows lessons of the student class', async () => {
    const other = await create(teacher, mathLesson({ classSectionId: t.fx.class5b.id, subjectId: t.fx.arabic.id }));
    const list = (await guardian.get(studentUrl(s1(), '/lessons'))).body as GuardianLesson[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((l) => l.id === other.id)).toBe(false);
    const hw = (await guardian.get(studentUrl(s1(), '/homework'))).body as GuardianLesson[];
    expect(hw.every((l) => l.hasHomework)).toBe(true);
    expect(hw.some((l) => l.id === other.id)).toBe(false);
  });

  it('guardians tick homework as done; staff see the count', async () => {
    const fileId = await upload(teacher, t.fx.schoolA.id, 'hw.png', 'image/png');
    const lesson = await create(teacher, mathLesson({ title: 'واجب الكسور', attachmentIds: [fileId] }));
    const listed = async () =>
      ((await guardian.get(studentUrl(s1(), `/homework?subjectId=${t.fx.math.id}`))).body as GuardianLesson[]).find(
        (l) => l.id === lesson.id,
      );
    expect(await listed()).toMatchObject({ done: false, attachments: [expect.objectContaining({ id: fileId })] });

    const tick = await guardian.put(studentUrl(s1(), `/homework/${lesson.id}/done`)).send({ done: true });
    expect(tick.status).toBe(200);
    expect(tick.body).toEqual({ lessonId: lesson.id, done: true });
    // Idempotent.
    expect((await guardian.put(studentUrl(s1(), `/homework/${lesson.id}/done`)).send({ done: true })).status).toBe(200);
    expect((await listed())?.done).toBe(true);
    const [row] = await t.db.select().from(s.homeworkDone).where(eq(s.homeworkDone.lessonId, lesson.id));
    expect(row.byUserId).toBe(t.fx.users.guardian.id);

    const staffView = await teacher.get(staffUrl(`/${lesson.id}`));
    expect(staffView.body).toMatchObject({ homeworkDoneCount: 1, studentCount: 3 });

    const untick = await guardian.put(studentUrl(s1(), `/homework/${lesson.id}/done`)).send({ done: false });
    expect(untick.status).toBe(200);
    expect((await listed())?.done).toBe(false);
    expect((await teacher.get(staffUrl(`/${lesson.id}`))).body.homeworkDoneCount).toBe(0);
  });

  it('validates and authorizes the done toggle', async () => {
    const noHw = await create(teacher, mathLesson({ hasHomework: false }));
    const withHw = await create(teacher, mathLesson());
    const other = await create(teacher, mathLesson({ classSectionId: t.fx.class5b.id, subjectId: t.fx.arabic.id }));
    const put = (agent: Agent, lessonId: string, body: unknown, studentId = s1()) =>
      agent.put(studentUrl(studentId, `/homework/${lessonId}/done`)).send(body as object);

    expect((await put(guardian, noHw.id, { done: true })).status).toBe(400);
    expect((await put(guardian, other.id, { done: true })).status).toBe(404);
    expect((await put(guardian, crypto.randomUUID(), { done: true })).status).toBe(404);
    expect((await put(guardian, 'nope', { done: true })).status).toBe(400);
    expect((await put(guardian, withHw.id, { done: 'yes' })).status).toBe(400);
    expect((await put(guardian, withHw.id, {})).status).toBe(400);
    // Staff can read a student's homework but cannot tick it.
    expect((await put(admin, withHw.id, { done: true })).status).toBe(403);
    expect((await put(teacher, withHw.id, { done: true })).status).toBe(403);
    // Another student's guardian / another school's admin.
    expect((await put(guardian2, withHw.id, { done: true })).status).toBe(403);
    expect((await put(adminB, withHw.id, { done: true })).status).toBe(403);
    // A guardian cannot tick another child's homework through their own child.
    expect((await put(guardian2, withHw.id, { done: true }, t.fx.students.s2.id)).status).toBe(200);
    const s1Done = await t.db
      .select()
      .from(s.homeworkDone)
      .where(and(eq(s.homeworkDone.lessonId, withHw.id), eq(s.homeworkDone.studentId, s1())));
    expect(s1Done).toHaveLength(0);
  });

  it("denies another student's guardian and other schools", async () => {
    for (const path of ['/subjects', '/lessons', '/homework']) {
      expect((await guardian2.get(studentUrl(s1(), path))).status).toBe(403);
      expect((await adminB.get(studentUrl(s1(), path))).status).toBe(403);
      expect((await teacher2.get(studentUrl(t.fx.students.s5.id, path))).status).toBe(403);
    }
    // The guardian's child in school B sees only school B lessons (none).
    expect((await guardian.get(studentUrl(t.fx.students.s4.id, '/lessons'))).body).toEqual([]);
    expect((await guardian.get(studentUrl(t.fx.students.s4.id, '/subjects'))).body).toEqual([]);
  });

  it('a student without a class gets empty lists', async () => {
    const [student] = await t.db
      .insert(s.students)
      .values({
        schoolId: t.fx.schoolA.id,
        code: 'S-NC',
        firstName: 'ليلى',
        fatherName: 'إبراهيم',
        grandfatherName: 'عبدالله',
        gender: 'female',
        registeredAt: '2025-07-01',
      })
      .returning();
    await t.db.insert(s.studentGuardians).values({
      schoolId: t.fx.schoolA.id,
      studentId: student.id,
      userId: t.fx.users.guardian2.id,
      relation: 'mother',
    });
    for (const path of ['/subjects?module=lessons', '/subjects?module=homework', '/lessons', '/homework?range=week']) {
      const res = await guardian2.get(studentUrl(student.id, path));
      expect(res.status, path).toBe(200);
      expect(res.body).toEqual([]);
    }
    const anyLesson = await create(teacher, mathLesson());
    expect(
      (await guardian2.put(studentUrl(student.id, `/homework/${anyLesson.id}/done`)).send({ done: true })).status,
    ).toBe(404);
    expect((await guardian2.get(studentUrl(student.id, '/subjects?module=fees'))).status).toBe(400);
  });
});
