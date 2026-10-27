import { describe, expect, it } from 'vitest';
import { buildPushPayload, isCareHubPath, type PushNotice, type PushPayload } from './payload';
import { MAX_PLAINTEXT_BYTES } from './protocol/encrypt';

const chat = '3f6c1a52-8d0e-4b7a-9a51-2c4f0e9d1b11';
const message: PushNotice = {
  kind: 'message',
  from: 'Avery Lin',
  text: 'Can you check the QA form?',
  url: `/messages/${chat}`,
  tag: `chat:${chat}`,
};
const target = { url: '/messages/care-hub', tag: 'notice:7' };

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
const shown = (notice: PushNotice, showText: boolean) => {
  const { title, body } = decode(buildPushPayload(notice, { showText })) as PushPayload;
  return { title, body };
};

describe('buildPushPayload', () => {
  it('shows the sender and the text of a message when message text is on', () => {
    expect(decode(buildPushPayload(message, { showText: true }))).toEqual({
      title: 'Avery Lin',
      body: 'Can you check the QA form?',
      url: message.url,
      tag: message.tag,
    });
  });

  it('shows only who and what kind when message text is off (MS-07)', () => {
    expect(shown(message, false)).toEqual({ title: 'Avery Lin', body: 'New message' });
    const mention: PushNotice = {
      kind: 'mention',
      from: 'Avery Lin',
      title: 'Weekly stand-up notes',
      text: 'Can you take the 9:00 call?',
      ...target,
    };
    expect(shown(mention, false)).toEqual({ title: 'Avery Lin mentioned you', body: '' });
    const reminder: PushNotice = {
      kind: 'reminder',
      title: 'Coaching plan – Q4',
      text: 'Call Sam back',
      ...target,
    };
    expect(shown(reminder, false)).toEqual({ title: 'Reminder', body: '' });
    const notice: PushNotice = {
      kind: 'notice',
      from: 'Learning',
      what: 'Course assigned',
      title: 'Customer care basics',
      ...target,
    };
    expect(shown(notice, false)).toEqual({ title: 'Learning', body: 'Course assigned' });
  });

  it('adds the title and the text or note when message text is on', () => {
    const reminder: PushNotice = {
      kind: 'reminder',
      title: 'Coaching plan – Q4',
      text: 'Call Sam back',
      ...target,
    };
    expect(shown(reminder, true)).toEqual({
      title: 'Reminder',
      body: 'Coaching plan – Q4 · Call Sam back',
    });
    expect(
      shown({ kind: 'mention', from: 'Riley Chen', text: '@Sam can you help?', ...target }, true),
    ).toEqual({
      title: 'Riley Chen mentioned you',
      body: '@Sam can you help?',
    });
    expect(
      shown(
        {
          kind: 'notice',
          from: 'Weekly QA check',
          what: 'Rows changed',
          title: 'QA form',
          ...target,
        },
        true,
      ),
    ).toEqual({ title: 'Weekly QA check', body: 'Rows changed · QA form' });
  });

  it('says "New message" for a message with only files, or blank names', () => {
    expect(shown({ ...message, text: undefined }, true)).toEqual({
      title: 'Avery Lin',
      body: 'New message',
    });
    expect(shown({ ...message, from: ' ', text: ' \n ' }, true)).toEqual({
      title: 'Care Hub',
      body: 'New message',
    });
    expect(shown({ kind: 'notice', from: '', what: '', ...target }, true)).toEqual({
      title: 'Care Hub',
      body: 'New notification',
    });
  });

  it('keeps the first 100 characters on one line', () => {
    const long = `Line one\n\nline two ${'x'.repeat(200)}`;
    const { body } = shown({ ...message, text: long }, true);
    expect(body.startsWith('Line one line two xx')).toBe(true);
    expect([...body]).toHaveLength(101);
    expect(body.endsWith('…')).toBe(true);
    const exact = 'y'.repeat(100);
    expect(shown({ ...message, text: exact }, true).body).toBe(exact);
    const reminder = shown(
      { kind: 'reminder', title: 't'.repeat(90), text: 'n'.repeat(90), ...target },
      true,
    );
    expect([...reminder.body]).toHaveLength(101);
  });

  it('never cuts an emoji in half', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const { body } = shown({ ...message, text: family.repeat(60) }, true);
    expect(body.endsWith('…')).toBe(true);
    const kept = body.slice(0, -1);
    expect(kept.length % family.length).toBe(0);
    expect(kept.split(family).join('')).toBe('');
  });

  it('drops control and text-direction characters that could disguise a sender', () => {
    expect(
      shown({ ...message, from: 'Sam\u202E Ortiz\u0007', text: 'a\u2066b\u0000c' }, true),
    ).toEqual({ title: 'Sam Ortiz', body: 'ab c' });
  });

  it('stays within one push message whatever the input', () => {
    const worst = '"\\'.repeat(5_000);
    for (const notice of [
      { ...message, from: worst, text: worst },
      { kind: 'notice', from: worst, what: worst, title: worst, text: worst, ...target },
    ] satisfies PushNotice[]) {
      expect(buildPushPayload(notice, { showText: true }).length).toBeLessThanOrEqual(
        MAX_PLAINTEXT_BYTES,
      );
    }
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
