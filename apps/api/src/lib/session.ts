import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import { randomToken, sha256 } from './security';

export const SESSION_COOKIE = 'ss_sid';
export const SESSION_TTL_DAYS = 30;
const TOUCH_INTERVAL_MS = 10 * 60_000;

export async function createSession(db: Db, userId: string, userAgent: string | undefined) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function tokenFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  return cookie || null;
}

/** Attaches req.user / req.sessionId when a valid session token is present. Never rejects. */
export function resolveSession(db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = tokenFrom(req);
    if (!token) return next();
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, sha256(token)));
    if (!row || row.session.expiresAt.getTime() < Date.now() || row.user.status !== 'active') return next();
    req.user = { id: row.user.id, phone: row.user.phone, fullName: row.user.fullName };
    req.sessionId = row.session.id;
    if (Date.now() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
    }
    next();
  };
}
