import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { sql } from 'drizzle-orm';
import type { Config } from './config';
import type { Db } from './db/client';
import { requireAuth, schoolScope, studentScope } from './lib/context';
import { errorHandler, notFound } from './lib/errors';
import { resolveSession } from './lib/session';
import { registerModules } from './modules';
import { authRouter, meRouter } from './routes/auth';
import { fileDownloadRouter, fileUploadRouter } from './routes/files';
import { lookupsRouter } from './routes/lookups';
import { publicRouter } from './routes/public';

export interface AppDeps {
  db: Db;
  config: Config;
  logger?: Logger;
}

function defaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src or apps/api/dist → apps/web/dist
  return path.resolve(here, '../../web/dist');
}

export function createApp({ db, config, logger }: AppDeps): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'self'"],
          // Render terminates TLS and redirects http→https itself.
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  if (logger) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => !req.url?.startsWith('/api') || req.url === '/api/health' },
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }
  app.use(cookieParser());
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', resolveSession(db));

  app.get('/api/health', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ ok: true });
  });
  app.use('/api/public', publicRouter(db, config));
  app.use('/api/auth', authRouter(db, config));
  app.use('/api/me', meRouter(db));
  app.use('/api/files', fileDownloadRouter(db));

  const school = Router({ mergeParams: true });
  const student = Router({ mergeParams: true });
  school.use('/lookups', lookupsRouter(db));
  school.use('/files', fileUploadRouter(db));
  registerModules({ school, student }, { db, config });
  app.use('/api/schools/:schoolId', requireAuth, schoolScope(db), school);
  app.use('/api/students/:studentId', requireAuth, studentScope(db), student);

  app.use('/api', () => {
    throw notFound('المسار غير موجود');
  });

  const webDist = config.webDistDir ?? defaultWebDist();
  const indexHtml = path.join(webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use('/assets', express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // SPA fallback: any non-API GET serves the app shell.
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
