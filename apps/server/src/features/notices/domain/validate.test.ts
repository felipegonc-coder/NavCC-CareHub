import { describe, expect, it } from 'vitest';
import type { SendNoticeInput } from '../types';
import { isRelativeHref, NOTICE_LIMITS, NoticeInputError, parseSendNoticeInput } from './validate';

// Care Team Demo, Avery Lin, Sam Ortiz and the "Coaching plan – Q4" page.
const workspaceId = '3f1c2d4e-0000-4000-8000-00000000c0de';
const avery = '3f1c2d4e-0000-4000-8000-0000000a7e51';
const sam = '3f1c2d4e-0000-4000-8000-00000000005a';
const coachingPlan = '3f1c2d4e-0000-4000-8000-0000000c0a01';

const minimal: SendNoticeInput = {
  workspaceId,
  userId: avery,
  kind: 'reminder',
  sender: 'Learning',
  title: 'A reminder is due',
};

const open = { label: 'Open', href: '/home' };
const snooze = {
  label: 'Snooze',
  action: 'reminders.snooze',
  choices: [{ label: '1 hour', value: '1h' }],
};
const event = { type: 'event', eventId: 'evt_42' };

/** The problems parseSendNoticeInput reports for this input, or [] when it passes. */
function issuesFor(input: unknown): readonly string[] {
  try {
    parseSendNoticeInput(input);
    return [];
  } catch (error) {
    if (error instanceof NoticeInputError) return error.issues;
    throw error;
  }
}

