import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SecretError, openJson, sealJson, secretBoxFrom } from './secrets';

const key = () => randomBytes(32).toString('base64');
const LINK = 'https://calendar.example.org/private-5d1c/family.ics';

describe('secret box', () => {
  it('opens what it sealed, and never shows the secret', () => {
    const box = secretBoxFrom(key());
    if (!box) throw new Error('no box');
    const sealed = box.seal(LINK, 'calendar-connection:1');
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('example.org');
    expect(box.seal(LINK, 'calendar-connection:1')).not.toBe(sealed);
    expect(box.open(sealed, 'calendar-connection:1')).toBe(LINK);
  });

  it('refuses a value sealed for another row, with another key, or changed', () => {
    const box = secretBoxFrom(key());
    const other = secretBoxFrom(key());
    if (!box || !other) throw new Error('no box');
    const sealed = box.seal(LINK, 'calendar-connection:1');
    expect(() => box.open(sealed, 'calendar-connection:2')).toThrow(SecretError);
    expect(() => other.open(sealed, 'calendar-connection:1')).toThrow(SecretError);
    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}${sealed.slice(-1)}`;
    expect(() => box.open(flipped, 'calendar-connection:1')).toThrow(SecretError);
    expect(() => box.open('plain text', 'calendar-connection:1')).toThrow(SecretError);
    expect(() => box.open('v1.', 'calendar-connection:1')).toThrow(SecretError);
  });

  it('needs a 32-byte key in base64', () => {
    expect(secretBoxFrom(undefined)).toBeUndefined();
    expect(secretBoxFrom('  ')).toBeUndefined();
    expect(secretBoxFrom(randomBytes(16).toString('base64'))).toBeUndefined();
    expect(secretBoxFrom('not base64 at all!')).toBeUndefined();
    expect(secretBoxFrom(` ${key()}\n`)).toBeDefined();
    expect(secretBoxFrom(randomBytes(32).toString('base64url'))).toBeDefined();
  });

  it('seals JSON and checks its shape when opening', () => {
    const box = secretBoxFrom(key());
    if (!box) throw new Error('no box');
    const schema = z.object({ url: z.string() });
    const sealed = sealJson(box, { url: LINK }, 'c:1');
    expect(openJson(box, sealed, 'c:1', schema)).toEqual({ url: LINK });
    expect(() => openJson(box, sealJson(box, { href: LINK }, 'c:1'), 'c:1', schema)).toThrow(
      SecretError,
    );
    expect(() => openJson(box, box.seal('{not json', 'c:1'), 'c:1', schema)).toThrow(SecretError);
  });
});
