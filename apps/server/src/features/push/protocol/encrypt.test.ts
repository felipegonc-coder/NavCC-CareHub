import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64url';
import { encryptPushMessage, MAX_PLAINTEXT_BYTES } from './encrypt';
import { createTestSubscription, decryptPushMessage } from './testing';

// RFC 8291 Appendix A. The private keys are the RFC's published example values, not secrets.
const rfc = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  senderPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  browserPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  browserPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow (published RFC test value)
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('encryptPushMessage', () => {
  it('reproduces the RFC 8291 example message', () => {
    const body = encryptPushMessage(
      fromBase64Url(rfc.plaintext),
      { p256dh: rfc.browserPublic, auth: rfc.auth },
      {
        fixedForTest: {
          salt: fromBase64Url(rfc.salt),
          senderPrivateKey: fromBase64Url(rfc.senderPrivate),
        },
      },
    );
    expect(toBase64Url(body)).toBe(rfc.message);
  });

  it('decrypts the RFC 8291 example with the browser keys', () => {
    const plain = decryptPushMessage(
      fromBase64Url(rfc.message),
      fromBase64Url(rfc.browserPrivate),
      fromBase64Url(rfc.auth),
    );
    expect(text(plain)).toBe('When I grow up, I want to be a watermelon');
  });

  it('writes one record: salt, 4096 record size, the sender key as key id', () => {
    const subscription = createTestSubscription();
    const body = encryptPushMessage(new TextEncoder().encode('Hi Sam'), subscription.keys);
    const header = Buffer.from(body.subarray(0, 86));
    expect(header.readUInt32BE(16)).toBe(4096);
    expect(header[20]).toBe(65);
    expect(header[21]).toBe(4);
    expect(body.length).toBe(86 + 6 + 1 + 16);
  });

  it('round-trips with fresh keys, a fresh salt and padding', () => {
    const subscription = createTestSubscription();
    const message = new TextEncoder().encode(
      '{"title":"Avery Lin","body":"Can you check the QA form?"}',
    );
    const first = encryptPushMessage(message, subscription.keys, { padding: 40 });
    const second = encryptPushMessage(message, subscription.keys, { padding: 40 });
    expect(first.length).toBe(86 + message.length + 1 + 40 + 16);
    expect(toBase64Url(first)).not.toBe(toBase64Url(second));
    expect(text(subscription.decrypt(first))).toBe(text(message));
    expect(text(subscription.decrypt(second))).toBe(text(message));
  });

  it('fits the largest allowed message in 4096 bytes and refuses one more byte', () => {
    const subscription = createTestSubscription();
    const largest = new Uint8Array(MAX_PLAINTEXT_BYTES).fill(0x61);
    const body = encryptPushMessage(largest, subscription.keys);
    expect(body.length).toBe(4096);
    expect(subscription.decrypt(body).length).toBe(MAX_PLAINTEXT_BYTES);
    expect(() =>
      encryptPushMessage(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), subscription.keys),
    ).toThrow(RangeError);
    expect(() =>
      encryptPushMessage(largest.subarray(1), subscription.keys, { padding: 2 }),
    ).toThrow(RangeError);
    expect(() => encryptPushMessage(largest, subscription.keys, { padding: -1 })).toThrow(
      RangeError,
    );
  });

  it('refuses malformed subscription keys', () => {
    const { keys } = createTestSubscription();
    const message = new Uint8Array([1]);
    expect(() => encryptPushMessage(message, { ...keys, auth: 'short' })).toThrow(/auth/);
    expect(() => encryptPushMessage(message, { ...keys, p256dh: 'not base64url!' })).toThrow(
      /p256dh/,
    );
    const offCurve = toBase64Url(Buffer.concat([Buffer.of(4), Buffer.alloc(64, 1)]));
    expect(() => encryptPushMessage(message, { ...keys, p256dh: offCurve })).toThrow(/p256dh/);
  });

  it('fails to decrypt with the wrong auth secret', () => {
    const subscription = createTestSubscription();
    const other = createTestSubscription();
    const body = encryptPushMessage(new Uint8Array([1, 2, 3]), subscription.keys);
    expect(() => other.decrypt(body)).toThrow();
  });
});
