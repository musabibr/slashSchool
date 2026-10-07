import { z } from 'zod';
import { HttpError } from '../../../lib/errors';

/** 409 with the same code/message shape the error handler uses for FK violations. */
export function inUse(message = 'لا يمكن تنفيذ العملية لارتباط العنصر ببيانات أخرى'): HttpError {
  return new HttpError(409, 'in_use', message);
}

/** Throws `inUse(message)` when any of the probe queries (each `… limit 1`) returns a row. */
export async function assertNotInUse(probes: Array<Promise<unknown[]>>, message: string): Promise<void> {
  const results = await Promise.all(probes);
  if (results.some((rows) => rows.length > 0)) throw inUse(message);
}

/** Display order of stages, grade levels and subjects. */
export const zSort = z
  .number({ invalid_type_error: 'الترتيب يجب أن يكون رقماً' })
  .int({ message: 'الترتيب يجب أن يكون رقماً صحيحاً' })
  .min(0, { message: 'الترتيب غير صالح' })
  .max(10_000, { message: 'الترتيب غير صالح' });

/** PATCH bodies must change at least one field. */
export const nonEmpty = <T extends Record<string, unknown>>(v: T) => Object.values(v).some((x) => x !== undefined);
export const NOTHING_TO_UPDATE = { message: 'لا توجد تغييرات للحفظ' };
