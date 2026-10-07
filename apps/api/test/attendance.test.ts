import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { addDays, monthBounds, todayIn, weekdayOf } from '@slash/shared';
import * as s from '../src/db/schema';
import { setupTestApp, type TestContext } from './helpers';

let t: TestContext;
let today: string;
/** A fixed school day inside the fixture's academic year (2025-07-01 … 2026-06-30). */
const PAST = '2025-10-05';

beforeAll(async () => {
  t = await setupTestApp();
  today = todayIn(t.fx.schoolA.timezone);
});
afterAll(() => t.close());

const base = () => `/api/schools/${t.fx.schoolA.id}/attendance`;

async function auditRows(entityId: string) {
  return t.db
    .select()
    .from(s.auditLogs)
    .where(and(eq(s.auditLogs.entity, 'attendance_session'), eq(s.auditLogs.entityId, entityId)));
}

async function sessionId(classSectionId: string, date: string) {
  const [row] = await t.db
    .select({ id: s.attendanceSessions.id })
    .from(s.attendanceSessions)
    .where(and(eq(s.attendanceSessions.classSectionId, classSectionId), eq(s.attendanceSessions.date, date)));
  return row?.id;
}

describe('staff: record and edit absence', () => {
  it('shows an unrecorded checklist of the active students', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.get(`${base()}/${t.fx.class5a.id}/${PAST}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      classSectionId: t.fx.class5a.id,
      classLabel: 'الصف الخامس - أ',
      date: PAST,
      recorded: false,
      recordedByName: null,
      updatedAt: null,
    });
    expect(res.body.students).toHaveLength(3);
    expect(res.body.students.every((x: { absent: boolean }) => !x.absent)).toBe(true);
  });

  it('records absences with notes (S9) and returns the checklist', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent
      .put(`${base()}/${t.fx.class5a.id}/${PAST}`)
      .send({
        absentStudentIds: [t.fx.students.s1.id, t.fx.students.s2.id],
        notes: { [t.fx.students.s2.id]: ' مريض ' },
      });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
    expect(res.body.recordedByName).toBe('مشرف أ');
    expect(typeof res.body.updatedAt).toBe('string');
    const byId = new Map(res.body.students.map((x: { id: string; absent: boolean; note: string | null }) => [x.id, x]));
    expect(byId.get(t.fx.students.s1.id)).toMatchObject({ absent: true, note: null });
    expect(byId.get(t.fx.students.s2.id)).toMatchObject({ absent: true, note: 'مريض' });
    expect(byId.get(t.fx.students.s3.id)).toMatchObject({ absent: false, note: null });

    const again = await agent.get(`${base()}/${t.fx.class5a.id}/${PAST}`);
    expect(again.body).toEqual(res.body);

    const id = await sessionId(t.fx.class5a.id, PAST);
    const logs = await auditRows(id!);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('create');
    expect(logs[0].before).toBeNull();
    expect((logs[0].after as { absentStudentIds: string[] }).absentStudentIds).toEqual(
      [t.fx.students.s1.id, t.fx.students.s2.id].sort(),
    );
  });

  it('is idempotent: repeating the same save changes nothing', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const before = await agent.get(`${base()}/${t.fx.class5a.id}/${PAST}`);
    const res = await agent
      .put(`${base()}/${t.fx.class5a.id}/${PAST}`)
      .send({
        absentStudentIds: [t.fx.students.s2.id, t.fx.students.s1.id, t.fx.students.s1.id],
        notes: { [t.fx.students.s2.id]: 'مريض' },
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(before.body);
    const sessions = await t.db
      .select()
      .from(s.attendanceSessions)
      .where(eq(s.attendanceSessions.classSectionId, t.fx.class5a.id));
    expect(sessions).toHaveLength(1);
    expect(await auditRows(sessions[0].id)).toHaveLength(1);
  });

  it('updates the absent set (S10), audits before/after, and keeps the session', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    const id = await sessionId(t.fx.class5a.id, PAST);
    const res = await agent
      .put(`${base()}/${t.fx.class5a.id}/${PAST}`)
      .send({ absentStudentIds: [t.fx.students.s1.id] });
    expect(res.status).toBe(200);
    expect(res.body.recordedByName).toBe('مدير أ');
    expect(res.body.students.filter((x: { absent: boolean }) => x.absent).map((x: { id: string }) => x.id)).toEqual([
      t.fx.students.s1.id,
    ]);
    expect(await sessionId(t.fx.class5a.id, PAST)).toBe(id);
    const logs = await auditRows(id!);
    expect(logs).toHaveLength(2);
    const update = logs.find((l) => l.action === 'update')!;
    expect((update.before as { absentStudentIds: string[] }).absentStudentIds).toEqual(
      [t.fx.students.s1.id, t.fx.students.s2.id].sort(),
    );
    expect((update.after as { absentStudentIds: string[] }).absentStudentIds).toEqual([t.fx.students.s1.id]);
  });

  it('records "everyone present" with an empty list', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.put(`${base()}/${t.fx.class6a.id}/${PAST}`).send({ absentStudentIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recorded: true, students: [] });
  });

  it("lists today's classes with recorded / not recorded", async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const put = await agent
      .put(`${base()}/${t.fx.class5b.id}/${today}`)
      .send({ absentStudentIds: [t.fx.students.s5.id] });
    expect(put.status).toBe(200);
    const res = await agent.get(`${base()}/today`);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today);
    expect(res.body.classes).toEqual([
      { classId: t.fx.class5a.id, label: 'الصف الخامس - أ', studentCount: 3, recorded: false, absentCount: 0 },
      { classId: t.fx.class5b.id, label: 'الصف الخامس - ب', studentCount: 1, recorded: true, absentCount: 1 },
      { classId: t.fx.class6a.id, label: 'الصف السادس - أ', studentCount: 0, recorded: false, absentCount: 0 },
    ]);
  });

  it('lists recorded sessions of a class newest first, with an optional date range', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const older = addDays(PAST, -3);
    expect((await agent.put(`${base()}/${t.fx.class5a.id}/${older}`).send({ absentStudentIds: [] })).status).toBe(200);
    const res = await agent.get(`${base()}/sessions`).query({ classId: t.fx.class5a.id });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ date: PAST, absentCount: 1, recordedByName: 'مدير أ' });
    expect(res.body[1]).toMatchObject({ date: older, absentCount: 0, recordedByName: 'مشرف أ' });
    expect(typeof res.body[0].updatedAt).toBe('string');

    const ranged = await agent.get(`${base()}/sessions`).query({ classId: t.fx.class5a.id, from: PAST, to: PAST });
    expect(ranged.body.map((x: { date: string }) => x.date)).toEqual([PAST]);
  });
});

describe('staff: validation', () => {
  it('rejects future dates, dates before the academic year and malformed dates', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const future = await agent.put(`${base()}/${t.fx.class5a.id}/${addDays(today, 1)}`).send({ absentStudentIds: [] });
    expect(future.status).toBe(400);
    const early = await agent.put(`${base()}/${t.fx.class5a.id}/2025-06-30`).send({ absentStudentIds: [] });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toContain('بداية العام الدراسي');
    expect((await agent.get(`${base()}/${t.fx.class5a.id}/2025-13-01`)).status).toBe(400);
    expect((await agent.put(`${base()}/${t.fx.class5a.id}/05-10-2025`).send({ absentStudentIds: [] })).status).toBe(
      400,
    );
  });

  it('rejects a malformed body', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const missing = await agent.put(`${base()}/${t.fx.class5a.id}/${PAST}`).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('absentStudentIds');
    const badId = await agent.put(`${base()}/${t.fx.class5a.id}/${PAST}`).send({ absentStudentIds: ['nope'] });
    expect(badId.status).toBe(400);
    const badNote = await agent
      .put(`${base()}/${t.fx.class5a.id}/${PAST}`)
      .send({ absentStudentIds: [t.fx.students.s1.id], notes: { [t.fx.students.s1.id]: 'x'.repeat(501) } });
    expect(badNote.status).toBe(400);
  });

  it('rejects students outside the class or not active', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const other = await agent
      .put(`${base()}/${t.fx.class5a.id}/${PAST}`)
      .send({ absentStudentIds: [t.fx.students.s5.id] });
    expect(other.status).toBe(400);
    const otherSchool = await agent
      .put(`${base()}/${t.fx.class5a.id}/${PAST}`)
      .send({ absentStudentIds: [t.fx.students.s4.id] });
    expect(otherSchool.status).toBe(400);

    const [withdrawn] = await t.db
      .insert(s.students)
      .values({
        schoolId: t.fx.schoolA.id,
        classSectionId: t.fx.class5a.id,
        gradeLevelId: t.fx.grade5.id,
        code: 'S-90',
        firstName: 'منسحب',
        fatherName: 'أ',
        grandfatherName: 'ب',
        gender: 'male',
        registeredAt: '2025-07-01',
        status: 'withdrawn',
      })
      .returning();
    const inactive = await agent.put(`${base()}/${t.fx.class5a.id}/${PAST}`).send({ absentStudentIds: [withdrawn.id] });
    expect(inactive.status).toBe(400);
    const list = await agent.get(`${base()}/${t.fx.class5a.id}/${PAST}`);
    expect(list.body.students.map((x: { id: string }) => x.id)).not.toContain(withdrawn.id);
  });

  it('rejects an inverted session range and an unknown class', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const inverted = await agent
      .get(`${base()}/sessions`)
      .query({ classId: t.fx.class5a.id, from: '2025-10-05', to: '2025-10-01' });
    expect(inverted.status).toBe(400);
    expect((await agent.get(`${base()}/sessions`)).status).toBe(400);
    expect((await agent.get(`${base()}/${t.fx.classB.id}/${PAST}`)).status).toBe(404);
    expect((await agent.put(`${base()}/${t.fx.classB.id}/${PAST}`).send({ absentStudentIds: [] })).status).toBe(404);
  });
});

describe('staff: authorization', () => {
  it('teachers cannot read or record absence', async () => {
    const agent = await t.loginAs(t.fx.users.teacher.phone);
    expect((await agent.get(`${base()}/today`)).status).toBe(403);
    expect((await agent.get(`${base()}/sessions`).query({ classId: t.fx.class5a.id })).status).toBe(403);
    expect((await agent.get(`${base()}/${t.fx.class5a.id}/${PAST}`)).status).toBe(403);
    expect((await agent.put(`${base()}/${t.fx.class5a.id}/${PAST}`).send({ absentStudentIds: [] })).status).toBe(403);
  });

  it('guardians cannot call staff routes', async () => {
    const agent = await t.loginAs(t.fx.users.guardian.phone);
    expect((await agent.get(`${base()}/today`)).status).toBe(403);
    expect((await agent.put(`${base()}/${t.fx.class5a.id}/${PAST}`).send({ absentStudentIds: [] })).status).toBe(403);
  });

  it("another school's admin is denied", async () => {
    const agent = await t.loginAs(t.fx.users.adminB.phone);
    expect((await agent.get(`${base()}/today`)).status).toBe(403);
    expect((await agent.get(`${base()}/${t.fx.class5a.id}/${PAST}`)).status).toBe(403);
    // Through their own school, school A's class is not found.
    const own = `/api/schools/${t.fx.schoolB.id}/attendance`;
    expect((await agent.get(`${own}/${t.fx.class5a.id}/${PAST}`)).status).toBe(404);
    expect((await agent.put(`${own}/${t.fx.class5a.id}/${PAST}`).send({ absentStudentIds: [] })).status).toBe(404);
    expect((await agent.get(`${own}/sessions`).query({ classId: t.fx.class5a.id })).status).toBe(404);
    const todayB = await agent.get(`${own}/today`);
    expect(todayB.status).toBe(200);
    expect(todayB.body.classes.map((c: { classId: string }) => c.classId)).toEqual([t.fx.classB.id]);
  });
});

describe('guardian: P8', () => {
  it('counts this month, the academic year total and lists the days newest first', async () => {
    const supervisor = await t.loginAs(t.fx.users.supervisor.phone);
    const prevMonthDay = addDays(monthBounds(today).from, -1);
    for (const date of [today, prevMonthDay]) {
      const res = await supervisor
        .put(`${base()}/${t.fx.class5a.id}/${date}`)
        .send({ absentStudentIds: [t.fx.students.s2.id], notes: { [t.fx.students.s2.id]: 'إذن' } });
      expect(res.status).toBe(200);
    }
    // An absence from the previous academic year is not part of the total.
    const [old] = await t.db
      .insert(s.attendanceSessions)
      .values({ schoolId: t.fx.schoolA.id, classSectionId: t.fx.class5a.id, date: '2025-06-15' })
      .returning();
    await t.db.insert(s.absences).values({ sessionId: old.id, studentId: t.fx.students.s2.id });

    const guardian2 = await t.loginAs(t.fx.users.guardian2.phone);
    const res = await guardian2.get(`/api/students/${t.fx.students.s2.id}/attendance`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      thisMonth: 1,
      total: 2,
      days: [
        { date: today, weekday: weekdayOf(today), note: 'إذن' },
        { date: prevMonthDay, weekday: weekdayOf(prevMonthDay), note: 'إذن' },
      ],
    });

    const [cursor] = await t.db
      .select()
      .from(s.readCursors)
      .where(and(eq(s.readCursors.userId, t.fx.users.guardian2.id), eq(s.readCursors.module, 'attendance')));
    expect(cursor?.studentId).toBe(t.fx.students.s2.id);
  });

  it("the guardian of s1 sees s1's absences only", async () => {
    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    const res = await guardian.get(`/api/students/${t.fx.students.s1.id}/attendance`);
    expect(res.status).toBe(200);
    expect(res.body.days.map((d: { date: string }) => d.date)).toEqual([PAST]);
    expect(res.body.total).toBe(1);
  });

  it("another student's guardian and another school's admin are denied", async () => {
    const guardian2 = await t.loginAs(t.fx.users.guardian2.phone);
    expect((await guardian2.get(`/api/students/${t.fx.students.s1.id}/attendance`)).status).toBe(403);
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`/api/students/${t.fx.students.s1.id}/attendance`)).status).toBe(403);
    const teacher2 = await t.loginAs(t.fx.users.teacher2.phone);
    expect((await teacher2.get(`/api/students/${t.fx.students.s5.id}/attendance`)).status).toBe(403);
  });

  it('staff can view a student (admin profile) without clearing the guardian badge', async () => {
    const admin = await t.loginAs(t.fx.users.admin.phone);
    const res = await admin.get(`/api/students/${t.fx.students.s1.id}/attendance`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const cursors = await t.db
      .select()
      .from(s.readCursors)
      .where(and(eq(s.readCursors.userId, t.fx.users.admin.id), eq(s.readCursors.module, 'attendance')));
    expect(cursors).toHaveLength(0);
  });
});
