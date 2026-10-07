/**
 * Browser smoke-test harness (uses the Playwright that ships with the dev container).
 *
 *   import { startServer, openAs, shot } from './harness.mjs';
 *   const server = await startServer(4321);           // production build + fresh demo data (PGlite)
 *   const { page, close } = await openAs(server, 'guardian', { width: 390, height: 844 });
 *   await page.goto(server.url + '/select');
 *   await shot(page, 'guardian-home');
 *   await close(); await server.stop();
 *
 * Requires `npm run build` first. Roles: admin | supervisor | teacher | guardian | anon.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pwPath = process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);

export const DEMO = {
  pin: '1234',
  phones: { admin: '0900000001', supervisor: '0900000002', teacher: '0900000003', guardian: '0912345678' },
};

export const SHOTS_DIR = process.env.SHOTS_DIR ?? path.join(os.tmpdir(), 'slash-shots');

export async function startServer(port = 4300 + Math.floor(Math.random() * 500)) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-e2e-'));
  const child = spawn(process.execPath, [path.join(root, 'apps/api/dist/index.js')], {
    env: { ...process.env, PORT: String(port), PGLITE_DIR: dataDir, DEMO_MODE: 'true', NODE_ENV: 'development', LOG_LEVEL: 'warn', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 240; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`server exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    port,
    log: () => log,
    async stop() {
      child.kill('SIGTERM');
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A logged-in browser page for a demo role. Console errors and failed requests are collected. */
export async function openAs(server, role, viewport = { width: 390, height: 844 }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, locale: 'ar' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  if (role !== 'anon') {
    const res = await context.request.post(`${server.url}/api/auth/login`, {
      data: { phone: DEMO.phones[role], pin: DEMO.pin },
    });
    if (!res.ok()) throw new Error(`login ${role} failed: ${res.status()} ${await res.text()}`);
  }
  return { browser, context, page, errors, close: () => browser.close() };
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** JSON API call with the page's cookies. */
export async function apiCall(context, server, method, urlPath, data) {
  const res = await context.request.fetch(`${server.url}${urlPath}`, { method, data });
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
}
