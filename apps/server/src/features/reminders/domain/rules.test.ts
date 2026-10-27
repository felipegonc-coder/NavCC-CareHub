import { describe, expect, it } from 'vitest';
import type { Reminder } from '../types';
import {
  createReminderSchema,
  dueBefore,
  eventTargetSchema,
  isPending,
  minutesBeforeSchema,
  reminderList,
  toReminderView,
  updateReminderSchema,
} from './rules';

describe('event targets', () => {
  it('takes event IDs and occurrence starts as notice cards do', () => {
    const target = { type: 'event', eventId: 'evt_1', occurrenceStart: '2026-10-28T15:00:00Z' };
    expect(eventTargetSchema.parse(target)).toEqual(target);
    expect(eventTargetSchema.parse({ type: 'event', eventId: 'abc@google.com' }).eventId).toBe(
      'abc@google.com',
    );
  });

  it.each([
    { type: 'event', eventId: 'evt 1' },
    { type: 'event', eventId: '' },
    { type: 'event', eventId: 'evt_1', occurrenceStart: 'tomorrow' },
    { type: 'event', eventId: 'evt_1', extra: true },
  ])('refuses %j', (target) => {
    expect(eventTargetSchema.safeParse(target).success).toBe(false);
  });

  it('allows whole minutes from 23:59 on the day to 28 days before', () => {
    for (const ok of [-1439, -540, 0, 10, 900, 40_320]) {
      expect(minutesBeforeSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [-1440, 1.5, 40_321])
      expect(minutesBeforeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('dueBefore', () => {
  it('counts back from a timed start', () => {
    const start = { start: new Date('2026-10-28T15:00:00Z') };
    expect(dueBefore(start, 10, 'America/Denver').toISOString()).toBe('2026-10-28T14:50:00.000Z');
    expect(dueBefore(start, 0, 'America/Denver').toISOString()).toBe('2026-10-28T15:00:00.000Z');
  });

  it('puts all-day reminders at 9:00 AM on the wall clock, across a clock change', () => {
    // Denver's clocks go back on Sunday Nov 1, 2026: 9:00 AM that day is 16:00 UTC.
    const onTheDay = dueBefore({ allDay: '2026-11-01' }, -540, 'America/Denver');
    expect(onTheDay.toISOString()).toBe('2026-11-01T16:00:00.000Z');
    const dayBefore = dueBefore({ allDay: '2026-11-02' }, 900, 'America/Denver');
    expect(dayBefore.toISOString()).toBe('2026-11-01T16:00:00.000Z');
    const summer = dueBefore({ allDay: '2026-11-01' }, 900, 'America/Denver');
    expect(summer.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });
});

describe('isPending', () => {
  it('counts snoozed reminders as pending', () => {
    expect(
      ['pending', 'snoozed', 'sent', 'done', 'deleted'].map((status) =>
        isPending({ status: status as never }),
      ),
    ).toEqual([true, true, false, false, false]);
  });
});

const PAGE = { type: 'page', pageId: '0b9a4c1e-5d3f-4a7b-9c2e-1f0a2b3c4d5e' } as const;
const at = '2026-10-27T10:00:00-06:00';

describe('POST and PATCH bodies', () => {
  it('takes a page at a time, or an event minutes before, with a trimmed note', () => {
    expect(createReminderSchema.parse({ target: PAGE, at, note: '  Call Avery  ' })).toEqual({
      target: PAGE,
      at: new Date('2026-10-27T16:00:00Z'),
      note: 'Call Avery',
    });
    const event = { target: { type: 'event', eventId: 'evt_1' }, minutesBefore: 10 };
    expect(createReminderSchema.parse(event)).toEqual(event);
    expect(updateReminderSchema.parse({ note: '' })).toEqual({ note: '' });
  });

  it.each([
    { target: PAGE, minutesBefore: 10 },
    { target: PAGE, at, minutesBefore: 10 },
    { target: { type: 'event', eventId: 'evt_1' }, at },
    { target: { type: 'page', pageId: 'home' }, at },
    { target: PAGE, at: '2026-10-27T10:00' },
    { target: PAGE, at, color: 'red' },
  ])('refuses %j', (body) => {
    expect(createReminderSchema.safeParse(body).success).toBe(false);
  });

  it('says what to fix', () => {
    const long = createReminderSchema.safeParse({ target: PAGE, at, note: 'x'.repeat(281) });
    expect(long.error?.issues[0]?.message).toBe('Notes can be up to 280 characters.');
    const empty = updateReminderSchema.safeParse({});
    expect(empty.error?.issues[0]?.message).toBe('Change the time or the note.');
    expect(updateReminderSchema.safeParse({ at, minutesBefore: 5 }).success).toBe(false);
  });
});

describe('the Reminders list', () => {
  const base: Reminder = {
    id: 'r1',
    workspaceId: 'w1',
    userId: 'u1',
    target: PAGE,
    minutesBefore: null,
    dueAt: new Date('2026-10-28T15:00:00Z'),
    note: '',
    status: 'pending',
    timeZone: 'America/Denver',
    use24h: false,
    sentAt: null,
    createdAt: new Date('2026-10-26T15:00:00Z'),
  };
  const now = new Date('2026-10-27T15:00:00Z');
  const sent = (id: string, iso: string, status: Reminder['status'] = 'sent') => ({
    ...base,
    id,
    status,
    sentAt: new Date(iso),
  });

  it('puts pending soonest first, then sent in the last 30 days, newest first', () => {
    const list = reminderList(
      [
        base,
        { ...base, id: 'r2', status: 'snoozed', dueAt: new Date('2026-10-27T16:00:00Z') },
        sent('r3', '2026-10-20T15:00:00Z', 'done'),
        sent('r4', '2026-10-26T15:00:00Z'),
        sent('r5', '2026-09-20T15:00:00Z'),
        { ...base, id: 'r6', status: 'deleted' },
      ],
      now,
    );
    expect(list.pending.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(list.sent.map((r) => r.id)).toEqual(['r4', 'r3']);
  });

  it('sends times as ISO text', () => {
    expect(toReminderView(sent('r4', '2026-10-26T15:00:00Z'))).toEqual({
      id: 'r4',
      target: PAGE,
      minutesBefore: null,
      dueAt: '2026-10-28T15:00:00.000Z',
      note: '',
      status: 'sent',
      sentAt: '2026-10-26T15:00:00.000Z',
      createdAt: '2026-10-26T15:00:00.000Z',
    });
  });
});
