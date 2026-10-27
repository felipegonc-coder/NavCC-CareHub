// Message encryption for Web Push (RFC 8291): ECDH with the browser's key plus its auth secret,
// then the "aes128gcm" content coding (RFC 8188) as one record with padding.
import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { fromBase64Url } from './base64url';

/** Push services must accept bodies up to 4096 bytes (RFC 8030 section 7.2); some refuse more. */
export const MAX_PUSH_BODY_BYTES = 4096;
/** salt (16) + record size (4) + key id length (1) + key id: the sender's public key (65). */
const HEADER_BYTES = 86;
const TAG_BYTES = 16;
/** The most plaintext plus padding that fits one 4096-byte body (RFC 8291 section 4): 3993. */
export const MAX_PLAINTEXT_BYTES = MAX_PUSH_BODY_BYTES - HEADER_BYTES - 1 - TAG_BYTES;
/** Bigger than any single record we write, as RFC 8291 section 4 requires. */
const RECORD_SIZE = 4096;
const LAST_RECORD = 2;

/** A subscription's keys, as in the browser's `PushSubscription.toJSON().keys` (base64url). */
export interface PushSubscriptionKeys {
  /** The browser's P-256 public key, uncompressed (65 bytes). */
  p256dh: string;
  /** The browser's authentication secret (16 bytes). */
  auth: string;
}

export interface EncryptOptions {
  /** Zero bytes after the content, so the push service can't tell its exact length. Default 0. */
  padding?: number;
  /**
   * Tests only: a fixed salt and sender key, to reproduce RFC 8291's example. Real messages
   * always get fresh ones; reusing them would reuse the AES-GCM key and nonce.
   */
  fixedForTest?: { salt: Uint8Array; senderPrivateKey: Uint8Array };
}

/** Encrypts one push message body for one subscription. Throws a `RangeError` if it's too big. */
export function encryptPushMessage(
  plaintext: Uint8Array,
  keys: PushSubscriptionKeys,
  options: EncryptOptions = {},
): Uint8Array {
  const padding = options.padding ?? 0;
  if (!Number.isInteger(padding) || padding < 0) {
    throw new RangeError('Padding must be a whole number of bytes.');
  }
  if (plaintext.length + padding > MAX_PLAINTEXT_BYTES) {
    throw new RangeError(`A push message holds at most ${MAX_PLAINTEXT_BYTES} bytes.`);
  }
  const browserKey = decode(keys.p256dh, 65, 'p256dh');
  const authSecret = decode(keys.auth, 16, 'auth');

  const sender = createECDH('prime256v1');
  const salt = options.fixedForTest ? Buffer.from(options.fixedForTest.salt) : randomBytes(16);
  if (options.fixedForTest) sender.setPrivateKey(options.fixedForTest.senderPrivateKey);
  else sender.generateKeys();
  const senderKey = sender.getPublicKey();

  let sharedSecret: Buffer;
  try {
    sharedSecret = sender.computeSecret(browserKey);
  } catch {
    throw new TypeError("The subscription's p256dh key is not a valid P-256 public key.");
  }
  const { key, nonce } = deriveContentKeys({
    sharedSecret,
    authSecret,
    salt,
    browserKey,
    senderKey,
  });

  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const record = Buffer.concat([plaintext, Buffer.of(LAST_RECORD), Buffer.alloc(padding)]);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(HEADER_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderKey.length, 20);
  senderKey.copy(header, 21);
  return Buffer.concat([header, encrypted]);
}

export interface KeyInputs {
  /** ECDH between one side's private key and the other side's public key. */
  sharedSecret: Uint8Array;
  authSecret: Uint8Array;
  salt: Uint8Array;
  browserKey: Uint8Array;
  senderKey: Uint8Array;
}

/** RFC 8291 section 3.4: the content encryption key and nonce (shared with the test decrypter). */
export function deriveContentKeys(input: KeyInputs): { key: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    input.browserKey,
    input.senderKey,
  ]);
  const ikm = hkdf(input.sharedSecret, input.authSecret, keyInfo, 32);
  return {
    key: hkdf(ikm, input.salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce: hkdf(ikm, input.salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  };
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

function decode(text: string, length: number, name: string): Buffer {
  let bytes: Uint8Array | undefined;
  try {
    bytes = fromBase64Url(text);
  } catch {
    // Reported below.
  }
  if (!bytes || bytes.length !== length) {
    throw new TypeError(`The subscription's ${name} key must be ${length} bytes in base64url.`);
  }
  return Buffer.from(bytes);
}
