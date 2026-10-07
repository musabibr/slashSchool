import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export { schema };

/** Driver-agnostic database handle (node-postgres in production, PGlite in dev/tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  driver: 'pg' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db/client.ts → ../../drizzle ; dist/index.js → ../drizzle
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(here, '../drizzle'), path.resolve(here, '../../drizzle')];
  const found = candidates.find((c) => c && fs.existsSync(path.join(c, 'meta/_journal.json')));
  if (!found) throw new Error('Migrations folder not found');
  return found;
}

export async function connectPostgres(url: string, ssl: boolean): Promise<DbHandle> {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  const db = drizzle(pool, { schema });
  return {
    db: db as unknown as Db,
    driver: 'pg',
    migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
    close: () => pool.end(),
  };
}

/** Embedded Postgres (WASM). `dir` = null keeps everything in memory. */
export async function connectPglite(dir: string | null): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = dir ? new PGlite(dir) : new PGlite();
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}

export function connect(config: { databaseUrl: string | null; databaseSsl: boolean; pgliteDir: string | null }) {
  return config.databaseUrl ? connectPostgres(config.databaseUrl, config.databaseSsl) : connectPglite(config.pgliteDir);
}
