import { Router } from 'express';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { joinName } from '@slash/shared';
import type { Db } from '../../../db/client';
import { classSections, memberships, readCursors, studentGuardians, students } from '../../../db/schema';
import { audit } from '../../../lib/audit';
import { requireRole, schoolOf, schoolToday, userOf } from '../../../lib/context';
import { badRequest, notFound } from '../../../lib/errors';
import { issueStudentLinkCode } from '../../../lib/users';
import { parse, zId } from '../../../lib/validate';
import { executeImport, prepareImport } from './import';
import {
  addGuardianSchema,
  admissionSchema,
  importSchema,
  listStudentsQuery,
  statusSchema,
  updateGuardianSchema,
  updateStudentSchema,
} from './schemas';
import {
  assertGradeLevelInSchool,
  assertPlacementClass,
  findStudentInSchool,
  issueCodesForLinked,
  linkGuardian,
  listStudents,
  loadStudentProfile,
  lockStudentCodes,
  nextStudentNumber,
  searchTokens,
  studentCode,
  studentFullName,
  studentSearch,
} from './service';

const idParams = z.object({ id: zId });
const guardianParams = z.object({ id: zId, userId: zId });

/** 400 with a field-level message, like a validation failure. */
const fieldError = (path: string, message: string) => badRequest('بيانات غير صالحة', [{ path, message }]);

/**
 * Students (D2–D4), mounted at /api/schools/:schoolId/students.
 *   GET    /                          ?q&classId&gradeLevelId&status&limit&offset → {items, total}  (admin, supervisor)
 *   GET    /:id                       → profile with guardians                                       (admin, supervisor)
 *   POST   /                          → admission: student + guardian account(s) + activation codes  (admin)
 *   POST   /import                    → validate (dryRun) or import CSV rows                         (admin)
 *   PATCH  /:id                       → student and mother fields, placement                         (admin)
 *   PATCH  /:id/status                → active / withdrawn / expelled, audited                       (admin)
 *   POST   /:id/link-code             → a fresh student link code                                    (admin)
 *   POST   /:id/guardians             → link another guardian                                        (admin)
 *   PATCH  /:id/guardians/:userId     → the link's relation, contact and work details, primary flag  (admin)
 *   DELETE /:id/guardians/:userId     → unlink (never the last guardian)                             (admin)
 */
