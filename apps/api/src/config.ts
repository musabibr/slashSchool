import path from 'node:path';

export interface Config {
  port: number;
  isProduction: boolean;
  isTest: boolean;
  /** Postgres connection string. When null, an embedded PGlite database is used (dev/tests). */
  databaseUrl: string | null;
  databaseSsl: boolean;
  /** PGlite data directory; null = in-memory. Ignored when databaseUrl is set. */
  pgliteDir: string | null;
  /** Enables demo accounts on the login page, demo reset, and auto-seeding an empty database. */
  demoMode: boolean;
  /** Built web app to serve (apps/web/dist). null = API only. */
  webDistDir: string | null;
  logLevel: string;
  /** Disable auth rate limits (tests). */
  rateLimit: boolean;
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  return {
    port: Number(env.PORT ?? 3000),
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    databaseUrl,
    // Render's *external* URLs need TLS; its internal ones (used by the blueprint) don't.
    databaseSsl: bool(env.DATABASE_SSL, !!databaseUrl && /render\.com|sslmode=require/.test(databaseUrl)),
    pgliteDir: databaseUrl ? null : (env.PGLITE_DIR ?? path.resolve(process.cwd(), '.data/pglite')),
    demoMode: bool(env.DEMO_MODE, false),
    webDistDir: env.WEB_DIST_DIR ?? null,
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),
    rateLimit: bool(env.RATE_LIMIT, nodeEnv !== 'test'),
  };
}
