import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  notificationContent,
  notificationContentSchema,
  notificationSettingsSchema,
  notifyDecision,
} from './notify';
import type { NotifyAbout, NotifyInput } from './notify';

/** Avery writes in a group; is Sam notified? */
const input = (changes: Partial<NotifyInput> = {}): NotifyInput => ({
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  membership: { muted: false },
  chatType: 'group',
  kind: 'message',
  own: false,
  mentionsUser: false,
  readingChat: false,
  tabOpen: false,
  hasPushDevice: true,
  ...changes,
});
const mention = { mentionsUser: true };
const notice = { chatType: 'careHub' as const, kind: 'notice' as const };
const about = (notifyAbout: NotifyAbout) => ({
  settings: { ...DEFAULT_NOTIFICATION_SETTINGS, notifyAbout },
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
      [{ own: true }, 'own-message'],
      [{ kind: 'system' }, 'system-line'],
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
    expect(notifyDecision(input({ ...muted, ...mention }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...muted, ...notice }))).toEqual({
      notify: false,
      reason: 'muted',
    });
  });

  it('follows Settings → Notifications (push preferences)', () => {
    const some = about('mentions');
    expect(notifyDecision(input(some))).toEqual({
      notify: false,
      reason: 'not-direct-or-mention',
    });
    expect(notifyDecision(input({ ...some, chatType: 'direct' }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...some, ...mention }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...some, ...notice }))).toMatchObject({ notify: true });
    expect(notifyDecision(input({ ...about('nothing'), ...mention }))).toEqual({
      notify: false,
      reason: 'turned-off',
    });
    expect(notifyDecision(input(about('all')))).toMatchObject({ notify: true });
  });

  it('stays quiet while notifications are paused, even for mentions and direct chats', () => {
    const paused = { settings: { ...DEFAULT_NOTIFICATION_SETTINGS, paused: true } };
    for (const changes of [{}, mention, { chatType: 'direct' as const }, notice]) {
      expect(notifyDecision(input({ ...paused, ...changes }))).toEqual({
        notify: false,
        reason: 'paused',
      });
    }
  });
});

describe('notification settings', () => {
  it('defaults to all messages with text shown', () => {
    expect(notificationSettingsSchema.parse({})).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(notificationSettingsSchema.parse({ notifyAbout: 'nothing', showText: false })).toEqual({
      notifyAbout: 'nothing',
      showText: false,
      paused: false,
    });
    expect(notificationSettingsSchema.safeParse({ notifyAbout: 'some' }).success).toBe(false);
  });
});

describe('notificationContent', () => {
  const base = {
    chatId: 'chat-1',
    messageId: 'message-9',
    kind: 'message' as const,
    senderName: 'Avery Lin',
    text: 'Can you check the QA form?',
    showText: true,
  };

  it('shows the sender and the first 100 characters, one per chat', () => {
    const content = notificationContent({ ...base, text: 'x'.repeat(150) });
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

  it('shows "New message", never file names, when a message has no text', () => {
    expect(notificationContent({ ...base, text: '' }).body).toBe('New message');
    expect(notificationContent({ ...base, text: ' \n ' }).body).toBe('New message');
  });

  it('says who mentioned the person, with or without the text', () => {
    const mentioned = { ...base, mentionsUser: true };
    expect(notificationContent(mentioned)).toMatchObject({
      title: 'Avery Lin mentioned you',
      body: 'Can you check the QA form?',
    });
    expect(notificationContent({ ...mentioned, showText: false }).body).toBe('New message');
  });
});
