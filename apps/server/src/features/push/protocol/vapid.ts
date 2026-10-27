// VAPID (RFC 8292): the server proves to the push service which keys it subscribed with, using a
// short-lived ES256 JWT sent as `Authorization: vapid t=<jwt>, k=<public key>`.
import {
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { fromBase64Url, toBase64Url } from './base64url';

/** RFC 8292 section 2: a token may be valid for at most 24 hours. */
export const MAX_VAPID_TOKEN_SECONDS = 24 * 60 * 60;
const DEFAULT_TOKEN_SECONDS = 12 * 60 * 60;

/** A VAPID key pair as written in the server's settings file: base64url without padding. */
export interface VapidKeyStrings {
  /** P-256 public key, uncompressed (65 bytes). Browsers subscribe with it. */
  publicKey: string;
  /** P-256 private key (32 bytes). Secret: settings file only, never in responses or logs. */
  privateKey: string;
}

/** Imported keys. The private key is a `KeyObject`, so logs and JSON never show it. */
export interface VapidKeys {
  publicKey: string;
  privateKey: KeyObject;
}

/** Thrown for unusable keys. Its message never contains key material. */
export class VapidKeyError extends Error {
  override name = 'VapidKeyError';
}

/** Makes a new key pair for the settings file. */
export function generateVapidKeys(): VapidKeyStrings {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
    format: 'jwk',
  });
  if (!jwk.d || !jwk.x || !jwk.y) throw new VapidKeyError('Could not create VAPID keys.');
  const point = Buffer.concat([Buffer.of(4), fromBase64Url(jwk.x), fromBase64Url(jwk.y)]);
  return { publicKey: toBase64Url(point), privateKey: jwk.d };
}

/** Checks and imports a key pair. Throws `VapidKeyError` for a malformed or mismatched key. */
export function importVapidKeys(keys: VapidKeyStrings): VapidKeys {
  const d = decode(keys.privateKey, 32, 'The VAPID private key must be 32 bytes in base64url.');
  const point = decode(keys.publicKey, 65, 'The VAPID public key must be 65 bytes in base64url.');
  const ecdh = createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(d);
  } catch {
    throw new VapidKeyError('The VAPID private key is not a valid P-256 key.');
  }
  if (!ecdh.getPublicKey().equals(point)) {
    throw new VapidKeyError("The VAPID public key doesn't match the private key.");
  }
  const privateKey = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: toBase64Url(d),
      x: toBase64Url(point.subarray(1, 33)),
      y: toBase64Url(point.subarray(33)),
    },
  });
  return { publicKey: toBase64Url(point), privateKey };
}

export interface VapidTokenOptions {
  keys: VapidKeys;
  /** The push service's origin, e.g. `https://fcm.googleapis.com` (the "aud" claim). */
  audience: string;
  /** A `mailto:` or `https:` contact for the push service's operators (the "sub" claim). */
  subject: string;
  now?: Date;
  /** Default 12 hours; at most 24. */
  expiresInSeconds?: number;
}

/** A signed ES256 JWT for one push service. */
export function createVapidToken(options: VapidTokenOptions): string {
  const lifetime = options.expiresInSeconds ?? DEFAULT_TOKEN_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > MAX_VAPID_TOKEN_SECONDS) {
    throw new RangeError('A VAPID token lives between 1 second and 24 hours.');
  }
  const exp = Math.floor((options.now ?? new Date()).getTime() / 1000) + lifetime;
  const claims = { aud: options.audience, exp, sub: options.subject };
  const input = `${json({ typ: 'JWT', alg: 'ES256' })}.${json(claims)}`;
  // JWS wants the raw 64-byte r || s signature, not DER.
  const signature = sign('sha256', Buffer.from(input), {
    key: options.keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${toBase64Url(signature)}`;
}

/** The `Authorization` header value for one push request (RFC 8292 section 3). */
export function vapidAuthorization(options: VapidTokenOptions): string {
  return `vapid t=${createVapidToken(options)}, k=${options.keys.publicKey}`;
}

function json(value: unknown): string {
  return toBase64Url(Buffer.from(JSON.stringify(value)));
}

function decode(text: string, length: number, message: string): Buffer {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(text.trim());
  } catch {
    throw new VapidKeyError(message);
  }
  if (bytes.length !== length) throw new VapidKeyError(message);
  return Buffer.from(bytes);
}
