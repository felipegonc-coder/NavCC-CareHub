import { describe, expect, it } from 'vitest';
import type { StoredEvent, StoredPerson } from './items';
import { MEETING_WINDOW_MS, meetingOf } from './meetings';

const ada = '00000000-0000-4000-8000-00000000000a';
const ben = '00000000-0000-4000-8000-00000000000b';
const cy = '00000000-0000-4000-8000-00000000000c';
/** "Today" for these tests: Wed, Oct 28, 2026. */
const now = new Date('2026-10-28T15:00:00.000Z');

const invited = (userId: string): StoredPerson => ({
  userId,
  reply: null,
  note: null,
  occurrenceReplies: {},
});

/** Ada's huddle on Tuesdays 10:00 to 11:00 in Denver from Oct 20, 2026, with Ben and Cy. */
const weekly: StoredEvent = {
  id: '00000000-0000-4000-8000-0000000000e1',
  organizerId: ada,
  allDay: false,
  timeZone: 'America/Denver',
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
  exceptions: ['2026-11-10T10:00'],
  overrides: {
    // Later that week (after DST ends), and renamed for it.
    '2026-11-03T10:00': {
      start: '2026-11-03T14:00',
      end: '2026-11-03T15:00',
      changes: { title: 'Huddle, late' },
    },
    // The whole day that week.
    '2026-11-17T10:00': { start: '2026-11-17', end: '2026-11-18' },
  },
  title: 'Team huddle',
  location: '',
  description: '',
  videoUrl: null,
  notesPageId: null,
  people: [invited(ben), invited(cy)],
  createdAt: new Date('2026-10-19T12:00:00.000Z'),
  updatedAt: new Date('2026-10-19T12:00:00.000Z'),
};

const single: StoredEvent = {
  ...weekly,
  start: '2026-10-27T10:00',
  end: '2026-10-27T11:00',
  rule: null,
  exceptions: [],
  overrides: {},
};

describe('meetingOf', () => {
  it('gives an event that does not repeat without a key, with the people invited', () => {
    expect(meetingOf(single, undefined, now)).toEqual({
      eventId: single.id,
      occurrence: null,
      title: 'Team huddle',
      allDay: false,
      start: '2026-10-27T16:00:00.000Z',
      timeZone: 'America/Denver',
      organizerId: ada,
      memberIds: [ben, cy],
    });
  });

  it('gives one occurrence of a series as it is now, under its key', () => {
    expect(meetingOf(weekly, '2026-10-27T10:00', now)).toMatchObject({
      occurrence: '2026-10-27T10:00',
      title: 'Team huddle',
      allDay: false,
      start: '2026-10-27T16:00:00.000Z',
    });
    expect(meetingOf(weekly, '2026-11-03T10:00', now)).toMatchObject({
      occurrence: '2026-11-03T10:00',
      title: 'Huddle, late',
      allDay: false,
      start: '2026-11-03T21:00:00.000Z',
    });
    expect(meetingOf(weekly, '2026-11-17T10:00', now)).toMatchObject({
      occurrence: '2026-11-17T10:00',
      title: 'Team huddle',
      allDay: true,
      start: '2026-11-17',
    });
  });

  it('is null without a key on a series, with one on a single event, or for no occurrence', () => {
    expect(meetingOf(weekly, undefined, now)).toBeNull();
    expect(meetingOf(single, '2026-10-27T10:00', now)).toBeNull();
    // Removed, not a Tuesday, and not a key.
    expect(meetingOf(weekly, '2026-11-10T10:00', now)).toBeNull();
    expect(meetingOf(weekly, '2026-10-28T10:00', now)).toBeNull();
    expect(meetingOf(weekly, 'next week', now)).toBeNull();
  });

  it('is null more than a year from today, either way', () => {
    const start = Date.parse('2026-10-27T16:00:00.000Z');
    expect(meetingOf(single, undefined, new Date(start + MEETING_WINDOW_MS))).not.toBeNull();
    expect(meetingOf(single, undefined, new Date(start + MEETING_WINDOW_MS + 60_000))).toBeNull();
    expect(meetingOf(single, undefined, new Date(start - MEETING_WINDOW_MS - 60_000))).toBeNull();
    // A series that goes on: only its occurrences within the year.
    expect(meetingOf(weekly, '2027-10-26T10:00', now)).not.toBeNull();
    expect(meetingOf(weekly, '2027-11-02T10:00', now)).toBeNull();
  });

  it('leaves the organizer out and keeps at most 200 people invited', () => {
    const ids = Array.from(
      { length: 250 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    );
    const big = { ...single, people: [invited(ada), ...ids.map(invited)] };
    expect(meetingOf(big, undefined, now)?.memberIds).toEqual(ids.slice(0, 200));
  });
});
