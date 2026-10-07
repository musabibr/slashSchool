import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** Slow hash for PINs: scrypt$<salt>$<hash> (base64). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(secret, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(secret, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** Fast deterministic hash for high-entropy random tokens and codes (lookup by value). */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// No 0/O, 1/I/L — codes are read aloud and typed from paper.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** e.g. K7QF-M2XD-9P (10 random characters ≈ 50 bits). */
export function generateCode(length = 10): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) chars.push(CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]);
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

/** Case/spacing/dash-insensitive form used for hashing. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export const hashCode = (code: string) => sha256(`code:${normalizeCode(code)}`);
