import { Router } from 'express';
import { and, asc, eq, exists, ilike, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { Relation, StudentStatus, UserStatus } from '@slash/shared';
import type { Db } from '../../../db/client';
import { classSections, studentGuardians, students, users } from '../../../db/schema';
import { requireRole, schoolOf, userOf } from '../../../lib/context';
import { forbidden, notFound } from '../../../lib/errors';
import { issueActivationCode } from '../../../lib/users';
import { parse, zId } from '../../../lib/validate';
import { listGuardiansQuery } from './schemas';
import {
  classGrade,
  classLabelSql,
  codeIssuers,
  digitsOf,
  searchTokens,
  studentFullName,
  textMatches,
} from './service';

export interface GuardianChildDto {
  studentId: string;
  fullName: string;
  classLabel: string | null;
  status: StudentStatus;
  relation: Relation;
}

export interface GuardianListItem {
  userId: string;
  fullName: string;
  phone: string;
  /** First WhatsApp number recorded on any of the guardian's links at this school. */
  whatsapp: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  canIssueCode: boolean;
  children: GuardianChildDto[];
}

/**
 * Guardians of the school (sidebar "أولياء الأمور"), mounted at /api/schools/:schoolId/guardians. Admin only.
 *   GET  /                          ?q&status&limit&offset → {items, total}
 *   POST /:userId/activation-code   → 201 {code, expiresAt}
 * A guardian of the school = an account linked to at least one of its students.
 */
export function guardiansRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin'));

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const q = parse(listGuardiansQuery, req.query);

    const linksHere = (...conds: Array<SQL | undefined>) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(studentGuardians)
          .innerJoin(students, eq(students.id, studentGuardians.studentId))
          .where(and(eq(studentGuardians.userId, users.id), eq(studentGuardians.schoolId, school.id), ...conds)),
      );
    /** A token matches the guardian's name or phone, or one of their children's names or codes. */
    const tokenMatch = (token: string) => {
      const digits = digitsOf(token);
      return or(
        textMatches(users.fullName, token),
        digits.length >= 3 ? like(users.phone, `%${digits}%`) : undefined,
        digits.length > 4 && digits.startsWith('249') ? like(users.phone, `%0${digits.slice(3)}%`) : undefined,
        linksHere(
          or(
            textMatches(students.firstName, token),
            textMatches(students.fatherName, token),
            ilike(students.code, token),
          ),
        ),
      );
    };
    const where = and(
      linksHere(),
      q.status ? eq(users.status, q.status) : undefined,
      ...searchTokens(q.q).map(tokenMatch),
    );

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          userId: users.id,
          fullName: users.fullName,
          phone: users.phone,
          status: users.status,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(where)
        .orderBy(asc(users.fullName), asc(users.id))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
    ]);

    const ids = rows.map((u) => u.userId);
    const [children, issuers] = await Promise.all([
      ids.length
        ? db
            .select({
              userId: studentGuardians.userId,
              relation: studentGuardians.relation,
              whatsapp: studentGuardians.whatsapp,
              studentId: students.id,
              firstName: students.firstName,
              fatherName: students.fatherName,
              grandfatherName: students.grandfatherName,
              status: students.status,
              classLabel: classLabelSql,
            })
            .from(studentGuardians)
            .innerJoin(students, eq(students.id, studentGuardians.studentId))
            .leftJoin(classSections, eq(classSections.id, students.classSectionId))
            .leftJoin(classGrade, eq(classGrade.id, classSections.gradeLevelId))
            .where(and(eq(studentGuardians.schoolId, school.id), inArray(studentGuardians.userId, ids)))
            .orderBy(asc(students.firstName), asc(students.code))
        : Promise.resolve([]),
      codeIssuers(db, school.id, ids),
    ]);

    const items: GuardianListItem[] = rows.map((u) => {
      const mine = children.filter((c) => c.userId === u.userId);
      return {
        userId: u.userId,
        fullName: u.fullName,
        phone: u.phone,
        whatsapp: mine.find((c) => c.whatsapp)?.whatsapp ?? null,
        status: u.status,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        canIssueCode: issuers.has(u.userId),
        children: mine.map((c) => ({
          studentId: c.studentId,
          fullName: studentFullName(c),
          classLabel: c.classLabel,
          status: c.status,
          relation: c.relation,
        })),
      };
    });
    res.json({ items, total: Number(total) });
  });

  /** A fresh activation code (first activation, or a forgotten PIN). Older unused codes are revoked. */
  r.post('/:userId/activation-code', async (req, res) => {
    const school = schoolOf(req);
    const userId = parse(zId, req.params.userId);
    const [link] = await db
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.userId, userId), eq(studentGuardians.schoolId, school.id)))
      .limit(1);
    if (!link) throw notFound('ولي الأمر غير موجود');
    const issuers = await codeIssuers(db, school.id, [userId]);
    if (!issuers.has(userId)) {
      throw forbidden('لا يمكن إصدار رمز تفعيل لهذا الحساب لأنه مستخدم في مدرسة أخرى أو حساب إدارة');
    }
    const { code, expiresAt } = await issueActivationCode(db, userId, userOf(req).id);
    res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
  });

  return r;
}
