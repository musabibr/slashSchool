import type { Db } from '../db/client';
import { auditLogs } from '../db/schema';

/** Record who changed a score, absence, payment, incident or status. */
export async function audit(
  db: Db,
  entry: {
    schoolId: string | null;
    actorId: string | null;
    entity: string;
    entityId: string;
    action: 'create' | 'update' | 'delete' | string;
    before?: unknown;
    after?: unknown;
  },
) {
  await db.insert(auditLogs).values({
    schoolId: entry.schoolId,
    actorId: entry.actorId,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
