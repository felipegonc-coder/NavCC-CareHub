import { describe, expect, it } from 'vitest';
import type { NoticeCard } from '../types';
import {
  collectCardRefs,
  eventCardKey,
  isNoticeOwner,
  noticeLink,
  NOTICES_CHAT_PATH,
  toNoticeSummary,
  toNoticeView,
  viewButtons,
  viewCard,
  type CardLookup,
  type CardLookups,
  type EventCardInfo,
  type NoticeRecord,
  type PageCardInfo,
} from './view';

// Care Team Demo; Avery Lin and Sam Ortiz; the "Coaching plan – Q4" and "QA form" pages.
const workspaceId = '3f1c2d4e-0000-4000-8000-00000000c0de';
const otherWorkspaceId = '3f1c2d4e-0000-4000-8000-00000000c0df';
const avery = '3f1c2d4e-0000-4000-8000-0000000a7e51';
const sam = '3f1c2d4e-0000-4000-8000-00000000005a';
const coachingPlan = '3f1c2d4e-0000-4000-8000-0000000c0a01';
const qaForm = '3f1c2d4e-0000-4000-8000-0000000c0a02';

const coachingPlanCard: PageCardInfo = {
  title: 'Coaching plan – Q4',
  icon: { type: 'emoji', emoji: '📋' },
  spaceName: 'Care Team Demo',
};
const standUp: EventCardInfo = {
  title: 'Weekly stand-up',
  when: 'Mon, Nov 2 · 9:00–9:30 AM',
  href: '/calendar?event=evt_42&occurrence=2026-11-02',
};

function lookups(
  pages: [string, CardLookup<PageCardInfo>][] = [],
  events: [string, CardLookup<EventCardInfo>][] = [],
): CardLookups {
  return { pages: new Map(pages), events: new Map(events) };
}

function record(overrides: Partial<NoticeRecord> = {}): NoticeRecord {
  return {
    id: '3f1c2d4e-0000-4000-8000-00000000a001',
    workspaceId,
    userId: avery,
    position: 7,
    kind: 'comment',
    sender: 'Sam Ortiz',
    actorUserId: sam,
    icon: null,
    title: 'Commented on a page',
    text: 'Looks good to me.',
    card: { type: 'page', pageId: coachingPlan },
    buttons: [{ label: 'Open', href: `/p/${coachingPlan}` }],
    groupKey: `comments:${coachingPlan}`,
    count: 2,
    createdAt: new Date('2026-10-27T09:00:00.000Z'),
    latestAt: new Date('2026-10-27T09:03:00.000Z'),
    readAt: null,
    ...overrides,
  };
}

