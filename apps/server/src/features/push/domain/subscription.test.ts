import { describe, expect, it } from 'vitest';
import { toBase64Url } from '../protocol/base64url';
import { createTestSubscription } from '../protocol/testing';
import { deviceName, subscriptionBody, subscriptionParams, unsubscribeBody } from './subscription';

const endpoint = 'https://fcm.googleapis.com/fcm/send/fictional-endpoint-1';

function body(changes: Record<string, unknown> = {}) {
  return { endpoint, expirationTime: null, keys: createTestSubscription().keys, ...changes };
}

function firstMessage(value: unknown): string | undefined {
  const result = subscriptionBody.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('subscriptionBody', () => {
  it('accepts what PushSubscription.toJSON() gives, with an optional replaced endpoint', () => {
    const value = body({ replaces: 'https://fcm.googleapis.com/fcm/send/fictional-endpoint-0' });
    expect(subscriptionBody.parse(value)).toEqual(value);
    expect(subscriptionBody.parse(body({ expirationTime: 1793000000000 })).expirationTime).toBe(
      1793000000000,
    );
  });

  it("refuses endpoints that aren't https on a browser's push service", () => {
    const message = "Care Hub only sends notifications through the browsers' own push services.";
    for (const other of [
      'http://fcm.googleapis.com/fcm/send/fictional',
      'https://push.example.com/fictional',
      'https://fcm.googleapis.com:8443/fcm/send/fictional',
      'https://169.254.169.254/latest/meta-data',
      'not a url',
    ]) {
      expect(firstMessage(body({ endpoint: other })), other).toBe(message);
    }
    expect(firstMessage(body({ endpoint: `${endpoint}/${'a'.repeat(1024)}` }))).toBeDefined();
  });

  it('refuses keys of the wrong size, or a public key off the P-256 curve', () => {
    const message =
      "This browser's notification keys aren't usable. Turn notifications off and on.";
    const { keys } = createTestSubscription();
    const offCurve = new Uint8Array(65).fill(7);
    offCurve[0] = 4;
    for (const bad of [
      { ...keys, p256dh: keys.auth },
      { ...keys, p256dh: toBase64Url(offCurve) },
      { ...keys, auth: keys.p256dh },
      { ...keys, auth: '***' },
    ]) {
      expect(firstMessage(body({ keys: bad }))).toBe(message);
    }
    expect(firstMessage(body({ keys: { auth: keys.auth } }))).toBeDefined();
  });

  it('refuses expiry times that are not in the future of 1970 or too far ahead', () => {
    expect(firstMessage(body({ expirationTime: -1 }))).toBeDefined();
    expect(firstMessage(body({ expirationTime: 1e20 }))).toBeDefined();
    expect(firstMessage(body({ expirationTime: '2026-11-01' }))).toBeDefined();
  });
});

describe('unsubscribeBody and subscriptionParams', () => {
  it('need an endpoint, and a subscription id that is a UUID', () => {
    expect(unsubscribeBody.safeParse({ endpoint }).success).toBe(true);
    expect(unsubscribeBody.safeParse({ endpoint: '' }).success).toBe(false);
    const id = '7d0f6a1e-2b7c-4c35-9d47-5a0f1c2b3d4e';
    expect(subscriptionParams.safeParse({ subscriptionId: id }).success).toBe(true);
    expect(subscriptionParams.safeParse({ subscriptionId: 'sub-1' }).success).toBe(false);
  });
});

describe('deviceName', () => {
  it('names the browser and the system', () => {
    const agents: [string | undefined, string][] = [
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Chrome on Windows',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Edge on Windows',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
        'Firefox on Mac',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        'Safari on iPhone',
      ],
      [
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        'Chrome on Android',
      ],
      ['', 'Browser'],
      [undefined, 'Browser'],
    ];
    for (const [userAgent, name] of agents) expect(deviceName(userAgent), userAgent).toBe(name);
  });
});
