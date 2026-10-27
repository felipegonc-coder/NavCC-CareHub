import { describe, expect, it } from 'vitest';
import { buildPushPayload } from './payload';
import { fromBase64Url, toBase64Url } from './protocol/base64url';
import { createTestSubscription } from './protocol/testing';
import { generateVapidKeys, importVapidKeys } from './protocol/vapid';
import {
  classifyPushResponse,
  isAllowedPushEndpoint,
  sendPush,
  topicFor,
  type PushSender,
  type PushTarget,
} from './sender';

const now = new Date('2026-10-26T15:00:00Z');
const endpoint = 'https://fcm.googleapis.com/fcm/send/fictional-endpoint-1';

interface Call {
  url: string;
  init: RequestInit;
}

function setup(
  reply: () => Response | Promise<Response> = () => new Response(null, { status: 201 }),
) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return reply();
  }) as typeof globalThis.fetch;
  const vapidStrings = generateVapidKeys();
  const sender: PushSender = {
    fetch,
    vapid: { keys: importVapidKeys(vapidStrings), subject: 'mailto:care-team@example.org' },
  };
  const subscription = createTestSubscription();
  const target: PushTarget = { endpoint, keys: subscription.keys };
  return { calls, sender, subscription, target, vapidStrings };
}

const payload = buildPushPayload(
  {
    kind: 'message',
    from: 'Riley Chen',
    text: 'Stand-up moved to 10:30.',
    url: '/messages/c1',
    tag: 'chat:c1',
  },
  { showText: true },
);

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init.headers as Record<string, string> | undefined)?.[name];
}

