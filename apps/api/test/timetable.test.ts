import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { setupTestApp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.close());

const base = () => `/api/schools/${t.fx.schoolA.id}/timetable`;
const SUNDAY = 0;
const MONDAY = 1;

interface Slot {
  id: string;
  weekday: number;
  period: number;
  subjectId: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
}

describe('class timetable builder (S16)', () => {
  it('saves a day and returns it with subject and teacher names', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.put(`${base()}/class/${t.fx.class5a.id}/${SUNDAY}`).send({
      slots: [
        { period: 2, subjectId: t.fx.arabic.id, teacherId: t.fx.users.teacher2.id },
        { period: 1, subjectId: t.fx.math.id, teacherId: t.fx.users.teacher.id },
        { period: 3, subjectId: t.fx.science.id },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((x: Slot) => [x.weekday, x.period, x.subjectName, x.teacherName])).toEqual([
      [SUNDAY, 1, 'الرياضيات', 'أستاذ أ'],
      [SUNDAY, 2, 'اللغة العربية', 'أستاذ ثاني'],
      [SUNDAY, 3, 'العلوم', null],
    ]);
    expect(res.body[0]).toMatchObject({ subjectId: t.fx.math.id, teacherId: t.fx.users.teacher.id });
    expect(typeof res.body[0].id).toBe('string');
  });

  it('a supervisor can be the teacher of a period', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.put(`${base()}/class/${t.fx.class5a.id}/${MONDAY}`).send({
      slots: [{ period: 1, subjectId: t.fx.science.id, teacherId: t.fx.users.supervisor.id }],
    });
    expect(res.status).toBe(200);
    expect(res.body[0].teacherName).toBe('مشرف أ');
  });

  it('returns the whole week sorted by day and period', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const res = await agent.get(`${base()}/class/${t.fx.class5a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.map((x: Slot) => `${x.weekday}:${x.period}`)).toEqual(['0:1', '0:2', '0:3', '1:1']);
    const monday = await agent.get(`${base()}/class/${t.fx.class5a.id}`).query({ weekday: MONDAY });
    expect(monday.body.map((x: Slot) => x.period)).toEqual([1]);
  });

  it('rejects a teacher already teaching another class at the same period (409)', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.put(`${base()}/class/${t.fx.class5b.id}/${SUNDAY}`).send({
      slots: [{ period: 1, subjectId: t.fx.arabic.id, teacherId: t.fx.users.teacher.id }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('الصف الخامس - أ');
    expect(res.body.error.message).toContain('أستاذ أ');
    // Nothing was written.
    expect((await agent.get(`${base()}/class/${t.fx.class5b.id}`)).body).toEqual([]);

    const other = await agent.put(`${base()}/class/${t.fx.class5b.id}/${SUNDAY}`).send({
      slots: [{ period: 2, subjectId: t.fx.arabic.id, teacherId: t.fx.users.teacher.id }],
    });
    expect(other.status).toBe(200);
  });

  it('replaces only that class and weekday; re-saving the same class is not a conflict', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.put(`${base()}/class/${t.fx.class5a.id}/${SUNDAY}`).send({
      slots: [
        { period: 1, subjectId: t.fx.math.id, teacherId: t.fx.users.teacher.id },
        { period: 4, subjectId: t.fx.math.id, teacherId: t.fx.users.teacher.id },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((x: Slot) => x.period)).toEqual([1, 4]);
    const week = await agent.get(`${base()}/class/${t.fx.class5a.id}`);
    expect(week.body.map((x: Slot) => `${x.weekday}:${x.period}`)).toEqual(['0:1', '0:4', '1:1']);
    const other = await agent.get(`${base()}/class/${t.fx.class5b.id}`);
    expect(other.body).toHaveLength(1);
  });

  it('an empty list clears the day', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.put(`${base()}/class/${t.fx.class6a.id}/${SUNDAY}`).send({
      slots: [{ period: 1, subjectId: t.fx.math.id }],
    });
    expect(res.status).toBe(200);
    const cleared = await agent.put(`${base()}/class/${t.fx.class6a.id}/${SUNDAY}`).send({ slots: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual([]);
  });
});

describe('validation', () => {
  it('rejects bad periods, duplicates and bad weekdays', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const url = `${base()}/class/${t.fx.class6a.id}`;
    const dup = await agent.put(`${url}/${SUNDAY}`).send({
      slots: [
        { period: 1, subjectId: t.fx.math.id },
        { period: 1, subjectId: t.fx.arabic.id },
      ],
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details[0]).toEqual({ path: 'slots.1.period', message: 'الحصة مكررة' });
    for (const period of [0, 9, 1.5, '1']) {
      const res = await agent.put(`${url}/${SUNDAY}`).send({ slots: [{ period, subjectId: t.fx.math.id }] });
      expect(res.status).toBe(400);
    }
    expect((await agent.put(`${url}/7`).send({ slots: [] })).status).toBe(400);
    expect((await agent.put(`${url}/x`).send({ slots: [] })).status).toBe(400);
    expect((await agent.put(`${url}/${SUNDAY}`).send({})).status).toBe(400);
    expect((await agent.get(url).query({ weekday: '9' })).status).toBe(400);
    expect((await agent.get(`${base()}/class/not-a-uuid`)).status).toBe(400);
  });

  it("rejects another school's subject, and teachers who are not teaching staff of the school", async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const url = `${base()}/class/${t.fx.class6a.id}/${SUNDAY}`;
    const subject = await agent.put(url).send({ slots: [{ period: 1, subjectId: t.fx.mathB.id }] });
    expect(subject.status).toBe(404);
    for (const user of [t.fx.users.guardian, t.fx.users.adminB, t.fx.users.admin]) {
      const res = await agent.put(url).send({ slots: [{ period: 1, subjectId: t.fx.math.id, teacherId: user.id }] });
      expect(res.status).toBe(400);
    }
    expect((await agent.put(`${base()}/class/${t.fx.classB.id}/${SUNDAY}`).send({ slots: [] })).status).toBe(404);
  });
});

describe('authorization', () => {
  it('teachers can view the classes they teach but not edit any', async () => {
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    expect((await teacher.get(`${base()}/class/${t.fx.class5a.id}`)).status).toBe(200);
    expect((await teacher.get(`${base()}/class/${t.fx.class6a.id}`)).status).toBe(403);
    const put = await teacher.put(`${base()}/class/${t.fx.class5a.id}/${SUNDAY}`).send({ slots: [] });
    expect(put.status).toBe(403);
    const teacher2 = await t.loginAs(t.fx.users.teacher2.phone);
    expect((await teacher2.get(`${base()}/class/${t.fx.class5b.id}`)).status).toBe(403);
  });

  it('guardians cannot call staff routes', async () => {
    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    expect((await guardian.get(`${base()}/class/${t.fx.class5a.id}`)).status).toBe(403);
    expect((await guardian.get(`${base()}/mine`)).status).toBe(403);
    expect((await guardian.put(`${base()}/class/${t.fx.class5a.id}/${SUNDAY}`).send({ slots: [] })).status).toBe(403);
  });

  it("another school's admin is denied", async () => {
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`${base()}/class/${t.fx.class5a.id}`)).status).toBe(403);
    expect((await adminB.put(`${base()}/class/${t.fx.class5a.id}/${SUNDAY}`).send({ slots: [] })).status).toBe(403);
    const own = `/api/schools/${t.fx.schoolB.id}/timetable`;
    expect((await adminB.get(`${own}/class/${t.fx.class5a.id}`)).status).toBe(404);
    expect((await adminB.put(`${own}/class/${t.fx.class5a.id}/${SUNDAY}`).send({ slots: [] })).status).toBe(404);
    // School A's slots are untouched.
    const rows = await t.db
      .select()
      .from(s.timetableSlots)
      .where(and(eq(s.timetableSlots.classSectionId, t.fx.class5a.id), eq(s.timetableSlots.weekday, SUNDAY)));
    expect(rows).toHaveLength(2);
  });
});

describe('my timetable (T8)', () => {
  it("lists the teacher's own periods across classes, sorted, filterable by weekday", async () => {
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    const res = await teacher.get(`${base()}/mine`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { weekday: SUNDAY, period: 1, classId: t.fx.class5a.id, classLabel: 'الصف الخامس - أ', subjectName: 'الرياضيات' },
      {
        weekday: SUNDAY,
        period: 2,
        classId: t.fx.class5b.id,
        classLabel: 'الصف الخامس - ب',
        subjectName: 'اللغة العربية',
      },
      { weekday: SUNDAY, period: 4, classId: t.fx.class5a.id, classLabel: 'الصف الخامس - أ', subjectName: 'الرياضيات' },
    ]);
    const monday = await teacher.get(`${base()}/mine`).query({ weekday: MONDAY });
    expect(monday.body).toEqual([]);
    expect((await teacher.get(`${base()}/mine`).query({ weekday: '8' })).status).toBe(400);
  });

  it('supervisors get their own periods too', async () => {
    const supervisor = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await supervisor.get(`${base()}/mine`).query({ weekday: MONDAY });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { weekday: MONDAY, period: 1, classId: t.fx.class5a.id, classLabel: 'الصف الخامس - أ', subjectName: 'العلوم' },
    ]);
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`/api/schools/${t.fx.schoolB.id}/timetable/mine`)).body).toEqual([]);
  });
});
