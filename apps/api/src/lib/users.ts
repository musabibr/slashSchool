import { and, eq, isNull } from 'drizzle-orm';
import { normalizePhone, type Role } from '@slash/shared';
import type { Db } from '../db/client';
import { activationCodes, memberships, students, users } from '../db/schema';
import { badRequest } from './errors';
import { generateCode, hashCode } from './security';

export const ACTIVATION_CODE_TTL_DAYS = 14;

/** Users are global and identified by phone; reuse the row when the phone already exists. */
export async function findOrCreateUser(db: Db, input: { phone: string; fullName: string }) {
  const phone = normalizePhone(input.phone);
  if (!/^0\d{9}$/.test(phone)) throw badRequest('رقم الهاتف غير صالح');
  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing) return { user: existing, created: false };
  const [user] = await db.insert(users).values({ phone, fullName: input.fullName.trim() }).returning();
  return { user, created: true };
}

export async function ensureMembership(db: Db, userId: string, schoolId: string, role: Role) {
  await db.insert(memberships).values({ userId, schoolId, role }).onConflictDoNothing();
}

/** Issues a fresh one-time activation code (revoking older unused ones). Returns the plaintext code once. */
export async function issueActivationCode(db: Db, userId: string, createdBy: string | null) {
  const now = new Date();
  await db
    .update(activationCodes)
    .set({ revokedAt: now })
    .where(and(eq(activationCodes.userId, userId), isNull(activationCodes.usedAt), isNull(activationCodes.revokedAt)));
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + ACTIVATION_CODE_TTL_DAYS * 86_400_000);
  await db.insert(activationCodes).values({ userId, codeHash: hashCode(code), expiresAt, createdBy });
  return { code, expiresAt };
}

/** Issues a fresh student link code (the "+" on P2). Returns the plaintext code once. */
export async function issueStudentLinkCode(db: Db, studentId: string) {
  const code = generateCode();
  await db.update(students).set({ linkCodeHash: hashCode(code) }).where(eq(students.id, studentId));
  return { code };
}
