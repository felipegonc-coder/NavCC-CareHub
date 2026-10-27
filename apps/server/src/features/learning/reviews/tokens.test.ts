import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashReviewToken, isReviewToken, newReviewToken } from './tokens';

describe('review tokens', () => {
  it('are 32 random bytes in base64url, different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, newReviewToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(isReviewToken(token)).toBe(true);
    }
  });

  it('are kept only as their SHA-256, in hex', () => {
    const token = 'Ab0-_'.repeat(8) + 'Ab0';
    const hash = hashReviewToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
    expect(hashReviewToken(`${token.slice(0, -1)}1`)).not.toBe(hash);
  });

  it('turns away anything without a token shape before a lookup', () => {
    const token = 'Ab0-_'.repeat(8) + 'Ab0';
    for (const value of [
      undefined,
      '',
      token.slice(1),
      `${token}A`,
      `${token.slice(1)}=`,
      [token],
    ]) {
      expect(isReviewToken(value)).toBe(false);
    }
    expect(isReviewToken(`${token.slice(1)}+`)).toBe(false);
  });
});
