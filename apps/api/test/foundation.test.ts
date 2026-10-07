import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import request from 'supertest';
import { createApp } from '../src/app';
import { issueActivationCode, issueStudentLinkCode } from '../src/lib/users';
import { DEMO_ACCOUNTS } from '../src/seed/demo-accounts';
import { PIN, setupTestApp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.close());

describe('auth', () => {
  it('rejects a wrong PIN and locks after 5 failures', async () => {
    const phone = t.fx.users.teacher2.phone;
    for (let i = 0; i < 5; i++) {
      const res = await t.anon().post('/api/auth/login').send({ phone, pin: '0000' });
      expect(res.status).toBe(401);
    }
    const locked = await t.anon().post('/api/auth/login').send({ phone, pin: PIN });
    expect(locked.status).toBe(423);
    await t.db.update(s.users).set({ lockedUntil: null }).where(eq(s.users.id, t.fx.users.teacher2.id));
  });

  it('pending users must activate first', async () => {
    const res = await t.anon().post('/api/auth/login').send({ phone: t.fx.users.pending.phone, pin: PIN });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_activated');
  });

  it('activation code → set PIN → logged in; code is single-use', async () => {
    const { code } = await issueActivationCode(t.db, t.fx.users.pending.id, null);
    const agent = t.anon();
    const preview = await agent.post('/api/auth/activate').send({ code: code.toLowerCase() });
    expect(preview.status).toBe(200);
    expect(preview.body.fullName).toBe('غير مفعل');
    const set = await agent.post('/api/auth/set-pin').send({ code, pin: '4321' });
    expect(set.status).toBe(200);
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.phone).toBe(t.fx.users.pending.phone);
    const again = await t.anon().post('/api/auth/activate').send({ code });
    expect(again.status).toBe(400);
    const login = await t.anon().post('/api/auth/login').send({ phone: t.fx.users.pending.phone, pin: '4321' });
    expect(login.status).toBe(200);
  });

  it('logout ends the session', async () => {
    const agent = await t.loginAs(t.fx.users.admin.phone);
    expect((await agent.get('/api/me')).status).toBe(200);
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  it('accepts a bearer token (for future native clients)', async () => {
    const res = await t.anon().post('/api/auth/login').send({ phone: t.fx.users.admin.phone, pin: PIN });
    const me = await t.anon().get('/api/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
  });
});

describe('me', () => {
  it('guardian sees children grouped with their schools', async () => {
    const agent = await t.loginAs(t.fx.users.guardian.phone);
    const res = await agent.get('/api/me');
    expect(res.body.children).toHaveLength(2);
    expect(res.body.children.map((c: { school: { id: string } }) => c.school.id).sort()).toEqual(
      [t.fx.schoolA.id, t.fx.schoolB.id].sort(),
    );
    expect(res.body.children.find((c: { id: string }) => c.id === t.fx.students.s1.id).classLabel).toBe(
      'الصف الخامس - أ',
    );
    expect(res.body.schools).toEqual([]);
  });

  it('staff see their schools and roles', async () => {
    const agent = await t.loginAs(t.fx.users.teacher.phone);
    const res = await agent.get('/api/me');
    expect(res.body.schools).toEqual([
      { id: t.fx.schoolA.id, name: t.fx.schoolA.name, code: 'TEST_A', roles: ['teacher'] },
    ]);
  });

  it('links another child with a student link code (single use)', async () => {
    const { code } = await issueStudentLinkCode(t.db, t.fx.students.s3.id);
    const agent = await t.loginAs(t.fx.users.guardian2.phone);
    const res = await agent.post('/api/me/children/link').send({ code });
    expect(res.status).toBe(201);
    const me = await agent.get('/api/me');
    expect(me.body.children.map((c: { id: string }) => c.id)).toContain(t.fx.students.s3.id);
    const reuse = await (await t.loginAs(t.fx.users.guardian.phone)).post('/api/me/children/link').send({ code });
    expect(reuse.status).toBe(400);
  });
});

describe('tenancy', () => {
  it('staff routes require a staff role in that school', async () => {
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`/api/schools/${t.fx.schoolA.id}/lookups/scope`)).status).toBe(403);
    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    expect((await guardian.get(`/api/schools/${t.fx.schoolA.id}/lookups/scope`)).status).toBe(403);
    expect((await t.anon().get(`/api/schools/${t.fx.schoolA.id}/lookups/scope`)).status).toBe(401);
  });

  it('teacher scope lists only assigned classes and subjects', async () => {
    const agent = await t.loginAs(t.fx.users.teacher.phone);
    const res = await agent.get(`/api/schools/${t.fx.schoolA.id}/lookups/scope`);
    expect(res.status).toBe(200);
    const classes = res.body.classes as Array<{ id: string; label: string; subjects: Array<{ id: string }> }>;
    expect(classes.map((c) => c.label)).toEqual(['الصف الخامس - أ', 'الصف الخامس - ب']);
    expect(classes[0].subjects.map((x) => x.id)).toEqual([t.fx.math.id]);
    expect(res.body.teachers).toEqual([]);
  });

  it('supervisor scope lists every class', async () => {
    const agent = await t.loginAs(t.fx.users.supervisor.phone);
    const res = await agent.get(`/api/schools/${t.fx.schoolA.id}/lookups/scope`);
    expect(res.body.classes).toHaveLength(3);
    expect(res.body.teachers.length).toBeGreaterThan(0);
  });

  it('class rosters respect teacher scope', async () => {
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    const ok = await teacher.get(`/api/schools/${t.fx.schoolA.id}/lookups/classes/${t.fx.class5a.id}/students`);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(3);
    const denied = await teacher.get(`/api/schools/${t.fx.schoolA.id}/lookups/classes/${t.fx.class6a.id}/students`);
    expect(denied.status).toBe(403);
  });
});

