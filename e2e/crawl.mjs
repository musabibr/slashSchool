/**
 * Visits every screen of every role on a production build with fresh demo data and reports problems:
 * page crashes, 5xx responses, "تعذر تحميل البيانات" error states, leftover "قريباً" placeholders,
 * and horizontal overflow on phone-sized screens. Screenshots go to $SHOTS_DIR.
 *
 *   npm run build && node e2e/crawl.mjs [--only guardian,teacher] [--port 4500]
 *
 * Exit code 1 when any problem is found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SHOTS_DIR, apiCall, openAs, shot, startServer } from './harness.mjs';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = opt('only')?.split(',');
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 900 };

const server = await startServer(Number(opt('port') ?? 4500));
const report = [];

async function visit(session, role, url, name, viewport) {
  const before = session.errors.length;
  const { page } = session;
  let status = 'ok';
  try {
    await page.goto(server.url + url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(300);
  } catch (e) {
    status = `navigation failed: ${e.message.split('\n')[0]}`;
  }
  const problems = session.errors.slice(before);
  const body = await page.locator('body').innerText().catch(() => '');
  if (body.includes('تعذر تحميل البيانات')) problems.push('error state shown (تعذر تحميل البيانات)');
  if (body.includes('قريباً')) problems.push('placeholder shown (قريباً)');
  if (/الصفحة غير موجودة/.test(body)) problems.push('404 page');
  if (viewport.width < 500) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
  }
  if (status !== 'ok') problems.push(status);
  const file = await shot(page, `${role}--${name}`);
  report.push({ role, name, url, problems, screenshot: file });
  console.log(`${problems.length ? '✗' : '✓'} ${role} ${name}${problems.length ? ' — ' + problems.join(' | ') : ''}`);
}

async function guardian() {
  const session = await openAs(server, 'guardian', PHONE);
  const me = (await apiCall(session.context, server, 'GET', '/api/me')).body;
  await visit(session, 'guardian', '/select?stay=1', 'select', PHONE);
  for (const [i, child] of me.children.entries()) {
    const g = `/g/${child.id}`;
    const tag = `child${i + 1}`;
    const subjects = (await apiCall(session.context, server, 'GET', `/api/students/${child.id}/subjects?module=lessons`)).body ?? [];
    const hw = (await apiCall(session.context, server, 'GET', `/api/students/${child.id}/subjects?module=homework`)).body ?? [];
    const results = (await apiCall(session.context, server, 'GET', `/api/students/${child.id}/results`)).body ?? [];
    const period = Array.isArray(results) ? results.find((r) => r.type === 'period') : null;
    const pages = [
      ['home', g],
      ['lessons', `${g}/lessons`],
      ...(subjects[0] ? [['lessons-subject', `${g}/lessons/${subjects[0].id}?range=all`]] : []),
      ['homework', `${g}/homework`],
      ...(hw[0] ? [['homework-subject', `${g}/homework/${hw[0].id}?range=all`]] : []),
      ['attendance', `${g}/attendance`],
      ['fees', `${g}/fees`],
      ['exams', `${g}/exams`],
      ['quizzes', `${g}/exams/quizzes`],
      ['exam-timetable', `${g}/exams/timetable`],
      ['results', `${g}/results`],
      ...(period ? [['result-sheet', `${g}/results/${period.id}`]] : []),
      ['behavior', `${g}/behavior`],
      ['calendar', `${g}/calendar`],
      ['announcements', `${g}/announcements`],
    ];
    for (const [name, url] of pages) await visit(session, 'guardian', url, `${tag}-${name}`, PHONE);
  }
  await session.close();
}

async function staff(role) {
  const session = await openAs(server, role, PHONE);
  const me = (await apiCall(session.context, server, 'GET', '/api/me')).body;
  const school = me.schools.find((s) => s.roles.includes(role)) ?? me.schools[0];
  const base = `/s/${school.id}`;
  const lessons = (await apiCall(session.context, server, 'GET', `/api/schools/${school.id}/lessons?limit=1`)).body ?? [];
  const quizzes = (await apiCall(session.context, server, 'GET', `/api/schools/${school.id}/assessments?kind=quiz`)).body ?? [];
  const pages = [
    ['home', base],
    ['lessons', `${base}/lessons`],
    ['lesson-new', `${base}/lessons/new`],
    ['lessons-list', `${base}/lessons/list`],
    ...(lessons[0] ? [['lesson-edit', `${base}/lessons/${lessons[0].id}`]] : []),
    ['exams', `${base}/exams`],
    ['quizzes', `${base}/exams/quizzes`],
    ['quiz-new', `${base}/exams/quizzes/new`],
    ...(quizzes[0] ? [['quiz-edit', `${base}/exams/quizzes/${quizzes[0].id}`]] : []),
    ['grades', `${base}/grades`],
    ['timetable', `${base}/timetable`],
    ['evaluation', `${base}/evaluation`],
  ];
  if (role === 'supervisor') {
    pages.push(
      ['attendance', `${base}/attendance`],
      ['attendance-record', `${base}/attendance/record`],
      ['exam-timetable', `${base}/exams/timetable`],
      ['behavior', `${base}/behavior`],
    );
  }
  for (const [name, url] of pages) await visit(session, role, url, name, PHONE);
  await session.close();
}

async function admin() {
  const session = await openAs(server, 'admin', DESKTOP);
  const me = (await apiCall(session.context, server, 'GET', '/api/me')).body;
  const school = me.schools.find((s) => s.roles.includes('admin'));
  const base = `/a/${school.id}`;
  const students = (await apiCall(session.context, server, 'GET', `/api/schools/${school.id}/students?limit=1`)).body;
  const studentId = students?.items?.[0]?.id;
  const pages = [
    ['dashboard', base],
    ['students', `${base}/students`],
    ['admission', `${base}/students/new`],
    ['import', `${base}/students/import`],
    ...(studentId ? [['student-profile', `${base}/students/${studentId}`], ['student-edit', `${base}/students/${studentId}/edit`]] : []),
    ['supervisors', `${base}/supervisors`],
    ['teachers', `${base}/teachers`],
    ['guardians', `${base}/guardians`],
    ['classes', `${base}/classes`],
    ['settings', `${base}/settings`],
    ['calendar', `${base}/calendar`],
    ['announcements', `${base}/announcements`],
    ['timetables', `${base}/timetables`],
    ['regulations', `${base}/regulations`],
    ['attendance', `${base}/attendance`],
    ['fees', `${base}/fees`],
  ];
  for (const [name, url] of pages) await visit(session, 'admin', url, name, DESKTOP);
  // The admin student profile tabs, at phone width too.
  if (studentId) await visit(session, 'admin', `${base}/students/${studentId}`, 'student-profile-desktop-again', DESKTOP);
  await session.close();
}

try {
  const roles = { guardian, teacher: () => staff('teacher'), supervisor: () => staff('supervisor'), admin };
  for (const [name, run] of Object.entries(roles)) if (!only || only.includes(name)) await run();
} finally {
  await server.stop();
}

const failed = report.filter((r) => r.problems.length);
fs.mkdirSync(SHOTS_DIR, { recursive: true });
fs.writeFileSync(path.join(SHOTS_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.length - failed.length}/${report.length} screens clean. Screenshots + report.json in ${SHOTS_DIR}`);
process.exit(failed.length ? 1 : 0);
