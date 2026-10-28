import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { open, openJson, seal, sealJson, SecretError } from './secrets';

const key = randomBytes(32);

describe('sealed values', () => {
  it('open only with the same key and context', () => {
    const sealed = seal(key, 'meetings-video:one', 'zat-example-token');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('zat-example-token');
    expect(open(key, 'meetings-video:one', sealed)).toBe('zat-example-token');
    expect(() => open(key, 'meetings-video:two', sealed)).toThrow(SecretError);
    expect(() => open(randomBytes(32), 'meetings-video:one', sealed)).toThrow(SecretError);
  });

  it('get a new nonce each time', () => {
    expect(seal(key, 'context', 'same')).not.toBe(seal(key, 'context', 'same'));
  });

  it("use Calendar's v1 format: nonce, tag, then ciphertext, in base64url", () => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('meetings-video:three', 'utf8'));
    const body = Buffer.concat([cipher.update('hello', 'utf8'), cipher.final()]);
    const sealed = `v1.${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url')}`;
    expect(open(key, 'meetings-video:three', sealed)).toBe('hello');
    expect(Buffer.from(seal(key, 'c', 'hello').slice(3), 'base64url')).toHaveLength(12 + 16 + 5);
  });

  it('refuse changed, cut or unknown values', () => {
    const bytes = Buffer.from(seal(key, 'context', 'value').slice(3), 'base64url');
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(() => open(key, 'context', `v1.${changed.toString('base64url')}`)).toThrow(SecretError);
    expect(() => open(key, 'context', `v1.${bytes.subarray(0, 20).toString('base64url')}`)).toThrow(
      SecretError,
    );
    expect(() => open(key, 'context', `v2.${bytes.toString('base64url')}`)).toThrow(SecretError);
    expect(() => open(key, 'context', '')).toThrow(SecretError);
  });

  it('check the shape of sealed JSON after opening', () => {
    const schema = z.object({ accessToken: z.string() });
    const sealed = sealJson(key, 'context', { accessToken: 'zat-1' });
    expect(openJson(key, 'context', sealed, schema)).toEqual({ accessToken: 'zat-1' });
    const wrongShape = sealJson(key, 'context', { accessToken: 1 });
    expect(() => openJson(key, 'context', wrongShape, schema)).toThrow(SecretError);
    expect(() => openJson(key, 'context', seal(key, 'context', '{'), schema)).toThrow(SecretError);
  });
});
