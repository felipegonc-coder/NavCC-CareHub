import { describe, expect, it } from 'vitest';
import type { ExternalEvent } from '../sync/types';
import { eventBounds } from './bounds';

const NY = 'America/New_York';
const base: ExternalEvent = {
  uid: 'physio-1@example.org',
  status: 'confirmed',
  title: 'Physio',
  busy: true,
  start: { kind: 'zoned', dateTime: '2026-11-03T09:00', timeZone: NY },
  end: { kind: 'zoned', dateTime: '2026-11-03T10:00', timeZone: NY },
};
const iso = (bounds: { startsAt: Date; endsAt: Date | null }) => ({
  startsAt: bounds.startsAt.toISOString(),
  endsAt: bounds.endsAt?.toISOString() ?? null,
});

describe('event bounds', () => {
  it('widens wall-clock times by 14 hours on each side', () => {
    expect(iso(eventBounds(base))).toEqual({
      startsAt: '2026-11-02T19:00:00.000Z',
      endsAt: '2026-11-04T00:00:00.000Z',
    });
    const withSeconds: ExternalEvent = {
      ...base,
      start: { kind: 'floating', dateTime: '2026-11-03T09:00:30' },
      end: { kind: 'floating', dateTime: '2026-11-03T10:00:30' },
    };
    expect(iso(eventBounds(withSeconds))).toEqual({
      startsAt: '2026-11-02T19:00:30.000Z',
      endsAt: '2026-11-04T00:00:30.000Z',
    });
  });

  it('keeps instants exact, and an all-day event lasts its days', () => {
    const utc: ExternalEvent = {
      ...base,
      start: { kind: 'utc', instant: '2026-11-03T14:00:00.000Z' },
      end: { kind: 'utc', instant: '2026-11-03T15:00:00.000Z' },
    };
    expect(iso(eventBounds(utc))).toEqual({
      startsAt: '2026-11-03T14:00:00.000Z',
      endsAt: '2026-11-03T15:00:00.000Z',
    });
    const allDay: ExternalEvent = { ...base, start: { kind: 'date', date: '2026-12-21' } };
    delete allDay.end;
    expect(iso(eventBounds(allDay))).toEqual({
      startsAt: '2026-12-20T10:00:00.000Z',
      endsAt: '2026-12-22T14:00:00.000Z',
    });
  });

  it('leaves a series without an end open, and ends one with UNTIL', () => {
    expect(eventBounds({ ...base, rrule: 'FREQ=WEEKLY;COUNT=10' }).endsAt).toBeNull();
    const until = eventBounds({ ...base, rrule: 'FREQ=WEEKLY;UNTIL=20261231T235959Z' });
    expect(iso(until).endsAt).toBe('2027-01-01T14:59:59.000Z');
    const untilDate = eventBounds({ ...base, rrule: 'FREQ=DAILY;UNTIL=20261205' });
    expect(iso(untilDate).endsAt).toBe('2026-12-06T14:59:59.000Z');
  });

  it('covers extra dates, and the start a changed occurrence replaces', () => {
    const rdates = eventBounds({
      ...base,
      rdates: [{ kind: 'zoned', dateTime: '2026-12-03T09:00', timeZone: NY }],
    });
    expect(iso(rdates).endsAt).toBe('2026-12-04T00:00:00.000Z');
    const moved = eventBounds({
      ...base,
      recurrenceId: { kind: 'zoned', dateTime: '2026-10-27T09:00', timeZone: NY },
      rrule: 'FREQ=DAILY',
    });
    expect(iso(moved)).toEqual({
      startsAt: '2026-10-26T19:00:00.000Z',
      endsAt: '2026-11-04T00:00:00.000Z',
    });
  });

  it('includes unreadable times in every range rather than losing the event', () => {
    const odd = eventBounds({ ...base, start: { kind: 'utc', instant: 'soon' } });
    expect(odd).toEqual({ startsAt: new Date(0), endsAt: null });
  });
});
