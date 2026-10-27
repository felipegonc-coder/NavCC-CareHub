import { createPublicKey, verify } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64url';
import {
  createVapidToken,
  generateVapidKeys,
  importVapidKeys,
  vapidAuthorization,
  VapidKeyError,
} from './vapid';

const now = new Date('2026-10-26T15:00:00Z');
const audience = 'https://push.example.net';
const subject = 'mailto:care-team@example.org';

function decodePart(part: string | undefined): unknown {
  return JSON.parse(Buffer.from(fromBase64Url(part ?? '')).toString('utf8'));
}

function verifies(token: string, publicKey: string): boolean {
  const [header, claims, signature] = token.split('.');
  const point = fromBase64Url(publicKey);
  const key = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(point.subarray(1, 33)),
      y: toBase64Url(point.subarray(33)),
    },
  });
  return verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key, dsaEncoding: 'ieee-p1363' },
    fromBase64Url(signature ?? ''),
  );
}

describe('VAPID keys', () => {
  it('generates a 65-byte public key and a 32-byte private key that import', () => {
    const strings = generateVapidKeys();
    expect(fromBase64Url(strings.publicKey).length).toBe(65);
    expect(fromBase64Url(strings.publicKey)[0]).toBe(4);
    expect(fromBase64Url(strings.privateKey).length).toBe(32);
    expect(importVapidKeys(strings).publicKey).toBe(strings.publicKey);
  });

  it('refuses keys that are malformed or from different pairs, without echoing them', () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    const attempts = [
      { publicKey: a.publicKey, privateKey: b.privateKey },
      { publicKey: a.publicKey, privateKey: 'not-a-key' },
      { publicKey: 'short', privateKey: a.privateKey },
      { publicKey: a.publicKey, privateKey: toBase64Url(Buffer.alloc(32)) },
    ];
    for (const keys of attempts) {
      let error: unknown;
      try {
        importVapidKeys(keys);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(VapidKeyError);
      expect(String(error)).not.toContain(keys.privateKey);
    }
  });

  it('never shows the private key in JSON or logs', () => {
    const strings = generateVapidKeys();
    const keys = importVapidKeys(strings);
    expect(JSON.stringify(keys)).not.toContain(strings.privateKey);
    expect(inspect(keys, { depth: 5 })).not.toContain(strings.privateKey);
  });
});

describe('createVapidToken', () => {
  it('signs an ES256 JWT with aud, exp and sub', () => {
    const strings = generateVapidKeys();
    const token = createVapidToken({ keys: importVapidKeys(strings), audience, subject, now });
    const [header, claims] = token.split('.');
    expect(decodePart(header)).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(decodePart(claims)).toEqual({
      aud: audience,
      exp: Date.parse('2026-10-27T03:00:00Z') / 1000,
      sub: subject,
    });
    expect(fromBase64Url(token.split('.')[2] ?? '').length).toBe(64);
    expect(verifies(token, strings.publicKey)).toBe(true);
    expect(verifies(token, generateVapidKeys().publicKey)).toBe(false);
  });

  it('keeps tokens to at most 24 hours', () => {
    const keys = importVapidKeys(generateVapidKeys());
    const day = createVapidToken({ keys, audience, subject, now, expiresInSeconds: 86_400 });
    expect(decodePart(day.split('.')[1])).toMatchObject({ exp: now.getTime() / 1000 + 86_400 });
    expect(() => createVapidToken({ keys, audience, subject, expiresInSeconds: 86_401 })).toThrow(
      RangeError,
    );
    expect(() => createVapidToken({ keys, audience, subject, expiresInSeconds: 0 })).toThrow(
      RangeError,
    );
  });

  it('builds the Authorization header with t= and k=', () => {
    const strings = generateVapidKeys();
    const header = vapidAuthorization({ keys: importVapidKeys(strings), audience, subject, now });
    const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    expect(match?.[2]).toBe(strings.publicKey);
    expect(verifies(match?.[1] ?? '', strings.publicKey)).toBe(true);
  });
});
