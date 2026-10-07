import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { joinName, type Gender, type Relation, type StudentStatus, type UserStatus } from '@slash/shared';
import type { Db } from '../../../db/client';
import {
  activationCodes,
  classSections,
  gradeLevels,
  memberships,
  stages,
  studentGuardians,
  students,
  users,
} from '../../../db/schema';
import { badRequest, conflict, notFound } from '../../../lib/errors';
import { currentAcademicYear } from '../../../lib/scope';
import { generateCode, hashCode } from '../../../lib/security';
import { ACTIVATION_CODE_TTL_DAYS, ensureMembership, findOrCreateUser, issueActivationCode } from '../../../lib/users';

// ───────────────────────────── DTOs ─────────────────────────────

/** A row of the D2 students table. */
export interface StudentListItem {
  id: string;
  code: string;
  fullName: string;
  gender: Gender;
  classSectionId: string | null;
  classLabel: string | null;
  gradeLevelName: string | null;
  status: StudentStatus;
  registeredAt: string;
  guardianCount: number;
}

/** A guardian as listed on the student profile (D4). */
export interface StudentGuardianDto {
  userId: string;
  fullName: string;
  phone: string;
  status: UserStatus;
  lastLoginAt: string | null;
  relation: Relation;
  isPrimary: boolean;
  occupation: string | null;
  workplace: string | null;
  locality: string | null;
  residence: string | null;
  whatsapp: string | null;
  /** Whether this school may issue the account an activation code (see `codeIssuers`). */
  canIssueCode: boolean;
}

/** GET /students/:id — the D4 profile, also used to prefill the D3 form in edit mode. */
export interface StudentProfileDto {
  id: string;
  code: string;
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  greatGrandfatherName: string | null;
  /** First three name parts, as shown everywhere else. */
  fullName: string;
  gender: Gender;
  birthDate: string | null;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
  stageId: string | null;
  stageName: string | null;
  classSectionId: string | null;
  classLabel: string | null;
  status: StudentStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  motherName: string | null;
  motherPhone: string | null;
  motherWhatsapp: string | null;
  registeredAt: string;
  notes: string | null;
  createdAt: string;
  hasLinkCode: boolean;
  guardians: StudentGuardianDto[];
}

/** A guardian account in an admission / add-guardian response, with its fresh activation code (if any). */
export interface IssuedGuardianDto {
  userId: string;
  fullName: string;
  phone: string;
  whatsapp: string | null;
  relation: Relation;
  status: UserStatus;
  activationCode: string | null;
  /** The phone already belongs to an account used by another school, so no code was issued here. */
  otherSchool: boolean;
}

export const studentFullName = (s: { firstName: string; fatherName: string; grandfatherName: string }) =>
  joinName(s.firstName, s.fatherName, s.grandfatherName);

// ───────────────────────────── Search ─────────────────────────────

/** Arabic letters that are typed interchangeably (أ/إ/آ/ٱ → ا, ى → ي, ة → ه); used on both sides of a search. */
const ARABIC_FROM = 'أإآٱىة';
const ARABIC_TO = 'اااايه';
const DIACRITICS_RE = /[ً-ْـ]/g;

