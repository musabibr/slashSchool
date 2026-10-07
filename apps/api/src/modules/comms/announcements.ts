import { Router } from 'express';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { joinName, normalizePhone, type AudienceType, type Relation } from '@slash/shared';
import type { Db } from '../../db/client';
import { announcements, studentGuardians, students, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { requireRole, schoolOf, userOf } from '../../lib/context';
import { notFound } from '../../lib/errors';
import { parse, zId } from '../../lib/validate';
import { assertAudienceInSchool, audienceNames } from './audience';
import { announcementListQuery, createAnnouncementSchema } from './schemas';

/** An announcement as the director sees it in the sent list. */
export interface StaffAnnouncementDto {
  id: string;
  title: string;
  body: string;
  audienceType: AudienceType;
  audienceId: string | null;
  audienceLabel: string;
  createdByName: string | null;
  publishedAt: string;
}

/** A phone the director can also reach the student's family on (WhatsApp share after "message guardian"). */
export interface GuardianContactDto {
  fullName: string;
  phone: string;
  relation: Relation;
  /** WhatsApp number from the admission form; null = use the phone. */
  whatsapp: string | null;
  isPrimary: boolean;
  /** True when this contact has an activated app account (sees the announcement in the app). */
  activated: boolean;
}

const columns = {
  id: announcements.id,
  title: announcements.title,
  body: announcements.body,
  audienceType: announcements.audienceType,
  audienceId: announcements.audienceId,
  createdByName: users.fullName,
  publishedAt: announcements.publishedAt,
};

async function listAnnouncements(
  db: Db,
  schoolId: string,
  where: SQL | undefined,
  page: { limit: number; offset: number },
): Promise<StaffAnnouncementDto[]> {
  const rows = await db
    .select(columns)
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.createdBy))
    .where(and(eq(announcements.schoolId, schoolId), where))
    .orderBy(desc(announcements.publishedAt), desc(announcements.id))
    .limit(page.limit)
    .offset(page.offset);
  const labelOf = await audienceNames(db, schoolId, rows);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    audienceType: r.audienceType,
    audienceId: r.audienceId,
    audienceLabel: labelOf(r),
    createdByName: r.createdByName ?? null,
    publishedAt: r.publishedAt.toISOString(),
  }));
}

/**
 * Announcements (director dashboard + "message guardian" on the student page), mounted at
 * /api/schools/:schoolId/announcements.
 *   GET    /                    ?audienceType&audienceId&limit&offset → sent announcements, newest first (admin, supervisor)
 *   POST   /                    {title, body, audienceType, audienceId?} → 201 (admin)
 *   DELETE /:announcementId     → { ok: true } (admin)
 *   GET    /contacts/:studentId → the student's guardian phones for WhatsApp (admin)
 */
export function staffAnnouncementsRouter(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', requireRole('admin', 'supervisor'), async (req, res) => {
    const school = schoolOf(req);
    const q = parse(announcementListQuery, req.query);
    const where = and(
      q.audienceType ? eq(announcements.audienceType, q.audienceType) : undefined,
      q.audienceId ? eq(announcements.audienceId, q.audienceId) : undefined,
    );
    res.json(await listAnnouncements(db, school.id, where, q));
  });

  r.post('/', requireRole('admin'), async (req, res) => {
    const school = schoolOf(req);
    const user = userOf(req);
    const body = parse(createAnnouncementSchema, req.body);
    await assertAudienceInSchool(db, school.id, body.audienceType, body.audienceId);
    const [row] = await db
      .insert(announcements)
      .values({
        schoolId: school.id,
        title: body.title,
        body: body.body,
        audienceType: body.audienceType,
        audienceId: body.audienceId,
        createdBy: user.id,
      })
      .returning({ id: announcements.id });
    const [created] = await listAnnouncements(db, school.id, eq(announcements.id, row.id), { limit: 1, offset: 0 });
    res.status(201).json(created);
  });

  r.delete('/:announcementId', requireRole('admin'), async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.announcementId);
    const [deleted] = await db
      .delete(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.schoolId, school.id)))
      .returning();
    if (!deleted) throw notFound('الإعلان غير موجود');
    await audit(db, {
      schoolId: school.id,
      actorId: userOf(req).id,
      entity: 'announcement',
      entityId: id,
      action: 'delete',
      before: {
        title: deleted.title,
        body: deleted.body,
        audienceType: deleted.audienceType,
        audienceId: deleted.audienceId,
        publishedAt: deleted.publishedAt.toISOString(),
      },
    });
    res.json({ ok: true });
  });

  r.get('/contacts/:studentId', requireRole('admin'), async (req, res) => {
    const school = schoolOf(req);
    const studentId = parse(zId, req.params.studentId);
    const [student] = await db
      .select({
        firstName: students.firstName,
        fatherName: students.fatherName,
        motherName: students.motherName,
        motherPhone: students.motherPhone,
        motherWhatsapp: students.motherWhatsapp,
      })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.schoolId, school.id)));
    if (!student) throw notFound('الطالب غير موجود');

    const guardians = await db
      .select({
        fullName: users.fullName,
        phone: users.phone,
        status: users.status,
        relation: studentGuardians.relation,
        whatsapp: studentGuardians.whatsapp,
        isPrimary: studentGuardians.isPrimary,
      })
      .from(studentGuardians)
      .innerJoin(users, eq(users.id, studentGuardians.userId))
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.schoolId, school.id)))
      .orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt));

    const contacts: GuardianContactDto[] = guardians.map((g) => ({
      fullName: g.fullName,
      phone: g.phone,
      relation: g.relation,
      whatsapp: g.whatsapp || null,
      isPrimary: g.isPrimary,
      activated: g.status === 'active',
    }));
    // The mother's numbers from the admission form (D3), unless she is already a linked guardian.
    const motherPhone = student.motherPhone || student.motherWhatsapp;
    const known = new Set(
      guardians.flatMap((g) => [g.phone, g.whatsapp].filter((p): p is string => !!p).map(normalizePhone)),
    );
    if (motherPhone && !known.has(normalizePhone(motherPhone))) {
      contacts.push({
        fullName: student.motherName || joinName('والدة', student.firstName, student.fatherName),
        phone: motherPhone,
        relation: 'mother',
        whatsapp: student.motherWhatsapp || null,
        isPrimary: false,
        activated: false,
      });
    }
    res.json(contacts);
  });

  return r;
}