export function studentsRouter(db: Db) {
  const r = Router({ mergeParams: true });
  const staff = requireRole('admin', 'supervisor');
  const admin = requireRole('admin');

  r.get('/', staff, async (req, res) => {
    const school = schoolOf(req);
    const q = parse(listStudentsQuery, req.query);
    const where = and(
      eq(students.schoolId, school.id),
      q.classId === 'none'
        ? isNull(students.classSectionId)
        : q.classId
          ? eq(students.classSectionId, q.classId)
          : undefined,
      q.gradeLevelId ? eq(students.gradeLevelId, q.gradeLevelId) : undefined,
      q.status ? eq(students.status, q.status) : undefined,
      studentSearch(searchTokens(q.q)),
    );
    res.json(await listStudents(db, where, { limit: q.limit, offset: q.offset }));
  });

  r.post('/import', admin, async (req, res) => {
    const school = schoolOf(req);
    const body = parse(importSchema, req.body);
    const today = schoolToday(school);
    const { prepared, errors } = await prepareImport(db, school.id, body.rows, today);
    if (errors.length || body.dryRun) {
      res.json({ valid: errors.length === 0, rowCount: body.rows.length, errors });
      return;
    }
    const actor = userOf(req);
    const result = await db.transaction(async (tx) => {
      const out = await executeImport(tx, school.id, actor.id, prepared, today);
      await audit(tx, {
        schoolId: school.id,
        actorId: actor.id,
        entity: 'student_import',
        entityId: school.id,
        action: 'create',
        after: { created: out.created, codesIssued: out.codes.length },
      });
      return out;
    });
    res.status(201).json({ valid: true, rowCount: body.rows.length, errors: [], ...result });
  });

  r.get('/:id', staff, async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(await loadStudentProfile(db, schoolOf(req).id, id));
  });

  r.post('/', admin, async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const body = parse(admissionSchema, req.body);
    const { student: st, guardian: g, mother } = body;
    const today = schoolToday(school);
    if (st.birthDate && st.birthDate >= today) {
      throw fieldError('student.birthDate', 'تاريخ الميلاد يجب أن يكون قبل اليوم');
    }
    await assertGradeLevelInSchool(db, school.id, st.gradeLevelId);
    if (st.classSectionId) {
      await assertPlacementClass(db, school.id, st.classSectionId, st.gradeLevelId, 'student.classSectionId');
    }

    const result = await db.transaction(async (tx) => {
      await lockStudentCodes(tx, school.id);
      const code = studentCode(await nextStudentNumber(tx, school.id));
      const [row] = await tx
        .insert(students)
        .values({
          schoolId: school.id,
          code,
          firstName: st.firstName,
          fatherName: st.fatherName,
          grandfatherName: st.grandfatherName,
          greatGrandfatherName: st.greatGrandfatherName,
          gender: st.gender,
          birthDate: st.birthDate,
          gradeLevelId: st.gradeLevelId,
          classSectionId: st.classSectionId,
          registeredAt: st.registeredAt ?? today,
          motherName: mother.name,
          motherPhone: mother.phone,
          motherWhatsapp: mother.whatsapp,
        })
        .returning();

      const guardianUser = await linkGuardian(tx, school.id, row.id, {
        phone: g.phone,
        fullName: joinName(g.firstName, g.fatherName, g.grandfatherName, g.greatGrandfatherName),
        relation: g.relation,
        isPrimary: true,
        whatsapp: g.whatsapp,
        occupation: g.occupation,
        workplace: g.workplace,
        locality: g.locality,
        residence: g.residence,
      });
      const linked = [{ user: guardianUser, relation: g.relation, whatsapp: g.whatsapp }];
      if (body.motherAccount && mother.phone && mother.name) {
        const motherUser = await linkGuardian(tx, school.id, row.id, {
          phone: mother.phone,
          fullName: mother.name,
          relation: 'mother',
          isPrimary: false,
          whatsapp: mother.whatsapp,
        });
        linked.push({ user: motherUser, relation: 'mother', whatsapp: mother.whatsapp });
      }
      const guardians = await issueCodesForLinked(tx, school.id, actor.id, linked);
      await audit(tx, {
        schoolId: school.id,
        actorId: actor.id,
        entity: 'student',
        entityId: row.id,
        action: 'create',
        after: {
          code,
          gradeLevelId: row.gradeLevelId,
          classSectionId: row.classSectionId,
          guardianIds: guardians.map((x) => x.userId),
        },
      });
      return { student: { id: row.id, code: row.code, fullName: studentFullName(row) }, guardians };
    });
    res.status(201).json(result);
  });

  r.patch('/:id', admin, async (req, res) => {
    const school = schoolOf(req);
    const { id } = parse(idParams, req.params);
    const body = parse(updateStudentSchema, req.body);
    const current = await findStudentInSchool(db, school.id, id);
    if (body.birthDate && body.birthDate >= schoolToday(school)) {
      throw fieldError('birthDate', 'تاريخ الميلاد يجب أن يكون قبل اليوم');
    }

    const patch: Partial<typeof students.$inferInsert> = {};
    for (const key of [
      'firstName',
      'fatherName',
      'grandfatherName',
      'greatGrandfatherName',
      'gender',
      'birthDate',
      'registeredAt',
      'notes',
      'motherName',
      'motherPhone',
      'motherWhatsapp',
    ] as const) {
      if (body[key] !== undefined) Object.assign(patch, { [key]: body[key] });
    }

    // Placement: a (new) class sets the grade level; a new grade level drops a class of another level.
    if (body.gradeLevelId !== undefined || body.classSectionId !== undefined) {
      if (body.gradeLevelId !== undefined) await assertGradeLevelInSchool(db, school.id, body.gradeLevelId);
      let classId = body.classSectionId === undefined ? current.classSectionId : body.classSectionId;
      let gradeId = body.gradeLevelId ?? current.gradeLevelId;
      if (classId && classId !== current.classSectionId) {
        const cls = await assertPlacementClass(db, school.id, classId, body.gradeLevelId);
        gradeId = cls.gradeLevelId;
      } else if (classId && body.gradeLevelId !== undefined) {
        const [cls] = await db
          .select({ gradeLevelId: classSections.gradeLevelId })
          .from(classSections)
          .where(eq(classSections.id, classId));
        if (cls?.gradeLevelId !== body.gradeLevelId) {
          if (body.classSectionId !== undefined) {
            throw fieldError('classSectionId', 'الفصل لا ينتمي للسنة الدراسية المختارة');
          }
          classId = null;
        }
      }
      patch.classSectionId = classId;
      patch.gradeLevelId = gradeId;
    }

    if (Object.keys(patch).length) {
      await db
        .update(students)
        .set(patch)
        .where(and(eq(students.id, id), eq(students.schoolId, school.id)));
    }
    res.json(await loadStudentProfile(db, school.id, id));
  });

  r.patch('/:id/status', admin, async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const { id } = parse(idParams, req.params);
    const body = parse(statusSchema, req.body);
    const current = await findStudentInSchool(db, school.id, id);
    if (current.status !== body.status || (current.statusReason ?? null) !== body.reason) {
      await db.transaction(async (tx) => {
        await tx
          .update(students)
          .set({ status: body.status, statusReason: body.reason, statusChangedAt: new Date() })
          .where(and(eq(students.id, id), eq(students.schoolId, school.id)));
        await audit(tx, {
          schoolId: school.id,
          actorId: actor.id,
          entity: 'student',
          entityId: id,
          action: body.status === 'expelled' ? 'expel' : 'status',
          before: { status: current.status, reason: current.statusReason },
          after: { status: body.status, reason: body.reason },
        });
      });
    }
    res.json(await loadStudentProfile(db, school.id, id));
  });

  r.post('/:id/link-code', admin, async (req, res) => {
    const school = schoolOf(req);
    const { id } = parse(idParams, req.params);
    await findStudentInSchool(db, school.id, id);
    const { code } = await issueStudentLinkCode(db, id);
    res.status(201).json({ code });
  });

  r.post('/:id/guardians', admin, async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const { id } = parse(idParams, req.params);
    const body = parse(addGuardianSchema, req.body);
    await findStudentInSchool(db, school.id, id);
    const issued = await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(studentGuardians).where(eq(studentGuardians.studentId, id));
      const user = await linkGuardian(tx, school.id, id, { ...body, isPrimary: n === 0 || body.isPrimary === true });
      const [out] = await issueCodesForLinked(tx, school.id, actor.id, [
        { user, relation: body.relation, whatsapp: body.whatsapp },
      ]);
      return out;
    });
    res.status(201).json(issued);
  });

  r.patch('/:id/guardians/:userId', admin, async (req, res) => {
    const school = schoolOf(req);
    const { id, userId } = parse(guardianParams, req.params);
    const body = parse(updateGuardianSchema, req.body);
    await findStudentInSchool(db, school.id, id);
    const [link] = await db
      .select()
      .from(studentGuardians)
      .where(and(eq(studentGuardians.studentId, id), eq(studentGuardians.userId, userId)));
    if (!link) throw notFound('ولي الأمر غير مرتبط بهذا الطالب');
    if (body.isPrimary === false && link.isPrimary) {
      throw fieldError('isPrimary', 'لتغيير ولي الأمر الأساسي اجعل ولي أمر آخر أساسياً');
    }
    const { isPrimary, ...details } = body;
    const patch = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined));
    await db.transaction(async (tx) => {
      if (isPrimary && !link.isPrimary) {
        await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, id));
        Object.assign(patch, { isPrimary: true });
      }
      if (Object.keys(patch).length) {
        await tx.update(studentGuardians).set(patch).where(eq(studentGuardians.id, link.id));
      }
    });
    res.json(await loadStudentProfile(db, school.id, id));
  });

  r.delete('/:id/guardians/:userId', admin, async (req, res) => {
    const school = schoolOf(req);
    const actor = userOf(req);
    const { id, userId } = parse(guardianParams, req.params);
    await findStudentInSchool(db, school.id, id);
    await db.transaction(async (tx) => {
      const links = await tx
        .select()
        .from(studentGuardians)
        .where(eq(studentGuardians.studentId, id))
        .orderBy(asc(studentGuardians.createdAt));
      const target = links.find((l) => l.userId === userId);
      if (!target) throw notFound('ولي الأمر غير مرتبط بهذا الطالب');
      if (links.length === 1) throw badRequest('لا يمكن حذف ولي الأمر الوحيد للطالب');
      await tx.delete(studentGuardians).where(eq(studentGuardians.id, target.id));
      if (target.isPrimary) {
        const next = links.find((l) => l.id !== target.id)!;
        await tx.update(studentGuardians).set({ isPrimary: true }).where(eq(studentGuardians.id, next.id));
      }
      await tx.delete(readCursors).where(and(eq(readCursors.userId, userId), eq(readCursors.studentId, id)));
      // No other child at this school: the account stops being one of the school's guardians.
      const [{ n }] = await tx
        .select({ n: count() })
        .from(studentGuardians)
        .where(and(eq(studentGuardians.userId, userId), eq(studentGuardians.schoolId, school.id)));
      if (n === 0) {
        await tx
          .delete(memberships)
          .where(
            and(eq(memberships.userId, userId), eq(memberships.schoolId, school.id), eq(memberships.role, 'guardian')),
          );
      }
      await audit(tx, {
        schoolId: school.id,
        actorId: actor.id,
        entity: 'student_guardian',
        entityId: target.id,
        action: 'delete',
        before: { studentId: id, userId, relation: target.relation, isPrimary: target.isPrimary },
      });
    });
    res.json({ ok: true });
  });

  return r;
}
