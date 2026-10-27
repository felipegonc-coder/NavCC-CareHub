import { describe, expect, it } from 'vitest';
import { buildPushPayload, isCareHubPath, type PushNotice } from './payload';
import { MAX_PLAINTEXT_BYTES } from './protocol/encrypt';

const message: PushNotice = {
  kind: 'message',
  title: 'Avery Lin',
  body: 'Can you check the QA form?',
  url: '/messages/3f6c1a52-8d0e-4b7a-9a51-2c4f0e9d1b11',
  tag: 'chat:3f6c1a52-8d0e-4b7a-9a51-2c4f0e9d1b11',
};

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

describe('buildPushPayload', () => {
  it('shows the sender and the preview when message text is on', () => {
    expect(decode(buildPushPayload(message, { showText: true }))).toEqual({
      title: 'Avery Lin',
      body: 'Can you check the QA form?',
      url: message.url,
      tag: message.tag,
    });
  });

  it('hides the text behind generic words when message text is off', () => {
    expect(decode(buildPushPayload(message, { showText: false }))).toEqual({
      title: 'Avery Lin',
      body: 'New message',
      url: message.url,
      tag: message.tag,
    });
    const reminder: PushNotice = {
      kind: 'reminder',
      title: 'Reminder',
      body: 'Call Bluebird Bakery',
      url: '/messages/care-hub',
      tag: 'reminder:7',
    };
    expect(decode(buildPushPayload(reminder, { showText: false }))).toMatchObject({
      body: 'Reminder',
    });
    expect(
      decode(buildPushPayload({ ...reminder, kind: 'notice' }, { showText: false })),
    ).toMatchObject({ body: 'New notification' });
  });

  it('falls back to generic words when there is nothing to preview', () => {
    const payload = decode(
      buildPushPayload({ ...message, title: ' ', body: '' }, { showText: true }),
    );
    expect(payload).toMatchObject({ title: 'Care Hub', body: 'New message' });
  });

  it('keeps the first 100 characters on one line', () => {
    const long = `Line one\n\nline two ${'x'.repeat(200)}`;
    const { body } = decode(buildPushPayload({ ...message, body: long }, { showText: true })) as {
      body: string;
    };
    expect(body.startsWith('Line one line two xx')).toBe(true);
    expect([...body]).toHaveLength(101);
    expect(body.endsWith('…')).toBe(true);
    const exact = 'y'.repeat(100);
    expect(decode(buildPushPayload({ ...message, body: exact }, { showText: true }))).toMatchObject(
      { body: exact },
    );
  });

  it('never cuts an emoji in half', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const { body } = decode(
      buildPushPayload({ ...message, body: family.repeat(60) }, { showText: true }),
    ) as { body: string };
    expect(body.endsWith('…')).toBe(true);
    const kept = body.slice(0, -1);
    expect(kept.length % family.length).toBe(0);
    expect(kept.split(family).join('')).toBe('');
  });

  it('drops control and text-direction characters that could disguise a sender', () => {
    const payload = decode(
      buildPushPayload(
        { ...message, title: 'Sam\u202E Ortiz\u0007', body: 'a\u2066b\u0000c' },
        { showText: true },
      ),
    );
    expect(payload).toMatchObject({ title: 'Sam Ortiz', body: 'ab c' });
  });

  it('stays within one push message whatever the input', () => {
    const worst = '"\\'.repeat(5_000);
    const bytes = buildPushPayload({ ...message, title: worst, body: worst }, { showText: true });
    expect(bytes.length).toBeLessThanOrEqual(MAX_PLAINTEXT_BYTES);
  });

  it('refuses URLs that leave Care Hub and malformed tags', () => {
    for (const url of [
      'https://example.com/x',
      '//example.com/x',
      '/a\\b',
      'messages/1',
      '/a b',
      `/${'a'.repeat(512)}`,
    ]) {
      expect(() => buildPushPayload({ ...message, url }, { showText: true })).toThrow(RangeError);
    }
    for (const tag of ['', 'has space', 't'.repeat(129)]) {
      expect(() => buildPushPayload({ ...message, tag }, { showText: true })).toThrow(RangeError);
    }
  });
});

describe('isCareHubPath', () => {
  it('accepts paths with query and hash', () => {
    expect(isCareHubPath('/')).toBe(true);
    expect(isCareHubPath('/messages/abc?m=12#latest')).toBe(true);
  });
});
