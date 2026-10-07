import { Router } from 'express';
import { and, asc, eq, gte, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { isValidPhone, normalizePhone, STAFF_ROLES, type Role } from '@slash/shared';
import type { Db } from '../../../db/client';
import {
  academicYears,
  classSections,
  gradeLevels,
  memberships,
  subjects,
  teachingAssignments,
  timetableSlots,
  users,
} from '../../../db/schema';
import { audit } from '../../../lib/audit';
import { requireRole, schoolOf, schoolToday, userOf } from '../../../lib/context';
import { badRequest, conflict, notFound } from '../../../lib/errors';
import { currentAcademicYear } from '../../../lib/scope';
import { ensureMembership, findOrCreateUser, issueActivationCode } from '../../../lib/users';
import { parse, zId, zText } from '../../../lib/validate';

type StaffRole = (typeof STAFF_ROLES)[number];

const zStaffRole = z.enum(STAFF_ROLES, { errorMap: () => ({ message: 'الدور غير صالح' }) });

const listQuery = z.object({ role: zStaffRole.optional() });
const roleQuery = z.object({ role: zStaffRole });

const createBody = z.object({
  fullName: zText(120),
  phone: z
    .string({ required_error: 'رقم الهاتف مطلوب', invalid_type_error: 'رقم الهاتف غير صالح' })
    .refine(isValidPhone, { message: 'رقم الهاتف غير صالح' })
    .transform(normalizePhone),
  role: zStaffRole,
});

export interface StaffMember {
  userId: string;
  fullName: string;
  phone: string;
  status: string;
  /** Every staff role the user holds in this school. */
  roles: StaffRole[];
  /** Current-year teaching assignments. */
  assignments: Array<{ classLabel: string; subjectName: string }>;
  lastLoginAt: string | null;
}

const ROLE_ORDER: Record<StaffRole, number> = { admin: 0, supervisor: 1, teacher: 2 };

async function listStaff(db: Db, schoolId: string, role?: StaffRole): Promise<StaffMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      phone: users.phone,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.schoolId, schoolId), inArray(memberships.role, [...STAFF_ROLES])))
    .orderBy(asc(users.fullName));

  const byUser = new Map<string, StaffMember>();
  for (const row of rows) {
    const member = byUser.get(row.userId) ?? {
      userId: row.userId,
      fullName: row.fullName,
      phone: row.phone,
      status: row.status,
      roles: [],
      assignments: [],
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    };
    member.roles.push(row.role as StaffRole);
    byUser.set(row.userId, member);
  }
  const members = [...byUser.values()].filter((m) => !role || m.roles.includes(role));
  if (!members.length) return [];
  for (const m of members) m.roles.sort((a, b) => ROLE_ORDER[a] - ROLE_ORDER[b]);

  const year = await currentAcademicYear(db, schoolId);
  if (year) {
    const assignments = await db
      .select({
        teacherId: teachingAssignments.teacherId,
        gradeName: gradeLevels.name,
        gradeSort: gradeLevels.sort,
        sectionName: classSections.name,
        subjectName: subjects.name,
        subjectSort: subjects.sort,
      })
      .from(teachingAssignments)
      .innerJoin(classSections, eq(classSections.id, teachingAssignments.classSectionId))
      .innerJoin(gradeLevels, eq(gradeLevels.id, classSections.gradeLevelId))
      .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
      .where(
        and(
          eq(teachingAssignments.schoolId, schoolId),
          eq(classSections.academicYearId, year.id),
          inArray(
            teachingAssignments.teacherId,
            members.map((m) => m.userId),
          ),
        ),
      );
    assignments.sort(
      (a, b) =>
        a.gradeSort - b.gradeSort ||
        a.sectionName.localeCompare(b.sectionName, 'ar') ||
        a.subjectSort - b.subjectSort ||
        a.subjectName.localeCompare(b.subjectName, 'ar'),
    );
    const memberBy = new Map(members.map((m) => [m.userId, m]));
    for (const a of assignments) {
      memberBy.get(a.teacherId)?.assignments.push({
        classLabel: `${a.gradeName} - ${a.sectionName}`,
        subjectName: a.subjectName,
      });
    }
  }
  return members.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
}

/** The user's staff roles in the school. */
async function staffRolesOf(db: Db, schoolId: string, userId: string): Promise<Role[]> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.schoolId, schoolId),
        eq(memberships.userId, userId),
        inArray(memberships.role, [...STAFF_ROLES]),
      ),
    );
  return rows.map((r) => r.role);
}

