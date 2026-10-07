import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { HttpError } from '../lib/errors';
import { DEMO_ACCOUNTS, DEMO_ACTIVATION, DEMO_LINK_CODE, DEMO_PIN } from '../seed/demo-accounts';
import { seedDemo } from '../seed/demo';
import { resetDatabase } from '../seed/reset';

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

  /** Demo mode only: wipe everything and reload the demo dataset. */
  r.post(
    '/demo/reset',
    config.rateLimit ? rateLimit({ windowMs: 10 * 60_000, limit: 5, legacyHeaders: false }) : (_q, _s, n) => n(),
    async (_req, res) => {
      if (!config.demoMode) throw new HttpError(404, 'not_found', 'غير متاح');
      await resetDatabase(db);
      await seedDemo(db);
      res.json({ ok: true });
    },
  );

  return r;
}