describe('parseSendNoticeInput', () => {
  it('fills in nulls and no buttons for what a minimal notice leaves out', () => {
    expect(parseSendNoticeInput(minimal)).toEqual({
      ...minimal,
      actorUserId: null,
      icon: null,
      text: null,
      card: null,
      buttons: [],
      groupKey: null,
    });
  });

  it('keeps every optional field', () => {
    const input: SendNoticeInput = {
      ...minimal,
      kind: 'mention',
      sender: 'Sam Ortiz',
      actorUserId: sam,
      icon: '💬',
      title: 'Mentioned you in a comment',
      text: 'Can you check the follow-up dates?',
      card: { type: 'page', pageId: coachingPlan },
      buttons: [
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
        { label: 'Done', action: 'reminders.done', value: 'r-1' },
      ],
      groupKey: `comments:${coachingPlan}`,
    };
    expect(parseSendNoticeInput(input)).toEqual(input);
  });

  it('accepts event cards, with or without one occurrence', () => {
    for (const card of [
      { type: 'event', eventId: 'evt_42' },
      { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02' },
      { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02T09:30' },
      { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02T09:30:00.000Z' },
      { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02T09:30:00-05:00' },
    ] as const) {
      expect(parseSendNoticeInput({ ...minimal, card }).card).toEqual(card);
    }
  });

  it('treats blank optional text as absent', () => {
    const notice = parseSendNoticeInput({ ...minimal, icon: ' ', text: '', groupKey: '  ' });
    expect(notice.icon).toBeNull();
    expect(notice.text).toBeNull();
    expect(notice.groupKey).toBeNull();
  });

  it('allows text up to the limits', () => {
    const notice = parseSendNoticeInput({
      ...minimal,
      sender: 's'.repeat(NOTICE_LIMITS.sender),
      title: 't'.repeat(NOTICE_LIMITS.title),
      text: 'x'.repeat(NOTICE_LIMITS.text),
      groupKey: 'k'.repeat(NOTICE_LIMITS.groupKey),
    });
    expect(notice.text).toHaveLength(NOTICE_LIMITS.text);
  });

  const rejected: [name: string, change: Record<string, unknown>, path: string][] = [
    ['a missing workspace', { workspaceId: undefined }, 'workspaceId'],
    ['an ID that is not a UUID', { userId: 'avery' }, 'userId'],
    ['an unknown kind', { kind: 'digest' }, 'kind'],
    ['a blank sender', { sender: '   ' }, 'sender'],
    ['a blank title', { title: '' }, 'title'],
    ['a title over the limit', { title: 't'.repeat(NOTICE_LIMITS.title + 1) }, 'title'],
    ['text over the limit', { text: 'x'.repeat(NOTICE_LIMITS.text + 1) }, 'text'],
    ['a bad actor ID', { actorUserId: 'sam' }, 'actorUserId'],
    ['a fourth button', { buttons: Array.from({ length: 4 }, () => open) }, 'buttons'],
    [
      'a link to another site',
      { buttons: [{ ...open, href: 'https://example.com/' }] },
      'buttons.0.href',
    ],
    [
      'a protocol-relative link',
      { buttons: [{ ...open, href: '//example.com/' }] },
      'buttons.0.href',
    ],
    ['a script link', { buttons: [{ ...open, href: 'javascript:alert(1)' }] }, 'buttons.0.href'],
    ['a blank button label', { buttons: [{ ...open, label: ' ' }] }, 'buttons.0.label'],
    ['a long button label', { buttons: [{ ...open, label: 'l'.repeat(41) }] }, 'buttons.0.label'],
    [
      'an action without a feature',
      { buttons: [{ label: 'Done', action: 'done' }] },
      'buttons.0.action',
    ],
    ['a menu with no choices', { buttons: [{ ...snooze, choices: [] }] }, 'buttons.0.choices'],
    ['a button with a value and choices', { buttons: [{ ...snooze, value: '1h' }] }, 'buttons.0'],
    [
      'a link that runs an action',
      { buttons: [{ ...open, action: 'reminders.done' }] },
      'buttons.0',
    ],
    ['a button that does nothing', { buttons: [{ label: 'Open' }] }, 'buttons.0.action'],
    ['an unknown button field', { buttons: [{ ...open, target: '_blank' }] }, 'buttons.0'],
    ['a page card without a page ID', { card: { type: 'page' } }, 'card.pageId'],
    ['an unknown card type', { card: { type: 'form', formId: coachingPlan } }, 'card.type'],
    ['an event ID with a bar', { card: { type: 'event', eventId: 'evt|1' } }, 'card.eventId'],
    [
      'an occurrence that is not a date',
      { card: { ...event, occurrenceStart: 'Monday' } },
      'card.occurrenceStart',
    ],
    ['an unknown field', { pageTitle: 'Coaching plan – Q4' }, 'input'],
  ];
  for (const [name, change, path] of rejected) {
    it(`rejects ${name}`, () => {
      const issues = issuesFor({ ...minimal, ...change });
      expect(issues.map((issue) => issue.slice(0, issue.indexOf(': ')))).toEqual([path]);
    });
  }

  it('rejects more than 5 choices', () => {
    const choices = Array.from({ length: NOTICE_LIMITS.choices + 1 }, (_, index) => ({
      label: `${index + 1} hours`,
      value: `${index + 1}h`,
    }));
    const issues = issuesFor({
      ...minimal,
      buttons: [{ label: 'Snooze', action: 'reminders.snooze', choices }],
    });
    expect(issues.some((issue) => issue.startsWith('buttons.0.choices:'))).toBe(true);
  });

  it('lists every problem at once in a NoticeInputError', () => {
    let caught: unknown;
    try {
      parseSendNoticeInput({ ...minimal, kind: 'digest', title: '', userId: 'avery' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NoticeInputError);
    const error = caught as NoticeInputError;
    expect(error.issues).toHaveLength(3);
    expect(error.message).toMatch(/^sendNotice: /);
  });

  it('rejects input that is not an object', () => {
    expect(issuesFor(null)).toHaveLength(1);
    expect(issuesFor('Hello')).toHaveLength(1);
  });
});

describe('isRelativeHref', () => {
  it.each(['/p/3f1c2d4e', '/calendar?event=evt_42', '/messages/care-hub#latest', '/'])(
    'allows %s',
    (href) => {
      expect(isRelativeHref(href)).toBe(true);
    },
  );

  it.each([
    '',
    'p/3f1c2d4e',
    '//example.com/p/1',
    '/\\example.com',
    'https://example.com/',
    'mailto:avery@example.com',
    '/p/a b',
    '/p/a\tb',
    '/p/a\nb',
    '/p/a\u0000b',
    '/p/a\u00a0b',
  ])('refuses %j', (href) => {
    expect(isRelativeHref(href)).toBe(false);
  });
});
