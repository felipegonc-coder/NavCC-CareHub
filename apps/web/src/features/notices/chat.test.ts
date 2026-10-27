import { describe, expect, it } from 'vitest';
import type { NoticePage, NoticeView } from './api';
import {
  arrivalMessage,
  arrivals,
  chatDays,
  chatNotices,
  closedCardText,
  emptyText,
  firstUnreadId,
  noticeIcon,
  noticeTime,
  withRead,
} from './chat';

const notice = (overrides: Partial<NoticeView> = {}): NoticeView => ({
  id: 'n1',
  position: 1,
  kind: 'reminder',
  sender: 'Reminders',
  actorUserId: null,
  icon: null,
  title: 'Reminder',
  text: null,
  card: null,
  buttons: [],
  count: 1,
  createdAt: '2026-10-27T15:00:00.000Z',
  latestAt: '2026-10-27T15:00:00.000Z',
  read: false,
  ...overrides,
});

const page = (notices: NoticeView[], nextCursor: number | null = null): NoticePage => ({
  notices,
  nextCursor,
  unread: notices.filter((n) => !n.read).length,
});

const denver = { timeZone: 'America/Denver', use24h: false };

describe('chatNotices', () => {
  it('lists every notice once, oldest first, from pages that come newest first', () => {
    const pages = [
      page([notice({ id: 'c', position: 9 }), notice({ id: 'b', position: 7 })], 7),
      page([notice({ id: 'b', position: 7 }), notice({ id: 'a', position: 2 })]),
    ];
    expect(chatNotices(pages).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('is empty before anything loads', () => {
    expect(chatNotices([])).toEqual([]);
  });
});

describe('chatDays', () => {
  // 9:00 AM in Denver on Tue, Oct 27 2026.
  const now = new Date('2026-10-27T15:00:00.000Z');

  it("puts notices under the day they last arrived, in the person's time zone", () => {
    const days = chatDays(
      [
        notice({ id: 'old', latestAt: '2025-12-26T18:00:00.000Z' }),
        notice({ id: 'sun', latestAt: '2026-10-26T05:30:00.000Z' }), // Sun 11:30 PM in Denver
        notice({ id: 'yesterday', latestAt: '2026-10-26T20:00:00.000Z' }),
        notice({ id: 'early', latestAt: '2026-10-27T06:30:00.000Z' }), // 12:30 AM in Denver
        notice({ id: 'now', latestAt: '2026-10-27T15:00:00.000Z' }),
      ],
      denver,
      now,
    );
    expect(days.map((d) => [d.label, d.notices.map((n) => n.id)])).toEqual([
      ['Fri, Dec 26, 2025', ['old']],
      ['Sun, Oct 25', ['sun']],
      ['Yesterday', ['yesterday']],
      ['Today', ['early', 'now']],
    ]);
    expect(days.map((d) => d.key)).toEqual([
      '2025-12-26',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
  });

  it('gives a day that shows up twice its own key', () => {
    const days = chatDays(
      [
        notice({ id: 'a', latestAt: '2026-10-27T15:00:00.000Z' }),
        notice({ id: 'b', latestAt: '2026-10-26T15:00:00.000Z' }),
        notice({ id: 'c', latestAt: '2026-10-27T15:05:00.000Z' }),
      ],
      denver,
      now,
    );
    expect(days.map((d) => d.key)).toEqual(['2026-10-27', '2026-10-26', '2026-10-27#2']);
  });
});

describe('noticeTime', () => {
  it("shows when it last arrived, with the person's clock setting", () => {
    const n = notice({ latestAt: '2026-10-27T21:30:00.000Z' });
    expect(noticeTime(n, denver)).toBe('3:30 PM');
    expect(noticeTime(n, { timeZone: 'America/Denver', use24h: true })).toBe('15:30');
    expect(noticeTime(n, { timeZone: 'Europe/Lisbon', use24h: true })).toBe('21:30');
  });
});

describe('firstUnreadId', () => {
  it('finds the oldest unread notice, for the "New messages" line', () => {
    const notices = [
      notice({ id: 'a', read: true }),
      notice({ id: 'b', read: false }),
      notice({ id: 'c', read: true }),
      notice({ id: 'd', read: false }),
    ];
    expect(firstUnreadId(notices)).toBe('b');
    expect(firstUnreadId([notice({ read: true })])).toBeNull();
  });
});

describe('arrivals', () => {
  it('finds notices after the newest one shown, grouped ones that moved included', () => {
    const notices = [
      notice({ id: 'a', position: 3 }),
      notice({ id: 'b', position: 5 }),
      notice({ id: 'grouped', position: 6, count: 2 }),
    ];
    expect(arrivals(notices, 5).map((n) => n.id)).toEqual(['grouped']);
    expect(arrivals(notices, 6)).toEqual([]);
  });

  it('words what screen readers hear', () => {
    expect(arrivalMessage([])).toBe('');
    expect(arrivalMessage([notice({ sender: 'Sam Ortiz', title: 'Mentioned you' })])).toBe(
      'New notice from Sam Ortiz: Mentioned you',
    );
    expect(arrivalMessage([notice({ id: 'a' }), notice({ id: 'b' })])).toBe('2 new notices');
  });
});

describe('closedCardText', () => {
  it('says what happened, never which page or event', () => {
    expect(closedCardText({ type: 'page', state: 'locked' })).toBe("🔒 A page you can't open");
    expect(closedCardText({ type: 'event', state: 'locked' })).toBe("🔒 An event you can't open");
    expect(closedCardText({ type: 'page', state: 'deleted' })).toBe('This page was deleted');
    expect(closedCardText({ type: 'event', state: 'deleted' })).toBe('This event was deleted');
  });
});

describe('withRead', () => {
  it('marks the matching notices read', () => {
    const before = page([notice({ id: 'a', position: 1 }), notice({ id: 'b', position: 2 })]);
    const after = withRead(before, (n) => n.position <= 1);
    expect(after.notices.map((n) => n.read)).toEqual([true, false]);
    expect(before.notices[0]?.read).toBe(false);
  });

  it('gives back the same page when nothing changes', () => {
    const before = page([notice({ read: true })]);
    expect(withRead(before, () => true)).toBe(before);
  });
});

describe('noticeIcon', () => {
  it("uses the notice's own icon, else its kind's", () => {
    expect(noticeIcon({ icon: '👋', kind: 'alert' })).toBe('👋');
    expect(noticeIcon({ icon: null, kind: 'reminder' })).toBe('⏰');
    expect(noticeIcon({ icon: null, kind: 'access_request' })).toBe('🔑');
  });

  it("falls back to the bell for a kind this app doesn't know yet", () => {
    expect(noticeIcon({ icon: null, kind: 'newer_kind' as NoticeView['kind'] })).toBe('🔔');
  });
});

describe('emptyText', () => {
  it('says the chat is empty, or that this chip is', () => {
    expect(emptyText('all')).toBe('No notices yet.');
    expect(emptyText('mentions')).toBe('No notices here.');
  });
});
