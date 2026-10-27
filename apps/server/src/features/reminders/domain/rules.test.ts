import { describe, expect, it } from 'vitest';
import { dueBefore, eventTargetSchema, isPending, minutesBeforeSchema } from './rules';

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
