import { describe, expect, it } from 'vitest';
import type { Reminder } from '../types';
import { lateNote, reminderHref, reminderNotice, snoozeLabel } from './notice';

const PAGE_ID = '0b9a4c1e-5d3f-4a7b-9c2e-1f0a2b3c4d5e';
const denver = { timeZone: 'America/Denver', use24h: false };
const reminder: Reminder = {
  id: '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  workspaceId: 'w1',
  userId: 'u1',
  target: { type: 'page', pageId: PAGE_ID },
  minutesBefore: null,
  dueAt: new Date('2026-10-27T15:00:00Z'), // 9:00 AM in Denver
  note: 'Call Bluebird Bakery',
  status: 'pending',
  ...denver,
  sentAt: null,
  createdAt: new Date('2026-10-26T15:00:00Z'),
};

describe('labels', () => {
  it('follows the 24-hour setting', () => {
    expect(snoozeLabel('15m', denver)).toBe('15 minutes');
    expect(snoozeLabel('tomorrow', denver)).toBe('Tomorrow at 9:00 AM');
    expect(snoozeLabel('tomorrow', { ...denver, use24h: true })).toBe('Tomorrow at 09:00');
  });

  it('says when a late reminder was due', () => {
    const due = new Date('2026-10-27T15:00:00Z');
    expect(lateNote(due, new Date('2026-10-27T18:00:00Z'), denver)).toBe(
      'Late: was due at 9:00 AM',
    );
    expect(lateNote(due, new Date('2026-10-28T18:00:00Z'), denver)).toBe(
      'Late: was due Oct 27 at 9:00 AM',
    );
    const newYearsEve = new Date('2026-12-31T23:00:00Z');
    expect(
      lateNote(newYearsEve, new Date('2027-01-01T18:00:00Z'), { ...denver, use24h: true }),
    ).toBe('Late: was due Dec 31, 2026 at 16:00');
  });
});

describe('reminderHref', () => {
  it('opens the page, or the event occurrence in Calendar', () => {
    expect(reminderHref({ type: 'page', pageId: PAGE_ID })).toBe(`/p/${PAGE_ID}`);
    expect(reminderHref({ type: 'event', eventId: 'evt_1' })).toBe('/calendar?event=evt_1');
    expect(
      reminderHref({ type: 'event', eventId: 'evt_1', occurrenceStart: '2026-10-28T15:00:00Z' }),
    ).toBe('/calendar?event=evt_1&occurrence=2026-10-28T15%3A00%3A00Z');
  });
});

describe('reminderNotice', () => {
  it('has a generic title, the note, the card and Open, Snooze and Done', () => {
    const notice = reminderNotice(reminder, new Date('2026-10-27T15:00:30Z'));
    expect(notice).toMatchObject({
      workspaceId: 'w1',
      userId: 'u1',
      kind: 'reminder',
      sender: 'Reminders',
      icon: '⏰',
      title: 'Reminder',
      text: 'Call Bluebird Bakery',
      card: { type: 'page', pageId: PAGE_ID },
      groupKey: `reminders:${reminder.id}`,
    });
    expect(notice.buttons).toEqual([
      { label: 'Open', href: `/p/${PAGE_ID}` },
      {
        label: 'Snooze',
        action: 'reminders.snooze',
        choices: [
          { label: '15 minutes', value: `${reminder.id}:15m` },
          { label: '1 hour', value: `${reminder.id}:1h` },
          { label: 'Tomorrow at 9:00 AM', value: `${reminder.id}:tomorrow` },
        ],
      },
      { label: 'Done', action: 'reminders.done', value: reminder.id },
    ]);
  });

  it('adds the Late line, and has no text without a note or lateness', () => {
    const late = reminderNotice(reminder, new Date('2026-10-27T18:00:00Z'));
    expect(late.text).toBe('Late: was due at 9:00 AM\nCall Bluebird Bakery');
    const plain = reminderNotice({ ...reminder, note: '' }, reminder.dueAt);
    expect(plain.text).toBeUndefined();
  });
});
