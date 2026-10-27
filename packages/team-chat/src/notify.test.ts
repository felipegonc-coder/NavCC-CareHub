import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  notificationContent,
  notificationContentSchema,
  notificationSettingsSchema,
  notifyDecision,
} from './notify';
import type { NotifyInput } from './notify';

/** Avery writes in a group; is Sam notified? */
const input = (changes: Partial<NotifyInput> = {}): NotifyInput => ({
  recipientId: 'sam',
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  membership: { muted: false },
  chatType: 'group',
  message: { kind: 'message', senderId: 'avery', mentionedUserIds: [] },
  readingChat: false,
  tabOpen: false,
  hasPushDevice: true,
  ...changes,
});
const mention = { kind: 'message' as const, senderId: 'avery', mentionedUserIds: ['sam'] };
const notice = { kind: 'notice' as const, senderId: null, mentionedUserIds: [] };
const level = (value: 'all' | 'directAndMentions' | 'nothing') => ({
  settings: { level: value, showText: true },
});

describe('notifyDecision', () => {
  it('MS-07 lets an open tab in the background show it, and uses push when Care Hub is closed', () => {
    expect(notifyDecision(input({ tabOpen: true }))).toEqual({ notify: true, via: 'tab' });
    expect(notifyDecision(input())).toEqual({ notify: true, via: 'push' });
    expect(notifyDecision(input({ hasPushDevice: false }))).toEqual({
      notify: false,
      reason: 'no-device',
    });
  });

  it('stays quiet for the sender, small lines, people outside the chat and readers', () => {
    const quiet: [Partial<NotifyInput>, string][] = [
      [{ recipientId: 'avery' }, 'own-message'],
      [{ message: { kind: 'system', senderId: 'avery', mentionedUserIds: [] } }, 'system-line'],
      [{ membership: null }, 'not-in-chat'],
      [{ readingChat: true, tabOpen: true }, 'reading'],
    ];
    for (const [changes, reason] of quiet) {
      expect(notifyDecision(input(changes))).toEqual({ notify: false, reason });
    }
  });

  it('MS-06 mutes everything except @mentions', () => {
    const muted = { membership: { muted: true } };
    expect(notifyDecision(input(muted))).toEqual({ notify: false, reason: 'muted' });
    expect(notifyDecision(input({ ...muted, message: mention }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...muted, chatType: 'careHub', message: notice }))).toEqual({
      notify: false,
      reason: 'muted',
    });
  });

  it('follows Settings → Notifications', () => {
    const some = level('directAndMentions');
    expect(notifyDecision(input(some))).toEqual({
      notify: false,
      reason: 'not-direct-or-mention',
    });
    expect(notifyDecision(input({ ...some, chatType: 'direct' }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...some, message: mention }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...some, chatType: 'careHub', message: notice }))).toMatchObject({
      notify: true,
    });
    expect(notifyDecision(input({ ...level('nothing'), message: mention }))).toEqual({
      notify: false,
      reason: 'turned-off',
    });
  });
});

describe('notification settings', () => {
  it('defaults to all messages with text shown', () => {
    expect(notificationSettingsSchema.parse({})).toEqual({ level: 'all', showText: true });
    expect(notificationSettingsSchema.parse({ level: 'nothing', showText: false })).toEqual({
      level: 'nothing',
      showText: false,
    });
    expect(notificationSettingsSchema.safeParse({ level: 'some' }).success).toBe(false);
  });
});

describe('notificationContent', () => {
  const base = {
    chatId: 'chat-1',
    messageId: 'message-9',
    kind: 'message' as const,
    senderName: 'Avery Lin',
    preview: 'Can you check the QA form?',
    showText: true,
  };

  it('shows the sender and the first 100 characters, one per chat', () => {
    const content = notificationContent({ ...base, preview: 'x'.repeat(150) });
    expect(content.title).toBe('Avery Lin');
    expect(content.body).toBe(`${'x'.repeat(100)}…`);
    expect(content.tag).toBe('chat:chat-1');
    expect(notificationContent(base).tag).toBe(content.tag);
    expect(notificationContentSchema.parse(content)).toEqual(content);
  });

  it('MS-07 hides the text when "Show message text" is off', () => {
    expect(notificationContent({ ...base, showText: false }).body).toBe('New message');
    expect(
      notificationContent({ ...base, kind: 'notice', senderName: 'Care Hub', showText: false })
        .body,
    ).toBe('New notice');
  });
});
