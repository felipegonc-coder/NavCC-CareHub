// Seals calendar secrets: Google sign-ins, private calendar links and iCloud app-specific
// passwords (Calendar spec, Connections; CA-11). AES-256-GCM with CALENDAR_SECRET_KEY, a new
// random nonce every time, and the row the secret belongs to as associated data, so a sealed
// value only opens for that row. Sealed values never leave the server.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const PREFIX = 'v1.';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export const CONNECTIONS_OFF_MESSAGE = "Calendar connections aren't set up yet.";

/** For `readSettings` (core/settings.ts). Empty counts as not set. */
export const calendarSecretSettingsSchema = z.object({
  CALENDAR_SECRET_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
});

export class SecretError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SecretError';
  }
}

export interface SecretBox {
  /** `context` names the row, such as `calendar-connection:<id>`. */
  seal(plain: string, context: string): string;
  /** Throws SecretError when the value was changed, sealed for another row or with another key. */
  open(sealed: string, context: string): string;
}

/** The box for CALENDAR_SECRET_KEY, or undefined when it's unset or isn't 32 bytes in base64. */
export function secretBoxFrom(base64Key: string | undefined): SecretBox | undefined {
  const value = base64Key?.trim();
  if (!value || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return undefined;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) return undefined;
  return {
    seal(plain, context) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url');
    },
    open(sealed, context) {
      const raw = sealed.startsWith(PREFIX)
        ? Buffer.from(sealed.slice(PREFIX.length), 'base64url')
        : Buffer.alloc(0);
      if (raw.length < NONCE_BYTES + TAG_BYTES) throw new SecretError('Not a sealed value.');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, NONCE_BYTES), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
      try {
        const body = raw.subarray(NONCE_BYTES + TAG_BYTES);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      } catch (error) {
        throw new SecretError("The sealed value couldn't be opened.", { cause: error });
      }
    },
  };
}

/** Seals a value as JSON. */
export function sealJson(box: SecretBox, value: unknown, context: string): string {
  return box.seal(JSON.stringify(value), context);
}

/** Opens a JSON value and checks its shape. Throws SecretError when either fails. */
export function openJson<T>(box: SecretBox, sealed: string, context: string, schema: z.ZodType<T>) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(box.open(sealed, context));
  } catch (error) {
    if (error instanceof SecretError) throw error;
    throw new SecretError('The sealed value is not JSON.', { cause: error });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new SecretError('The sealed value has the wrong shape.');
  return result.data;
}
