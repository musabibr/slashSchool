import { and, eq, sql } from 'drizzle-orm';
import type { BadgeModule } from '@slash/shared';
import type { Db } from '../db/client';
import { readCursors } from '../db/schema';

/** All of a guardian's "last seen" markers for one student, keyed `${module}:${scope}`. */
export async function getCursorMap(db: Db, userId: string, studentId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select()
    .from(readCursors)
    .where(and(eq(readCursors.userId, userId), eq(readCursors.studentId, studentId)));
  return new Map(rows.map((r) => [`${r.module}:${r.scope}`, r.lastSeenAt]));
}

export function cursorKey(module: BadgeModule, scope = '') {
  return `${module}:${scope}`;
}

/** Mark a module (or one subject inside it) as seen now. */
export async function markSeen(db: Db, userId: string, studentId: string, module: BadgeModule, scope = '') {
  await db
    .insert(readCursors)
    .values({ userId, studentId, module, scope, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [readCursors.userId, readCursors.studentId, readCursors.module, readCursors.scope],
      set: { lastSeenAt: sql`now()` },
    });
}
