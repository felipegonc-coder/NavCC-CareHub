// Test helpers: a stand-in browser subscription and a decrypter for RFC 8291 messages.
// Never imported by shipped code.
import { createDecipheriv, createECDH, randomBytes } from 'node:crypto';
import { fromBase64Url, toBase64Url } from './base64url';
import { deriveContentKeys, type PushSubscriptionKeys } from './encrypt';

export interface TestSubscription {
  keys: PushSubscriptionKeys;
  /** Decrypts a body sent to this subscription, as the browser would. */
  decrypt(body: Uint8Array): Uint8Array;
}

/** A browser-side key pair and auth secret, made at run time. */
export function createTestSubscription(fixed?: {
  privateKey: Uint8Array;
  authSecret: Uint8Array;
}): TestSubscription {
  const browser = createECDH('prime256v1');
  if (fixed) browser.setPrivateKey(fixed.privateKey);
  else browser.generateKeys();
  const authSecret = fixed ? Buffer.from(fixed.authSecret) : randomBytes(16);
  return {
    keys: { p256dh: toBase64Url(browser.getPublicKey()), auth: toBase64Url(authSecret) },
    decrypt: (body) => decryptPushMessage(body, browser.getPrivateKey(), authSecret),
  };
}

/** Decrypts a single-record aes128gcm body (RFC 8188 section 2, RFC 8291 section 3.4). */
export function decryptPushMessage(
  body: Uint8Array,
  browserPrivateKey: Uint8Array,
  authSecret: Uint8Array,
): Uint8Array {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const recordSize = data.readUInt32BE(16);
  const idLength = data.readUInt8(20);
  const senderKey = data.subarray(21, 21 + idLength);
  const record = data.subarray(21 + idLength);
  if (record.length > recordSize) throw new Error('More than one record.');

  const browser = createECDH('prime256v1');
  browser.setPrivateKey(browserPrivateKey);
  const { key, nonce } = deriveContentKeys({
    sharedSecret: browser.computeSecret(senderKey),
    authSecret,
    salt,
    browserKey: browser.getPublicKey(),
    senderKey,
  });
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(record.subarray(-16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1;
  if (plain[end] !== 2) throw new Error('Missing the last-record delimiter.');
  return plain.subarray(0, end);
}

export { fromBase64Url, toBase64Url };
