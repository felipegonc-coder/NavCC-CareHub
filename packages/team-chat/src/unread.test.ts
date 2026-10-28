import { describe, expect, it } from 'vitest';
import {
  advanceReadMarker,
  badgeCount,
  badgeText,
  countsAsUnread,
  firstUnreadSeq,
  isChatRead,
  markAsUnreadSeq,
  unreadCounts,
} from './unread';
import type { UnreadMessage } from './unread';

const message = (seq: number, senderId: string | null, extra: Partial<UnreadMessage> = {}) => ({
  seq,
  kind: 'message' as const,
  senderId,
  deleted: false,
  mentionedUserIds: [],
  ...extra,
});

/** Sam's view of a chat with Avery. */
const chat: UnreadMessage[] = [
  message(1, 'avery'),
  message(2, 'sam'),
  message(3, 'avery', { kind: 'system' }),
  message(4, 'avery', { mentionedUserIds: ['sam'] }),
  message(5, 'avery', { deleted: true }),
  message(6, 'avery'),
];

describe('unread counts', () => {
  it('counts messages from others, not your own, small lines or deleted messages', () => {
    expect(chat.filter((m) => countsAsUnread(m, 'sam')).map((m) => m.seq)).toEqual([1, 4, 6]);
    expect(unreadCounts(chat, 'sam', null)).toEqual({ unread: 3, mentions: 1 });
    expect(unreadCounts(chat, 'sam', 4)).toEqual({ unread: 1, mentions: 0 });
  });

  it('MS-01 raises the badge while the chat is closed and clears it when opened', () => {
    let lastRead: number | null = 2;
    const incoming = [...chat.slice(0, 2), message(7, 'avery')];
    expect(badgeCount([{ ...unreadCounts(incoming, 'sam', lastRead), muted: false }])).toBe(1);
    expect(isChatRead({ chatOpen: true, tabVisible: true, newestOnScreen: true })).toBe(true);
    lastRead = advanceReadMarker(lastRead, 7);
    expect(badgeCount([{ ...unreadCounts(incoming, 'sam', lastRead), muted: false }])).toBe(0);
  });

  it('counts notices in the 🔔 chat like messages', () => {
    const notices = [message(1, null, { kind: 'notice' }), message(2, null, { kind: 'notice' })];
    expect(unreadCounts(notices, 'sam', null)).toEqual({ unread: 2, mentions: 0 });
  });
});

describe('MS-06 badge', () => {
  it('counts unread in unmuted chats and only @mentions in muted ones', () => {
    const chats = [
      { unread: 4, mentions: 1, muted: false },
      { unread: 6, mentions: 2, muted: true },
      { unread: 3, mentions: 0, muted: true },
    ];
    expect(badgeCount(chats)).toBe(6);
    expect(badgeCount([])).toBe(0);
  });

  it('shows "99+" above 99 and nothing at 0', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('read markers', () => {
  it('MS-11 puts the "New messages" line above the first unread message', () => {
    expect(firstUnreadSeq(chat, 'sam', 2)).toBe(4);
    expect(firstUnreadSeq(chat, 'sam', 6)).toBeNull();
    expect(firstUnreadSeq(chat, 'avery', null)).toBe(2);
  });

  it('needs the chat open, the tab in front and the newest messages on screen', () => {
    expect(isChatRead({ chatOpen: true, tabVisible: false, newestOnScreen: true })).toBe(false);
    expect(isChatRead({ chatOpen: true, tabVisible: true, newestOnScreen: false })).toBe(false);
    expect(isChatRead({ chatOpen: false, tabVisible: true, newestOnScreen: true })).toBe(false);
  });

  it('only moves forward', () => {
    expect(advanceReadMarker(null, 3)).toBe(3);
    expect(advanceReadMarker(6, 3)).toBe(6);
  });

  it('marks the newest message from someone else as unread', () => {
    const marker = markAsUnreadSeq([...chat, message(8, 'sam')], 'sam');
    expect(marker).toBe(5);
    expect(unreadCounts(chat, 'sam', marker)).toEqual({ unread: 1, mentions: 0 });
    expect(markAsUnreadSeq([message(1, 'sam')], 'sam')).toBeNull();
  });
});