describe('files', () => {
  it('uploads and serves files to members of the school only', async () => {
    const teacher = await t.loginAs(t.fx.users.teacher.phone);
    const up = await teacher
      .post(`/api/schools/${t.fx.schoolA.id}/files`)
      .set('Content-Type', 'image/png')
      .set('X-File-Name', encodeURIComponent('صورة.png'))
      .send(Buffer.from([137, 80, 78, 71]));
    expect(up.status).toBe(201);
    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    const got = await guardian.get(up.body.url);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(up.body.url)).status).toBe(404);
    const bad = await teacher
      .post(`/api/schools/${t.fx.schoolA.id}/files`)
      .set('Content-Type', 'application/x-msdownload')
      .send(Buffer.from([1]));
    expect(bad.status).toBe(400);
  });
});

describe('misc', () => {
  it('health and unknown API routes', async () => {
    expect((await t.anon().get('/api/health')).body).toEqual({ ok: true });
    expect((await t.anon().get('/api/nope')).status).toBe(404);
  });
  it('public config hides demo data outside demo mode', async () => {
    expect((await t.anon().get('/api/public/config')).body).toEqual({ demoMode: false, demo: null });
  });
});

describe('demo login', () => {
  it('is unavailable outside demo mode', async () => {
    const res = await t.anon().post('/api/public/demo/login').send({ role: 'admin' });
    expect(res.status).toBe(404);
  });

  it('logs in as a demo role without credentials in demo mode', async () => {
    const demoApp = createApp({ db: t.db, config: { ...t.config, demoMode: true } });
    const missing = await request(demoApp).post('/api/public/demo/login').send({ role: 'teacher' });
    expect(missing.status).toBe(404);
    const teacher = DEMO_ACCOUNTS.find((a) => a.role === 'teacher')!;
    await t.db.insert(s.users).values({ phone: teacher.phone, fullName: teacher.fullName, status: 'active' });
    const agent = request.agent(demoApp);
    expect((await agent.post('/api/public/demo/login').send({ role: 'teacher' })).status).toBe(200);
    expect((await agent.get('/api/me')).body.user.phone).toBe(teacher.phone);
    expect((await agent.post('/api/public/demo/login').send({ role: 'root' })).status).toBe(400);
  });
});

describe('student summary', () => {
  it('serves the guardian home header for guardians and staff, not strangers', async () => {
    const guardian = await t.loginAs(t.fx.users.guardian.phone);
    const res = await guardian.get(`/api/students/${t.fx.students.s1.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.student.classLabel).toBe('الصف الخامس - أ');
    expect(Object.keys(res.body.badges)).toHaveLength(9);
    const other = await t.loginAs(t.fx.users.guardian2.phone);
    expect((await other.get(`/api/students/${t.fx.students.s1.id}/summary`)).status).toBe(403);
    const adminB = await t.loginAs(t.fx.users.adminB.phone);
    expect((await adminB.get(`/api/students/${t.fx.students.s1.id}/summary`)).status).toBe(403);
  });
});

describe('demo data versioning', () => {
  it('seeds an empty database, keeps a current one and reloads an outdated one', async () => {
    const { connectPglite } = await import('../src/db/client');
    const { ensureDemoData, getDemoSeedVersion } = await import('../src/seed/reset');
    const h = await connectPglite(null);
    await h.migrate();
    let calls = 0;
    const seed = async (db: typeof h.db) => {
      calls++;
      await db.insert(s.schools).values({ name: 'demo', code: `DEMO_${calls}` });
    };
    expect(await ensureDemoData(h.db, seed, '1')).toBe('seeded');
    expect(await getDemoSeedVersion(h.db)).toBe('1');
    expect(await ensureDemoData(h.db, seed, '1')).toBe('current');
    expect(await ensureDemoData(h.db, seed, '2')).toBe('reseeded');
    expect(calls).toBe(2);
    const rows = await h.db.select().from(s.schools);
    expect(rows.map((r) => r.code)).toEqual(['DEMO_2']);
    await h.close();
  });
});
