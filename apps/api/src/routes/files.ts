import express, { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { files, memberships } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { requireAuth, schoolOf, userOf } from '../lib/context';
import { parse, zId } from '../lib/validate';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|audio\/(mpeg|mp4|ogg|webm|aac|x-m4a)|video\/mp4)$/;

/**
 * Upload (staff, school-scoped): POST /api/schools/:schoolId/files
 *   body = raw file bytes, Content-Type = file mime type, X-File-Name = encodeURIComponent(name)
 *   → 201 { id, fileName, mimeType, size, url }
 */
export function fileUploadRouter(db: Db) {
  const r = Router({ mergeParams: true });
  r.post('/', express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
    const school = schoolOf(req);
    const mimeType = String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED.test(mimeType)) throw badRequest('نوع الملف غير مدعوم (صور، PDF، صوت)');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('الملف فارغ');
    let fileName = 'file';
    try {
      fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')).slice(0, 200) || 'file';
    } catch {
      /* keep default */
    }
    const [row] = await db
      .insert(files)
      .values({ schoolId: school.id, uploadedBy: userOf(req).id, fileName, mimeType, size: body.length, data: body })
      .returning({ id: files.id, fileName: files.fileName, mimeType: files.mimeType, size: files.size });
    res.status(201).json({ ...row, url: `/api/files/${row.id}` });
  });
  return r;
}

/** Download: GET /api/files/:fileId — any member (staff or guardian) of the file's school. */
export function fileDownloadRouter(db: Db) {
  const r = Router();
  r.get('/:fileId', requireAuth, async (req, res) => {
    const fileId = parse(zId, req.params.fileId);
    const [file] = await db.select().from(files).where(eq(files.id, fileId));
    if (!file) throw notFound('الملف غير موجود');
    const [member] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userOf(req).id), eq(memberships.schoolId, file.schoolId)));
    if (!member) throw notFound('الملف غير موجود');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(file.data);
  });
  return r;
}