export function normalizeArabic(value: string): string {
  let out = value.replace(DIACRITICS_RE, '');
  for (let i = 0; i < ARABIC_FROM.length; i++) out = out.split(ARABIC_FROM[i]).join(ARABIC_TO[i]);
  return out.replace(/\s+/g, ' ').trim();
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Arabic-Indic digits → Western, digits only. */
export const digitsOf = (v: string) =>
  v
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');

export const searchTokens = (q: string | undefined) =>
  (q ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);

/** `column` contains `token`, ignoring case and Arabic letter variants. */
export function textMatches(column: PgColumn | SQL, token: string): SQL {
  const pattern = `%${escapeLike(normalizeArabic(token))}%`;
  return sql`translate(${column}, ${ARABIC_FROM}, ${ARABIC_TO}) ilike ${pattern}`;
}

/** Every token must match one of the student's name parts or its code. */
export function studentSearch(tokens: string[]): SQL | undefined {
  if (!tokens.length) return undefined;
  return and(
    ...tokens.map((t) =>
      or(
        textMatches(students.firstName, t),
        textMatches(students.fatherName, t),
        textMatches(students.grandfatherName, t),
        textMatches(students.greatGrandfatherName, t),
        ilike(students.code, `%${escapeLike(t)}%`),
      ),
    ),
  );
}

// ───────────────────────────── Lookups ─────────────────────────────

/** The student row, or 404 unless it belongs to the school. */
export async function findStudentInSchool(db: Db, schoolId: string, studentId: string) {
  const [row] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
  if (!row) throw notFound('الطالب غير موجود');
  return row;
}

export async function assertGradeLevelInSchool(db: Db, schoolId: string, gradeLevelId: string) {
  const [row] = await db
    .select()
    .from(gradeLevels)
    .where(and(eq(gradeLevels.id, gradeLevelId), eq(gradeLevels.schoolId, schoolId)));
  if (!row) throw notFound('السنة الدراسية غير موجودة');
  return row;
}

/**
 * A class a student can be placed in: of this school, of the current academic year and (when given)
 * of the chosen grade level.
 */
export async function assertPlacementClass(
  db: Db,
  schoolId: string,
  classSectionId: string,
  gradeLevelId?: string,
  path = 'classSectionId',
) {
  const [cls] = await db
    .select()
    .from(classSections)
    .where(and(eq(classSections.id, classSectionId), eq(classSections.schoolId, schoolId)));
  if (!cls) throw notFound('الفصل غير موجود');
  if (gradeLevelId && cls.gradeLevelId !== gradeLevelId) {
    throw badRequest('بيانات غير صالحة', [{ path, message: 'الفصل لا ينتمي للسنة الدراسية المختارة' }]);
  }
  const year = await currentAcademicYear(db, schoolId);
  if (!year || cls.academicYearId !== year.id) {
    throw badRequest('بيانات غير صالحة', [{ path, message: 'الفصل لا ينتمي للعام الدراسي الحالي' }]);
  }
  return cls;
}

// ───────────────────────────── Codes ─────────────────────────────

/**
 * Serializes student-code allocation per school for the rest of the transaction, so two admissions
 * (or an admission and an import) never pick the same "S-{n}".
 */
export async function lockStudentCodes(tx: Db, schoolId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`students:${schoolId}`}))`);
}

/** 1 + the largest numeric suffix among the school's student codes. */
export async function nextStudentNumber(db: Db, schoolId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<string | number | null>`max(substring(${students.code} from '[0-9]+$')::bigint)` })
    .from(students)
    .where(eq(students.schoolId, schoolId));
  return Number(row?.max ?? 0) + 1;
}

export const studentCode = (n: number) => `S-${n}`;

/**
 * Which of `userIds` this school may issue activation codes to. Accounts are global (one per phone),
 * so a code — which sets a new PIN — is only issued for accounts that belong to this school alone and
 * are not an admin account; otherwise one school could take over another school's user.
 */
export async function codeIssuers(db: Db, schoolId: string, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const rows = await db
    .select({ userId: memberships.userId, schoolId: memberships.schoolId, role: memberships.role })
    .from(memberships)
    .where(inArray(memberships.userId, ids));
  const blocked = new Set(
    rows.filter((m) => m.schoolId !== schoolId || m.role === 'admin').map((m) => m.userId),
  );
  return new Set(ids.filter((id) => !blocked.has(id)));
}

/** Users of `userIds` that hold a membership in another school. */
export async function usersInOtherSchools(db: Db, schoolId: string, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const rows = await db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(and(inArray(memberships.userId, ids), ne(memberships.schoolId, schoolId)));
  return new Set(rows.map((r) => r.userId));
}

/**
 * Bulk version of `issueActivationCode` for imports (one query per step instead of two per user):
 * revokes older unused codes and returns a fresh plaintext code per user.
 */
export async function issueActivationCodes(
  tx: Db,
  userIds: string[],
  createdBy: string,
): Promise<Map<string, { code: string; expiresAt: Date }>> {
  const out = new Map<string, { code: string; expiresAt: Date }>();
  if (!userIds.length) return out;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVATION_CODE_TTL_DAYS * 86_400_000);
  for (const ids of chunks(userIds, 500)) {
    await tx
      .update(activationCodes)
      .set({ revokedAt: now })
      .where(
        and(inArray(activationCodes.userId, ids), isNull(activationCodes.usedAt), isNull(activationCodes.revokedAt)),
      );
    const values = ids.map((userId) => {
      const code = generateCode();
      out.set(userId, { code, expiresAt });
      return { userId, codeHash: hashCode(code), expiresAt, createdBy };
    });
    await tx.insert(activationCodes).values(values);
  }
  return out;
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ───────────────────────────── Queries ─────────────────────────────

/** The grade level of the student's class (the student's own grade level is joined as `gradeLevels`). */
export const classGrade = alias(gradeLevels, 'class_grade');

/** "الصف الخامس - ب" from the class's own grade level. */
export const classLabelSql = sql<string | null>`case when ${classSections.id} is null then null else ${classGrade.name} || ' - ' || ${classSections.name} end`;

/** Numeric part of the code, for ordering S-2 before S-10. */
const codeNumberSql = sql`coalesce(substring(${students.code} from '[0-9]+$')::bigint, 0)`;

export async function listStudents(
  db: Db,
  where: SQL | undefined,
  page: { limit: number; offset: number },
): Promise<{ items: StudentListItem[]; total: number }> {
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: students.id,
        code: students.code,
        firstName: students.firstName,
        fatherName: students.fatherName,
        grandfatherName: students.grandfatherName,
        gender: students.gender,
        classSectionId: students.classSectionId,
        classLabel: classLabelSql,
        gradeLevelName: gradeLevels.name,
        status: students.status,
        registeredAt: students.registeredAt,
        guardianCount: sql<number>`(select count(*)::int from ${studentGuardians} where ${studentGuardians.studentId} = ${students.id})`,
      })
      .from(students)
      .leftJoin(classSections, eq(classSections.id, students.classSectionId))
      .leftJoin(classGrade, eq(classGrade.id, classSections.gradeLevelId))
      .leftJoin(gradeLevels, eq(gradeLevels.id, students.gradeLevelId))
      .where(where)
      .orderBy(desc(students.registeredAt), desc(codeNumberSql))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(students)
      .where(where),
  ]);
  return {
    total: Number(total),
    items: rows.map((r) => ({
      id: r.id,
      code: r.code,
      fullName: studentFullName(r),
      gender: r.gender,
      classSectionId: r.classSectionId,
      classLabel: r.classLabel,
      gradeLevelName: r.gradeLevelName,
      status: r.status,
      registeredAt: r.registeredAt,
      guardianCount: Number(r.guardianCount),
    })),
  };
}

export async function loadStudentGuardians(db: Db, schoolId: string, studentId: string): Promise<StudentGuardianDto[]> {
  const rows = await db
    .select({ link: studentGuardians, user: users })
    .from(studentGuardians)
    .innerJoin(users, eq(users.id, studentGuardians.userId))
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.schoolId, schoolId)))
    .orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt));
  const issuers = await codeIssuers(
    db,
    schoolId,
    rows.map((r) => r.user.id),
  );
  return rows.map(({ link, user }) => ({
    userId: user.id,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    relation: link.relation,
    isPrimary: link.isPrimary,
    occupation: link.occupation,
    workplace: link.workplace,
    locality: link.locality,
    residence: link.residence,
    whatsapp: link.whatsapp,
    canIssueCode: issuers.has(user.id),
  }));
}

export async function loadStudentProfile(db: Db, schoolId: string, studentId: string): Promise<StudentProfileDto> {
  const [row] = await db
    .select({
      student: students,
      classLabel: classLabelSql,
      gradeLevelName: gradeLevels.name,
      stageId: stages.id,
      stageName: stages.name,
    })
    .from(students)
    .leftJoin(classSections, eq(classSections.id, students.classSectionId))
    .leftJoin(classGrade, eq(classGrade.id, classSections.gradeLevelId))
    .leftJoin(gradeLevels, eq(gradeLevels.id, students.gradeLevelId))
    .leftJoin(stages, eq(stages.id, gradeLevels.stageId))
    .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
  if (!row) throw notFound('الطالب غير موجود');
  const s = row.student;
  return {
    id: s.id,
    code: s.code,
    firstName: s.firstName,
    fatherName: s.fatherName,
    grandfatherName: s.grandfatherName,
    greatGrandfatherName: s.greatGrandfatherName,
    fullName: studentFullName(s),
    gender: s.gender,
    birthDate: s.birthDate,
    gradeLevelId: s.gradeLevelId,
    gradeLevelName: row.gradeLevelName,
    stageId: row.stageId,
    stageName: row.stageName,
    classSectionId: s.classSectionId,
    classLabel: row.classLabel,
    status: s.status,
    statusReason: s.statusReason,
    statusChangedAt: s.statusChangedAt ? s.statusChangedAt.toISOString() : null,
    motherName: s.motherName,
    motherPhone: s.motherPhone,
    motherWhatsapp: s.motherWhatsapp,
    registeredAt: s.registeredAt,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    hasLinkCode: !!s.linkCodeHash,
    guardians: await loadStudentGuardians(db, schoolId, s.id),
  };
}

// ───────────────────────────── Guardians ─────────────────────────────

export interface GuardianLinkInput {
  phone: string;
  fullName: string;
  relation: Relation;
  isPrimary: boolean;
  whatsapp?: string | null;
  occupation?: string | null;
  workplace?: string | null;
  locality?: string | null;
  residence?: string | null;
}

/**
 * Finds (by phone) or creates the guardian's account, makes it a guardian of the school and links it
 * to the student. A new primary guardian takes the flag from the previous one. 409 if already linked.
 */
export async function linkGuardian(tx: Db, schoolId: string, studentId: string, input: GuardianLinkInput) {
  const { user } = await findOrCreateUser(tx, { phone: input.phone, fullName: input.fullName });
  const [existing] = await tx
    .select({ id: studentGuardians.id })
    .from(studentGuardians)
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.userId, user.id)));
  if (existing) throw conflict('ولي الأمر مرتبط بهذا الطالب مسبقاً');
  await ensureMembership(tx, user.id, schoolId, 'guardian');
  if (input.isPrimary) {
    await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
  }
  await tx.insert(studentGuardians).values({
    schoolId,
    studentId,
    userId: user.id,
    relation: input.relation,
    isPrimary: input.isPrimary,
    whatsapp: input.whatsapp ?? null,
    occupation: input.occupation ?? null,
    workplace: input.workplace ?? null,
    locality: input.locality ?? null,
    residence: input.residence ?? null,
  });
  return user;
}

/**
 * After linking: a fresh activation code for each account that has not been activated yet and that
 * this school may issue codes to (see `codeIssuers`).
 */
export async function issueCodesForLinked(
  tx: Db,
  schoolId: string,
  actorId: string,
  linked: Array<{ user: typeof users.$inferSelect; relation: Relation; whatsapp: string | null }>,
): Promise<IssuedGuardianDto[]> {
  const ids = linked.map((l) => l.user.id);
  const [issuers, elsewhere] = await Promise.all([
    codeIssuers(tx, schoolId, ids),
    usersInOtherSchools(tx, schoolId, ids),
  ]);
  const out: IssuedGuardianDto[] = [];
  for (const { user, relation, whatsapp } of linked) {
    const issue = user.status === 'pending' && issuers.has(user.id);
    const activation = issue ? await issueActivationCode(tx, user.id, actorId) : null;
    out.push({
      userId: user.id,
      fullName: user.fullName,
      phone: user.phone,
      whatsapp,
      relation,
      status: user.status,
      activationCode: activation?.code ?? null,
      otherSchool: elsewhere.has(user.id),
    });
  }
  return out;
}
