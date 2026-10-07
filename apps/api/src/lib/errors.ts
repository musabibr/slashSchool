import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** Error with an HTTP status. `message` is shown to the user, so it is Arabic. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message = 'بيانات غير صالحة', details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'يجب تسجيل الدخول') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'ليس لديك صلاحية للقيام بهذا الإجراء') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'العنصر غير موجود') => new HttpError(404, 'not_found', message);
export const conflict = (message = 'العنصر موجود مسبقاً') => new HttpError(409, 'conflict', message);

function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Postgres errors surface with a `code`; drizzle wraps them in `cause`. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === 'string' && /^\d{5}$|^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  if (typeof e?.cause?.code === 'string') return e.cause.code;
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'bad_request', message: 'بيانات غير صالحة', details: zodDetails(err) } });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'حجم الملف أو البيانات أكبر من المسموح' } });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'بيانات غير صالحة' } });
    return;
  }
  const code = pgCode(err);
  if (code === '23505') {
    res.status(409).json({ error: { code: 'conflict', message: 'العنصر موجود مسبقاً' } });
    return;
  }
  if (code === '23503') {
    res.status(409).json({ error: { code: 'in_use', message: 'لا يمكن تنفيذ العملية لارتباط العنصر ببيانات أخرى' } });
    return;
  }
  if (code === '22P02') {
    res.status(400).json({ error: { code: 'bad_request', message: 'معرّف غير صالح' } });
    return;
  }
  req.log?.error({ err }, 'unhandled error');
  if (!req.log) console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'حدث خطأ غير متوقع، حاول مرة أخرى' } });
};