/**
 * Staff management (admin "المشرفين" / "الأساتذة"): /api/schools/:schoolId/staff
 *   GET    /?role=teacher|supervisor|admin  → staff with roles, status and current-year assignments
 *   POST   / {fullName, phone, role}        → add (or reuse) the user, grant the role, issue a code if pending
 *   POST   /:userId/activation-code         → a fresh activation code for a staff member who has not activated
 *   DELETE /:userId?role=                   → remove that role from the school
 */
export function staffRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.use(requireRole('admin'));

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const { role } = parse(listQuery, req.query);
    res.json(await listStaff(db, school.id, role));
  });

  r.post('/', async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const body = parse(createBody, req.body);
    const result = await db.transaction(async (tx) => {
      const { user } = await findOrCreateUser(tx, { phone: body.phone, fullName: body.fullName });
      const roles = await staffRolesOf(tx, school.id, user.id);
      if (roles.includes(body.role)) throw conflict('هذا الرقم مسجل مسبقاً بنفس الصفة في المدرسة');
      await ensureMembership(tx, user.id, school.id, body.role);
      const activation = user.status === 'pending' ? await issueActivationCode(tx, user.id, actor.id) : null;
      await audit(tx, {
        schoolId: school.id,
        actorId: actor.id,
        entity: 'membership',
        entityId: user.id,
        action: 'create',
        after: { role: body.role },
      });
      return { user, activation };
    });
    res.status(201).json({
      userId: result.user.id,
      fullName: result.user.fullName,
      phone: result.user.phone,
      status: result.user.status,
      activationCode: result.activation?.code ?? null,
      expiresAt: result.activation?.expiresAt.toISOString() ?? null,
    });
  });

  r.post('/:userId/activation-code', async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const userId = parse(zId, req.params.userId);
    const roles = await staffRolesOf(db, school.id, userId);
    if (!roles.length) throw notFound('الموظف غير موجود');
    const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    // An activated account belongs to its owner (and may hold roles in other schools): no takeover codes.
    if (!user || user.status !== 'pending') throw conflict('الحساب مفعّل مسبقاً');
    const { code, expiresAt } = await issueActivationCode(db, userId, actor.id);
    res.json({ code, expiresAt: expiresAt.toISOString() });
  });

  r.delete('/:userId', async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const userId = parse(zId, req.params.userId);
    const { role } = parse(roleQuery, req.query);
    if (role === 'admin' && userId === actor.id) throw badRequest('لا يمكنك إزالة صلاحية المدير من حسابك');
    const roles = await staffRolesOf(db, school.id, userId);
    if (!roles.includes(role)) throw notFound('الموظف غير موجود');

    const today = schoolToday(school);
    const year = await currentAcademicYear(db, school.id);
    await db.transaction(async (tx) => {
      await tx
        .delete(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, school.id), eq(memberships.role, role)));
      // Supervisors may also teach; only someone who can no longer teach here loses their classes.
      const stillTeaches = roles.some((r) => r !== role && (r === 'teacher' || r === 'supervisor'));
      if (role !== 'admin' && !stillTeaches) {
        await tx
          .delete(teachingAssignments)
          .where(and(eq(teachingAssignments.schoolId, school.id), eq(teachingAssignments.teacherId, userId)));
        // Periods of the current (and any future) year stay in the timetable without a teacher;
        // past years keep their history.
        const openClasses = tx
          .select({ id: classSections.id })
          .from(classSections)
          .innerJoin(academicYears, eq(academicYears.id, classSections.academicYearId))
          .where(
            and(
              eq(classSections.schoolId, school.id),
              or(gte(academicYears.endsOn, today), year ? eq(academicYears.id, year.id) : undefined),
            ),
          );
        await tx
          .update(timetableSlots)
          .set({ teacherId: null })
          .where(
            and(
              eq(timetableSlots.schoolId, school.id),
              eq(timetableSlots.teacherId, userId),
              inArray(timetableSlots.classSectionId, openClasses),
            ),
          );
      }
      await audit(tx, {
        schoolId: school.id,
        actorId: actor.id,
        entity: 'membership',
        entityId: userId,
        action: 'delete',
        before: { role },
      });
    });
    res.json({ ok: true });
  });

  return r;
}
