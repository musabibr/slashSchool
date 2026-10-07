import { Router } from 'express';
import { and, eq, ne, sql, type Column, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { behaviorIncidents, regulations } from '../../db/schema';
import { requireRole, schoolOf } from '../../lib/context';
import { conflict } from '../../lib/errors';
import { parse, zId } from '../../lib/validate';
import { createRegulationSchema, updateRegulationSchema } from './schemas';
import { compareRegulations, findRegulationInSchool, incidentCounts, type RegulationDto } from './service';

/** Case- and space-insensitive comparison key for codes and titles. */
const normalized = (column: Column) => sql`lower(btrim(${column}))`;

/**
 * School regulations catalog (اللوائح المدرسية), mounted at /api/schools/:schoolId/regulations.
 *   GET    /      (any staff)            → [{ id, code, title, defaultPenalty, incidentCount }]
 *   POST   /      (admin, supervisor)    → 201 regulation
 *   PATCH  /:id   (admin, supervisor)    → regulation
 *   DELETE /:id   (admin, supervisor)    → { ok: true }; 409 while incidents use it
 */
export function regulationsRouter(db: Db) {
  const r = Router({ mergeParams: true });
  const manage = requireRole('admin', 'supervisor');

  async function toDto(schoolId: string, id: string): Promise<RegulationDto> {
    const row = await findRegulationInSchool(db, schoolId, id);
    const counts = await incidentCounts(db, [row.id]);
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      defaultPenalty: row.defaultPenalty,
      incidentCount: counts.get(row.id) ?? 0,
    };
  }

  /** 409 when another regulation of the school already uses this code or title. */
  async function assertUnique(schoolId: string, values: { code?: string | null; title?: string }, exceptId?: string) {
    const others = (cond: SQL) =>
      db
        .select({ id: regulations.id })
        .from(regulations)
        .where(and(eq(regulations.schoolId, schoolId), exceptId ? ne(regulations.id, exceptId) : undefined, cond))
        .limit(1);
    if (values.code) {
      const [dup] = await others(sql`${normalized(regulations.code)} = ${values.code.toLowerCase()}`);
      if (dup) throw conflict('يوجد لائحة أخرى بنفس الرقم');
    }
    if (values.title) {
      const [dup] = await others(sql`${normalized(regulations.title)} = ${values.title.toLowerCase()}`);
      if (dup) throw conflict('يوجد لائحة أخرى بنفس العنوان');
    }
  }

  r.get('/', async (req, res) => {
    const school = schoolOf(req);
    const rows = await db.select().from(regulations).where(eq(regulations.schoolId, school.id));
    const counts = await incidentCounts(
      db,
      rows.map((x) => x.id),
    );
    const list: RegulationDto[] = rows.sort(compareRegulations).map((x) => ({
      id: x.id,
      code: x.code,
      title: x.title,
      defaultPenalty: x.defaultPenalty,
      incidentCount: counts.get(x.id) ?? 0,
    }));
    res.json(list);
  });

  r.post('/', manage, async (req, res) => {
    const school = schoolOf(req);
    const body = parse(createRegulationSchema, req.body);
    await assertUnique(school.id, body);
    const [row] = await db
      .insert(regulations)
      .values({ schoolId: school.id, code: body.code, title: body.title, defaultPenalty: body.defaultPenalty })
      .returning({ id: regulations.id });
    res.status(201).json(await toDto(school.id, row.id));
  });

  r.patch('/:id', manage, async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    const body = parse(updateRegulationSchema, req.body);
    const existing = await findRegulationInSchool(db, school.id, id);
    await assertUnique(school.id, body, existing.id);
    await db
      .update(regulations)
      .set({
        code: body.code !== undefined ? body.code : existing.code,
        title: body.title ?? existing.title,
        defaultPenalty: body.defaultPenalty !== undefined ? body.defaultPenalty : existing.defaultPenalty,
      })
      .where(and(eq(regulations.id, id), eq(regulations.schoolId, school.id)));
    res.json(await toDto(school.id, id));
  });

  r.delete('/:id', manage, async (req, res) => {
    const school = schoolOf(req);
    const id = parse(zId, req.params.id);
    await findRegulationInSchool(db, school.id, id);
    const [used] = await db
      .select({ id: behaviorIncidents.id })
      .from(behaviorIncidents)
      .where(eq(behaviorIncidents.regulationId, id))
      .limit(1);
    if (used) throw conflict('لا يمكن حذف لائحة مسجل عليها مخالفات');
    // The FK (on delete restrict) still guards against an incident recorded meanwhile → 409 in_use.
    await db.delete(regulations).where(and(eq(regulations.id, id), eq(regulations.schoolId, school.id)));
    res.json({ ok: true });
  });

  return r;
}
