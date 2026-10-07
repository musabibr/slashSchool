import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { joinName, normalizePhone, STAFF_ROLES, type Role } from '@slash/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { activationCodes, memberships, schools, sessions, studentGuardians, students, users } from '../db/schema';
import { HttpError, badRequest, conflict } from '../lib/errors';
import { classLabel, requireAuth, userOf } from '../lib/context';
import { hashCode, hashSecret, sha256, verifySecret } from '../lib/security';
import { clearSessionCookie, createSession, SESSION_COOKIE, setSessionCookie } from '../lib/session';
import { ensureMembership } from '../lib/users';
import { parse, zPin } from '../lib/validate';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function maskPhone(phone: string) {
  return phone.length > 4 ? `${'•'.repeat(phone.length - 4)}${phone.slice(-4)}` : phone;
}

async function findValidActivation(db: Db, code: string) {
  const [row] = await db
    .select({ code: activationCodes, user: users })
    .from(activationCodes)
    .innerJoin(users, eq(users.id, activationCodes.userId))
    .where(
      and(
        eq(activationCodes.codeHash, hashCode(code)),
        isNull(activationCodes.usedAt),
        isNull(activationCodes.revokedAt),
        gt(activationCodes.expiresAt, new Date()),
      ),
    );
  if (!row) throw new HttpError(400, 'invalid_code', 'الرمز غير صحيح أو منتهي الصلاحية');
  return row;
}

export function authRouter(db: Db, config: Config) {
  const r = Router();
  const limiter = config.rateLimit
    ? rateLimit({
        windowMs: 15 * 60_000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: { code: 'rate_limited', message: 'محاولات كثيرة، حاول بعد قليل' } },
      })
    : (_req: unknown, _res: unknown, next: () => void) => next();

  /** P1 step 1: check an activation code and show whose account it is. */
  r.post('/activate', limiter, async (req, res) => {
    const { code } = parse(z.object({ code: z.string().min(4).max(40) }), req.body);
    const { user } = await findValidActivation(db, code);
    res.json({ fullName: user.fullName, phone: maskPhone(user.phone), alreadyActive: user.status === 'active' });
  });

  /** P1 step 2: set a PIN with a valid activation code; logs the user in. */
  r.post('/set-pin', limiter, async (req, res) => {
    const { code, pin } = parse(z.object({ code: z.string().min(4).max(40), pin: zPin }), req.body);
    const { code: activation, user } = await findValidActivation(db, code);
    const pinHash = await hashSecret(pin);
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ pinHash, status: 'active', failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
      await tx.update(activationCodes).set({ usedAt: new Date() }).where(eq(activationCodes.id, activation.id));
    });
    const session = await createSession(db, user.id, req.headers['user-agent']);
    setSessionCookie(res, session.token, session.expiresAt, config.isProduction);
    res.json({ ok: true, token: session.token });
  });

  /** Phone + PIN login. Locks the account for 15 minutes after 5 wrong PINs. */
  r.post('/login', limiter, async (req, res) => {
    const body = parse(z.object({ phone: z.string().min(6).max(20), pin: z.string().min(1).max(12) }), req.body);
    const phone = normalizePhone(body.phone);
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    const wrong = new HttpError(401, 'invalid_credentials', 'رقم الهاتف أو الرقم السري غير صحيح');
    if (!user) throw wrong;
    if (user.status !== 'active' || !user.pinHash) {
      throw new HttpError(403, 'not_activated', 'الحساب غير مفعّل بعد، استخدم رمز التفعيل الذي أرسلته المدرسة');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpError(423, 'locked', `تم إيقاف الدخول مؤقتاً بسبب محاولات خاطئة، حاول بعد ${LOCK_MINUTES} دقيقة`);
    }
    if (!(await verifySecret(body.pin, user.pinHash))) {
      const attempts = user.failedAttempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await db
        .update(users)
        .set({
          failedAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      throw wrong;
    }
    await db
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    const session = await createSession(db, user.id, req.headers['user-agent']);
    setSessionCookie(res, session.token, session.expiresAt, config.isProduction);
    res.json({ ok: true, token: session.token });
  });

  r.post('/logout', async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (req.sessionId) await db.delete(sessions).where(eq(sessions.id, req.sessionId));
    else if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return r;
}

export function meRouter(db: Db) {
  const r = Router();
  r.use(requireAuth);

  /** Who am I + every context I can open: children (guardian) and schools (staff). */
  r.get('/', async (req, res) => {
    const me = userOf(req);
    const childRows = await db
      .select({ student: students, school: { id: schools.id, name: schools.name } })
      .from(studentGuardians)
      .innerJoin(students, eq(students.id, studentGuardians.studentId))
      .innerJoin(schools, eq(schools.id, students.schoolId))
      .where(eq(studentGuardians.userId, me.id))
      .orderBy(asc(schools.name), asc(students.firstName));
    const children = await Promise.all(
      childRows.map(async ({ student, school }) => ({
        id: student.id,
        code: student.code,
        fullName: joinName(student.firstName, student.fatherName, student.grandfatherName),
        gender: student.gender,
        status: student.status,
        classLabel: await classLabel(db, student.classSectionId),
        school,
      })),
    );
    const staffRows = await db
      .select({ role: memberships.role, school: { id: schools.id, name: schools.name, code: schools.code } })
      .from(memberships)
      .innerJoin(schools, eq(schools.id, memberships.schoolId))
      .where(and(eq(memberships.userId, me.id), inArray(memberships.role, [...STAFF_ROLES])))
      .orderBy(asc(schools.name));
    const bySchool = new Map<string, { id: string; name: string; code: string; roles: Role[] }>();
    for (const row of staffRows) {
      const entry = bySchool.get(row.school.id) ?? { ...row.school, roles: [] };
      entry.roles.push(row.role);
      bySchool.set(row.school.id, entry);
    }
    res.json({ user: me, children, schools: [...bySchool.values()] });
  });

  /** The "+" on P2: link another child with the student's link code. */
  r.post('/children/link', async (req, res) => {
    const me = userOf(req);
    const { code } = parse(z.object({ code: z.string().min(4).max(40) }), req.body);
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.linkCodeHash, hashCode(code)));
    if (!student) throw new HttpError(400, 'invalid_code', 'رمز الطالب غير صحيح');
    const [existing] = await db
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.studentId, student.id), eq(studentGuardians.userId, me.id)));
    if (existing) throw conflict('هذا الطالب مرتبط بحسابك مسبقاً');
    await db.transaction(async (tx) => {
      await tx.insert(studentGuardians).values({
        schoolId: student.schoolId,
        studentId: student.id,
        userId: me.id,
        relation: 'other',
        isPrimary: false,
      });
      await ensureMembership(tx, me.id, student.schoolId, 'guardian');
      // Link codes are single-use; the school can issue a new one.
      await tx.update(students).set({ linkCodeHash: null }).where(eq(students.id, student.id));
    });
    res.status(201).json({ studentId: student.id });
  });

  /** Change PIN (requires the current one). */
  r.post('/pin', async (req, res) => {
    const me = userOf(req);
    const { currentPin, newPin } = parse(z.object({ currentPin: z.string().min(1), newPin: zPin }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, me.id));
    if (!(await verifySecret(currentPin, user?.pinHash))) throw badRequest('الرقم السري الحالي غير صحيح');
    await db
      .update(users)
      .set({ pinHash: await hashSecret(newPin) })
      .where(eq(users.id, me.id));
    res.json({ ok: true });
  });

  return r;
}
