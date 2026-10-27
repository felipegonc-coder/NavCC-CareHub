import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library's default algorithm) with OWASP's minimum settings: 19 MiB of memory, 2
 * passes and 1 thread. Each hash stores its settings and its own random salt, so the settings can
 * go up later without breaking older hashes.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

/** An Argon2id hash for `users.password_hash`. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Whether `password` matches the stored hash. False, never an error, for a damaged hash. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

let throwawayHash: Promise<string> | undefined;

/**
 * For sign-in. Without a stored hash (an unknown email, or an account that has no password yet) it
 * still checks the password once, against a throwaway hash, so the answer takes as long either way
 * and doesn't show which emails have accounts.
 */
export async function passwordMatches(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash !== null) return verifyPassword(storedHash, password);
  throwawayHash ??= hashPassword(randomBytes(32).toString('base64url'));
  await verifyPassword(await throwawayHash, password);
  return false;
}