describe('sendPush', () => {
  it('posts an encrypted, signed message with TTL, Urgency and Topic', async () => {
    const { calls, sender, subscription, target, vapidStrings } = setup();
    const outcome = await sendPush(sender, target, payload, {
      ttlSeconds: 3600,
      urgency: 'high',
      topic: topicFor('chat:c1'),
      now,
    });
    expect(outcome).toEqual({ result: 'delivered', status: 201 });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(endpoint);
    expect(call?.init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(header(call, 'TTL')).toBe('3600');
    expect(header(call, 'Urgency')).toBe('high');
    expect(header(call, 'Topic')).toBe(topicFor('chat:c1'));
    expect(header(call, 'Content-Encoding')).toBe('aes128gcm');
    expect(header(call, 'Content-Type')).toBe('application/octet-stream');

    const authorization = header(call, 'Authorization') ?? '';
    expect(authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapidStrings.publicKey}$`),
    );
    const claims = JSON.parse(
      Buffer.from(fromBase64Url(authorization.split('.')[1] ?? '')).toString('utf8'),
    ) as unknown;
    expect(claims).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: 'mailto:care-team@example.org',
    });

    const body = call?.init.body as Uint8Array;
    expect(new TextDecoder().decode(subscription.decrypt(body))).toBe(
      new TextDecoder().decode(payload),
    );
  });

  it('defaults to one day and normal urgency, and pads to hide the length', async () => {
    const { calls, sender, target } = setup();
    await sendPush(sender, target, payload, { now });
    expect(header(calls[0], 'TTL')).toBe('86400');
    expect(header(calls[0], 'Urgency')).toBe('normal');
    expect(header(calls[0], 'Topic')).toBeUndefined();
    const body = calls[0]?.init.body as Uint8Array;
    expect(body.length).toBe(86 + 256 + 1 + 16);
  });

  it('retries after a network error or timeout', async () => {
    const { sender, target } = setup(() => Promise.reject(new TypeError('fetch failed')));
    expect(await sendPush(sender, target, payload, { now })).toEqual({
      result: 'retry',
      status: null,
      retryAfterSeconds: null,
    });
  });

  it('reports the push service’s words when it rejects the message', async () => {
    const { sender, target } = setup(() => new Response('  Invalid JWT  ', { status: 401 }));
    expect(await sendPush(sender, target, payload, { now })).toEqual({
      result: 'rejected',
      status: 401,
      reason: 'unauthorized',
      detail: 'Invalid JWT',
    });
  });

  it('refuses endpoints outside the known push services without calling them', async () => {
    const { calls, sender, subscription } = setup();
    for (const bad of [
      'http://fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://db.internal/x',
    ]) {
      const outcome = await sendPush(sender, { endpoint: bad, keys: subscription.keys }, payload);
      expect(outcome).toEqual({ result: 'rejected', status: null, reason: 'not_allowed' });
    }
    expect(calls).toHaveLength(0);
  });

  it('treats a subscription with malformed keys as gone', async () => {
    const { calls, sender, target } = setup();
    const outcome = await sendPush(
      sender,
      { ...target, keys: { ...target.keys, auth: 'x' } },
      payload,
    );
    expect(outcome).toEqual({ result: 'gone', status: null });
    expect(calls).toHaveLength(0);
  });

  it('refuses a payload too big for one push message', async () => {
    const { sender, target } = setup();
    const outcome = await sendPush(sender, target, new Uint8Array(4000));
    expect(outcome).toMatchObject({ result: 'rejected', reason: 'too_large' });
  });

  it('checks TTL and topic', async () => {
    const { sender, target } = setup();
    await expect(sendPush(sender, target, payload, { ttlSeconds: -1 })).rejects.toThrow(RangeError);
    await expect(sendPush(sender, target, payload, { topic: 'chat:c1' })).rejects.toThrow(
      RangeError,
    );
    await expect(sendPush(sender, target, payload, { topic: 'x'.repeat(33) })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('classifyPushResponse', () => {
  it('maps each status to what the caller should do', () => {
    const cases: [number, string][] = [
      [201, 'delivered'],
      [202, 'delivered'],
      [404, 'gone'],
      [410, 'gone'],
      [429, 'retry'],
      [500, 'retry'],
      [503, 'retry'],
      [400, 'rejected'],
      [403, 'rejected'],
      [413, 'rejected'],
      [301, 'rejected'],
    ];
    for (const [status, result] of cases) {
      expect(classifyPushResponse(status, null, now).result).toBe(result);
    }
  });

  it('names why a message was rejected', () => {
    expect(classifyPushResponse(400, null, now)).toMatchObject({ reason: 'bad_request' });
    expect(classifyPushResponse(413, null, now)).toMatchObject({ reason: 'too_large' });
    expect(classifyPushResponse(403, null, now)).toMatchObject({ reason: 'unauthorized' });
    expect(classifyPushResponse(302, null, now)).toMatchObject({ reason: 'refused' });
  });

  it('reads Retry-After as seconds or as a date', () => {
    expect(classifyPushResponse(429, '120', now)).toEqual({
      result: 'retry',
      status: 429,
      retryAfterSeconds: 120,
    });
    expect(classifyPushResponse(503, 'Mon, 26 Oct 2026 15:01:30 GMT', now)).toMatchObject({
      retryAfterSeconds: 90,
    });
    expect(classifyPushResponse(503, 'Mon, 26 Oct 2026 14:00:00 GMT', now)).toMatchObject({
      retryAfterSeconds: 0,
    });
    expect(classifyPushResponse(429, 'soon', now)).toMatchObject({ retryAfterSeconds: null });
  });
});

describe('isAllowedPushEndpoint', () => {
  it('allows the browsers’ push services over HTTPS only', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-by3p.notify.windows.com/w/?token=abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://push.apple.com.example.net/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evilpush.apple.com.example.net/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://notfcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });
});

describe('topicFor', () => {
  it('makes a stable 32-character base64url topic that hides the tag', () => {
    const topic = topicFor('chat:3f6c1a52-8d0e-4b7a-9a51-2c4f0e9d1b11');
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(topicFor('chat:3f6c1a52-8d0e-4b7a-9a51-2c4f0e9d1b11')).toBe(topic);
    expect(topicFor('chat:other')).not.toBe(topic);
    expect(topic).not.toContain('chat');
  });
});

describe('test subscription helper', () => {
  it('uses run-time keys', () => {
    const a = createTestSubscription();
    const b = createTestSubscription();
    expect(a.keys.p256dh).not.toBe(b.keys.p256dh);
    expect(fromBase64Url(a.keys.auth)).toHaveLength(16);
    expect(toBase64Url(fromBase64Url(a.keys.p256dh))).toBe(a.keys.p256dh);
  });
});
