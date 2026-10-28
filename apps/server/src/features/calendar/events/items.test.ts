import { calendarEventSchema, eventItemSchema } from '@carehub/team-calendar-api';
import { describe, expect, it } from 'vitest';
import { eventItems, eventJson, replyFor, type Profiles, type StoredEvent } from './items';
import { windowOf } from './model';

const organizer = '00000000-0000-4000-8000-00000000000a';
const guestId = '00000000-0000-4000-8000-00000000000b';
const eventId = '00000000-0000-4000-8000-0000000000e1';
const denver = 'America/Denver';

const profiles: Profiles = new Map([
  [organizer, { id: organizer, name: 'Ada Example', avatarUrl: null }],
  [guestId, { id: guestId, name: 'Ben Sample', avatarUrl: '/avatars/ben.png' }],
]);

/** A one-off Tuesday 10:00 to 11:00 event in Denver that Ada organizes alone. */
const single: StoredEvent = {
  id: eventId,
  organizerId: organizer,
  allDay: false,
  timeZone: denver,
  start: '2026-10-27T10:00',
  end: '2026-10-27T11:00',
  rule: null,
  exceptions: [],
  overrides: {},
  title: 'Care plan review',
  location: 'Room 2',
  description: '',
  videoUrl: null,
  notesPageId: null,
  people: [],
  createdAt: new Date('2026-10-20T12:00:00.000Z'),
  updatedAt: new Date('2026-10-21T12:00:00.000Z'),
};

/** The same meeting every Tuesday from Oct 20, with Ben invited. */
const weekly: StoredEvent = {
  ...single,
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
  people: [
    {
      userId: guestId,
      reply: 'going',
      note: null,
      occurrenceReplies: { '2026-10-27T10:00': { reply: 'not-going', note: 'Away that day' } },
    },
  ],
};

const october = windowOf('2026-10-18', '2026-11-01', denver);
const itemsOf = (event: StoredEvent, viewer: string) =>
  eventItems(event, viewer, october, profiles).items;

describe('event items', () => {
  it('shows an event that does not repeat as one item, keyed by the event', () => {
    const [item, ...rest] = itemsOf(single, organizer);
    expect(rest).toEqual([]);
    expect(eventItemSchema.parse(item)).toEqual(item);
    expect(item).toMatchObject({
      id: eventId,
      eventId,
      occurrence: null,
      layerId: 'my-events',
      start: '2026-10-27T16:00:00.000Z',
      end: '2026-10-27T17:00:00.000Z',
      timeZone: denver,
      canEdit: true,
      canReply: false,
      myReply: null,
      organizer: { name: 'Ada Example' },
      people: [],
    });
  });

  it('keys each occurrence by its original start', () => {
    const items = itemsOf(weekly, organizer);
    expect(items.map((item) => item.id)).toEqual([
      `${eventId}:2026-10-20T10:00`,
      `${eventId}:2026-10-27T10:00`,
    ]);
    expect(items[1]?.occurrence).toEqual({ key: '2026-10-27T10:00' });
    expect(items[0]?.layerId).toBe('meetings');
  });

  it("shows each invited person's answer for that occurrence", () => {
    const [first, second] = itemsOf(weekly, guestId);
    expect(first).toMatchObject({ myReply: 'going', canReply: true, canEdit: false });
    expect(first?.people).toEqual([
      {
        id: guestId,
        name: 'Ben Sample',
        avatarUrl: '/avatars/ben.png',
        reply: 'going',
        note: null,
      },
    ]);
    expect(second?.myReply).toBe('not-going');
    expect(second?.people[0]).toMatchObject({ reply: 'not-going', note: 'Away that day' });
  });

  it('applies changes made to one occurrence', () => {
    const moved: StoredEvent = {
      ...weekly,
      overrides: {
        '2026-10-27T10:00': {
          start: '2026-10-28T09:00',
          end: '2026-10-28T09:30',
          changes: { title: 'Care plan review (moved)' },
        },
      },
    };
    const [, second] = itemsOf(moved, organizer);
    expect(second).toMatchObject({
      id: `${eventId}:2026-10-27T10:00`,
      title: 'Care plan review (moved)',
      start: '2026-10-28T15:00:00.000Z',
      location: 'Room 2',
    });
  });

  it('gives all-day items dates and no time zone', () => {
    const day: StoredEvent = { ...single, allDay: true, start: '2026-10-29', end: '2026-10-30' };
    expect(itemsOf(day, organizer)[0]).toMatchObject({
      allDay: true,
      start: '2026-10-29',
      end: '2026-10-30',
      timeZone: null,
    });
  });

  it('finds the video link in the link field, the location or the description', () => {
    const meet = 'https://meet.google.com/abc-defg-hij';
    const inLocation = itemsOf({ ...single, location: `Join at ${meet}` }, organizer)[0];
    expect(inLocation?.videoLink).toEqual({ url: meet, provider: 'google-meet' });
    expect(itemsOf(single, organizer)[0]?.videoLink).toBeNull();
  });

  it('shows people who are gone as a former member', () => {
    const [item] = eventItems(weekly, organizer, october, new Map()).items;
    expect(item?.organizer).toEqual({ id: organizer, name: 'Former member', avatarUrl: null });
  });
});

describe('the series', () => {
  it('has the series answers and the edit details', () => {
    const event = eventJson(weekly, guestId, profiles);
    expect(calendarEventSchema.parse(event)).toEqual(event);
    expect(event).toMatchObject({
      start: '2026-10-20T16:00:00.000Z',
      timeZone: denver,
      repeat: weekly.rule,
      myReply: 'going',
      canEdit: false,
      canReply: true,
      createdAt: '2026-10-20T12:00:00.000Z',
    });
    expect(event.people[0]?.reply).toBe('going');
  });

  it('falls back to the series answer for an occurrence without its own', () => {
    const [person] = weekly.people;
    if (!person) throw new Error('missing person');
    expect(replyFor(person, '2026-10-20T10:00')).toEqual({ reply: 'going', note: null });
    expect(replyFor(person, '2026-10-27T10:00')?.reply).toBe('not-going');
    expect(replyFor({ ...person, reply: null }, null)).toBeNull();
  });
});
