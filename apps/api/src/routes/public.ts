import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { HttpError } from '../lib/errors';
import { createSession, setSessionCookie } from '../lib/session';
import { parse } from '../lib/validate';
import { DEMO_ACCOUNTS, DEMO_ACTIVATION, DEMO_LINK_CODE, DEMO_PIN, DEMO_SEED_VERSION } from '../seed/demo-accounts';
import { seedDemo } from '../seed/demo';
import { resetDatabase, setDemoSeedVersion } from '../seed/reset';

export function publicRouter(db: Db, config: Config) {
  const r = Router();

  /** Login-page config: demo accounts are listed only in demo mode. */
  r.get('/config', (_req, res) => {
    res.json({
      demoMode: config.demoMode,
      demo: config.demoMode
        ? { pin: DEMO_PIN, accounts: DEMO_ACCOUNTS, activation: DEMO_ACTIVATION, linkCode: DEMO_LINK_CODE }
        : null,
    });
  });

  /**
   * Demo mode only: log in as a demo role without typing anything
   * (used by the login page buttons, the in-app role switcher and /demo/:role links).
   */
  r.post('/demo/login', async (req, res) => {
    if (!config.demoMode) throw new HttpError(404, 'not_found', 'غير متاح');
    const { role } = parse(z.object({ role: z.enum(['admin', 'supervisor', 'teacher', 'guardian']) }), req.body);
    const account = DEMO_ACCOUNTS.find((a) => a.role === role)!;
    const [user] = await db.select().from(users).where(eq(users.phone, account.phone));
    if (!user || user.status !== 'active') {
      throw new HttpError(404, 'demo_missing', 'الحساب التجريبي غير موجود — أعد تعيين البيانات التجريبية');
    }
    const session = await createSession(db, user.id, req.headers['user-agent']);
    setSessionCookie(res, session.token, session.expiresAt, config.isProduction);
    res.json({ ok: true });
  });

  /** Demo mode only: wipe everything and reload the demo dataset. */
  r.post(
    '/demo/reset',
    config.rateLimit ? rateLimit({ windowMs: 10 * 60_000, limit: 5, legacyHeaders: false }) : (_q, _s, n) => n(),
    async (_req, res) => {
      if (!config.demoMode) throw new HttpError(404, 'not_found', 'غير متاح');
      await resetDatabase(db);
      await seedDemo(db);
      await setDemoSeedVersion(db, DEMO_SEED_VERSION);
      res.json({ ok: true });
    },
  );

  return r;
}
