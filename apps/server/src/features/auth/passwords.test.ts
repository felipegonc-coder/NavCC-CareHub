import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, passwordMatches, verifyPassword } from './passwords';

// Made up for each run, so no password is written here.
const password = randomBytes(18).toString('base64url');

describe('passwords', () => {
  it('stores Argon2id hashes (19 MiB, 2 passes, 1 thread), each with its own salt', async () => {
    const first = await hashPassword(password);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toContain(password);
    expect(await hashPassword(password)).not.toBe(first);
  });

  it('checks a password against its hash', async () => {
    const stored = await hashPassword(password);
    expect(await verifyPassword(stored, password)).toBe(true);
    expect(await verifyPassword(stored, `${password}x`)).toBe(false);
    expect(await verifyPassword('not a hash', password)).toBe(false);
  });

  it('answers false without a stored hash, after checking against a throwaway one', async () => {
    expect(await passwordMatches(null, password)).toBe(false);
    expect(await passwordMatches(await hashPassword(password), password)).toBe(true);
  });
});