describe('viewCard', () => {
  const pageCard: NoticeCard = { type: 'page', pageId: coachingPlan };

  it('shows an open page with its title, icon, space and link', () => {
    expect(viewCard(pageCard, lookups([[coachingPlan, coachingPlanCard]]))).toEqual({
      type: 'page',
      state: 'open',
      pageId: coachingPlan,
      href: `/p/${coachingPlan}`,
      title: 'Coaching plan – Q4',
      icon: { type: 'emoji', emoji: '📋' },
      spaceName: 'Care Team Demo',
    });
  });

  it('shows a locked page with nothing but its type and state', () => {
    const card = viewCard(pageCard, lookups([[coachingPlan, 'locked']]));
    expect(card).toStrictEqual({ type: 'page', state: 'locked' });
    expect(JSON.stringify(card)).not.toContain(coachingPlan);
  });

  it('locks a page the lookups left out', () => {
    expect(viewCard(pageCard, lookups([[qaForm, coachingPlanCard]]))).toStrictEqual({
      type: 'page',
      state: 'locked',
    });
  });

  it('shows a deleted page without its ID', () => {
    expect(viewCard(pageCard, lookups([[coachingPlan, 'deleted']]))).toStrictEqual({
      type: 'page',
      state: 'deleted',
    });
  });

  it('shows an open event occurrence', () => {
    const card: NoticeCard = { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02' };
    expect(viewCard(card, lookups([], [['evt_42|2026-11-02', standUp]]))).toEqual({
      type: 'event',
      state: 'open',
      eventId: 'evt_42',
      occurrenceStart: '2026-11-02',
      ...standUp,
    });
  });

  it('locks or hides events the reader cannot see', () => {
    const card: NoticeCard = { type: 'event', eventId: 'evt_42' };
    // Another occurrence's lookup is not this card's.
    expect(viewCard(card, lookups([], [['evt_42|2026-11-02', standUp]]))).toStrictEqual({
      type: 'event',
      state: 'locked',
    });
    expect(viewCard(card, lookups([], [['evt_42|', 'deleted']]))).toStrictEqual({
      type: 'event',
      state: 'deleted',
    });
  });

  it('has no card when the notice has none', () => {
    expect(viewCard(null, lookups())).toBeNull();
  });
});

describe('collectCardRefs', () => {
  it('lists each page and event occurrence once', () => {
    const refs = collectCardRefs([
      { card: { type: 'page', pageId: coachingPlan } },
      { card: { type: 'page', pageId: coachingPlan } },
      { card: { type: 'page', pageId: qaForm } },
      { card: { type: 'event', eventId: 'evt_42' } },
      { card: { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02' } },
      { card: { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02' } },
      { card: null },
    ]);
    expect(refs).toEqual({
      pageIds: [coachingPlan, qaForm],
      events: [
        { eventId: 'evt_42', occurrenceStart: null },
        { eventId: 'evt_42', occurrenceStart: '2026-11-02' },
      ],
    });
  });

  it('keys events by ID and occurrence', () => {
    expect(eventCardKey({ eventId: 'evt_42' })).toBe('evt_42|');
    expect(eventCardKey({ eventId: 'evt_42', occurrenceStart: null })).toBe('evt_42|');
    expect(eventCardKey({ eventId: 'evt_42', occurrenceStart: '2026-11-02' })).toBe(
      'evt_42|2026-11-02',
    );
  });
});

describe('viewButtons', () => {
  it('keeps links and hides action names and values', () => {
    const buttons = viewButtons([
      { label: 'Open', href: `/p/${coachingPlan}` },
      {
        label: 'Snooze',
        action: 'reminders.snooze',
        choices: [
          { label: '15 min', value: '15m' },
          { label: '1 hour', value: '1h' },
          { label: 'Tomorrow 9 AM', value: 'tomorrow-9' },
        ],
      },
      { label: 'Done', action: 'reminders.done', value: 'reminder-1' },
    ]);
    expect(buttons).toStrictEqual([
      { type: 'link', label: 'Open', href: `/p/${coachingPlan}` },
      { type: 'action', label: 'Snooze', choices: ['15 min', '1 hour', 'Tomorrow 9 AM'] },
      { type: 'action', label: 'Done', choices: [] },
    ]);
    expect(JSON.stringify(buttons)).not.toMatch(/reminders\.|reminder-1|tomorrow-9/);
  });
});

describe('toNoticeView', () => {
  it('shows a notice as its owner sees it', () => {
    expect(toNoticeView(record(), lookups([[coachingPlan, coachingPlanCard]]))).toEqual({
      id: '3f1c2d4e-0000-4000-8000-00000000a001',
      position: 7,
      kind: 'comment',
      sender: 'Sam Ortiz',
      actorUserId: sam,
      icon: null,
      title: 'Commented on a page',
      text: 'Looks good to me.',
      card: {
        type: 'page',
        state: 'open',
        pageId: coachingPlan,
        href: `/p/${coachingPlan}`,
        ...coachingPlanCard,
      },
      buttons: [{ type: 'link', label: 'Open', href: `/p/${coachingPlan}` }],
      count: 2,
      createdAt: '2026-10-27T09:00:00.000Z',
      latestAt: '2026-10-27T09:03:00.000Z',
      read: false,
    });
  });

  it('never carries the title of a page the reader lost access to', () => {
    const view = toNoticeView(record(), lookups([[coachingPlan, 'locked']]));
    expect(view.card).toStrictEqual({ type: 'page', state: 'locked' });
    expect(JSON.stringify(view)).not.toContain('Coaching plan');
  });

  it('marks read notices', () => {
    const view = toNoticeView(record({ readAt: new Date('2026-10-27T10:00:00.000Z') }), lookups());
    expect(view.read).toBe(true);
    expect(view).not.toHaveProperty('readAt');
    expect(view).not.toHaveProperty('groupKey');
  });
});

describe('isNoticeOwner', () => {
  const notice = { workspaceId, userId: avery };

  it('lets only the person whose chat it is read a notice', () => {
    expect(isNoticeOwner(notice, { workspaceId, userId: avery })).toBe(true);
    // Sam is a workspace admin: admins don't read other people's notices either.
    expect(isNoticeOwner(notice, { workspaceId, userId: sam })).toBe(false);
  });

  it('keeps each workspace chat apart', () => {
    expect(isNoticeOwner(notice, { workspaceId: otherWorkspaceId, userId: avery })).toBe(false);
  });
});

describe('noticeLink', () => {
  const card: NoticeCard = { type: 'page', pageId: coachingPlan };
  const snooze = { label: 'Snooze', action: 'reminders.snooze', value: '1h' };

  it('goes where the first link button goes', () => {
    const buttons = [snooze, { label: 'Open', href: `/p/${qaForm}#comment-1` }];
    expect(noticeLink({ buttons, card })).toBe(`/p/${qaForm}#comment-1`);
  });

  it("goes to the page card's page without a link button", () => {
    expect(noticeLink({ buttons: [snooze], card })).toBe(`/p/${coachingPlan}`);
  });

  it('goes to the chat otherwise', () => {
    expect(noticeLink({ buttons: [], card: null })).toBe(NOTICES_CHAT_PATH);
    expect(noticeLink({ buttons: [], card: { type: 'event', eventId: 'evt_42' } })).toBe(
      '/messages/care-hub',
    );
  });
});

describe('toNoticeSummary', () => {
  it('has what a push notification shows, and nothing a card looks up', () => {
    expect(toNoticeSummary(record())).toStrictEqual({
      id: '3f1c2d4e-0000-4000-8000-00000000a001',
      workspaceId,
      userId: avery,
      kind: 'comment',
      title: 'Commented on a page',
      text: 'Looks good to me.',
      senderName: 'Sam Ortiz',
      link: `/p/${coachingPlan}`,
      createdAt: new Date('2026-10-27T09:00:00.000Z'),
      latestAt: new Date('2026-10-27T09:03:00.000Z'),
    });
  });
});
