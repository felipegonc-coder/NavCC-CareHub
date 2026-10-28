// Sealing tokens and sign-ins with MEETINGS_SECRET_KEY: AES-256-GCM with a new random 12-byte
// nonce each time, a 16-byte tag, and a context such as meetings-video:<connectionId> as the
// associated data, so a sealed value only opens for its own row. The format is Calendar's:
// 'v1.' + base64url(nonce | tag | ciphertext). Keys, tokens and sealed values are never logged.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { z } from 'zod';

const PREFIX = 'v1.';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed value that doesn't open: another key or context, changed, or not the right shape. */
export class SecretError extends Error {
  constructor() {
    super("A sealed value didn't open.");
    this.name = 'SecretError';
  }
}

export function seal(key: Buffer, context: string, plain: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url');
}

export function open(key: Buffer, context: string, sealed: string): string {
  const bytes = Buffer.from(sealed.slice(PREFIX.length), 'base64url');
  if (!sealed.startsWith(PREFIX) || bytes.length < NONCE_BYTES + TAG_BYTES) throw new SecretError();
  try {
    const nonce = bytes.subarray(0, NONCE_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    const body = bytes.subarray(NONCE_BYTES + TAG_BYTES);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretError();
  }
}

export const sealJson = (key: Buffer, context: string, value: unknown) =>
  seal(key, context, JSON.stringify(value));

/** Opens a sealed JSON value and checks its shape. */
export function openJson<T>(key: Buffer, context: string, sealed: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(open(key, context, sealed));
  } catch {
    throw new SecretError();
  }
  const checked = schema.safeParse(value);
  if (!checked.success) throw new SecretError();
  return checked.data;
}
