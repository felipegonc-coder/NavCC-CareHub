import { describe, expect, it } from 'vitest';
import {
  createEventSchema,
  deleteEventQuerySchema,
  duplicateSchema,
  editEventSchema,
  itemsQuerySchema,
  itemsResponseSchema,
  layerPatchSchema,
  replyBodySchema,
  rowDatePatchSchema,
} from './index';
import type { ItemsResponse } from './index';

/** The messages of a failed parse, or [] when it passed. */
function problems(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
}

const timed = { allDay: false, start: '2026-10-27T16:00:00.000Z', end: '2026-10-27T17:00:00.000Z' };
const allDay = { allDay: true, start: '2026-11-05', end: '2026-11-06' };

describe('itemsQuerySchema', () => {
  it('takes a week', () => {
    expect(itemsQuerySchema.parse({ from: '2026-10-25', to: '2026-11-01' })).toEqual({
      from: '2026-10-25',
      to: '2026-11-01',
    });
  });

  it('takes up to 42 days and no more', () => {
    expect(itemsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-12' }).success).toBe(true);
    expect(problems(itemsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-13' }))).toEqual([
      'Ask for at most 42 days at a time.',
    ]);
  });

  it('needs the end after the start', () => {
    expect(problems(itemsQuerySchema.safeParse({ from: '2026-10-25', to: '2026-10-25' }))).toEqual([
      'End after the start.',
    ]);
  });

  it('turns down dates that are not dates', () => {
    const result = itemsQuerySchema.safeParse({ from: '2026-02-30', to: 'next week' });
    expect(problems(result)).toEqual([
      'Use a date like 2026-10-27.',
      'Use a date like 2026-10-27.',
    ]);
  });
});

describe('createEventSchema', () => {
  it('takes a timed event and an all-day event', () => {
    expect(createEventSchema.parse({ ...timed, title: '  Shift handover  ' })).toEqual({
      ...timed,
      title: 'Shift handover',
    });
    expect(createEventSchema.safeParse(allDay).success).toBe(true);
  });

  it('takes a repeating meeting with its details', () => {
    const event = {
      ...timed,
      title: 'Rota planning',
      timeZone: 'America/Denver',
      repeat: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }], count: 6 },
      location: 'Room 2',
      description: 'Bring the draft rota.',
      videoUrl: 'https://us02web.zoom.us/j/123456789',
      people: ['user-ana', 'user-ben'],
    };
    expect(createEventSchema.parse(event)).toEqual(event);
  });

  it('matches values to all-day', () => {
    expect(problems(createEventSchema.safeParse({ ...timed, allDay: true }))).toEqual([
      'All-day events use dates.',
    ]);
    expect(problems(createEventSchema.safeParse({ ...allDay, allDay: false }))).toEqual([
      'Timed events use UTC times.',
    ]);
    expect(problems(createEventSchema.safeParse({ ...allDay, end: timed.end }))).toEqual([
      'Use the same kind of value as start.',
    ]);
  });

  it('needs the end after the start, or at it for a timed event', () => {
    expect(problems(createEventSchema.safeParse({ ...allDay, end: allDay.start }))).toEqual([
      'End after the start.',
    ]);
    expect(
      problems(createEventSchema.safeParse({ ...timed, end: '2026-10-27T15:45:00.000Z' })),
    ).toEqual(['End after the start.']);
    expect(createEventSchema.safeParse({ ...timed, end: timed.start }).success).toBe(true);
  });

  it('turns down times with an offset, unknown zones and unknown fields', () => {
    expect(
      createEventSchema.safeParse({ ...timed, start: '2026-10-27T10:00:00-06:00' }).success,
    ).toBe(false);
    expect(problems(createEventSchema.safeParse({ ...timed, timeZone: 'Mars/Olympus' }))).toEqual([
      'Pick a time zone from the list.',
    ]);
    expect(createEventSchema.safeParse({ ...timed, calendarId: 'google-1' }).success).toBe(false);
  });

  it('passes on the repeat rule problems in plain words', () => {
    const result = createEventSchema.safeParse({
      ...timed,
      repeat: { freq: 'weekly', interval: 0 },
    });
    expect(result.success).toBe(false);
    expect(problems(result).join(' ')).toMatch(/interval/i);
  });

  it('keeps to the limits', () => {
    expect(createEventSchema.safeParse({ ...timed, description: 'x'.repeat(8000) }).success).toBe(
      true,
    );
    expect(createEventSchema.safeParse({ ...timed, description: 'x'.repeat(8001) }).success).toBe(
      false,
    );
    expect(createEventSchema.safeParse({ ...timed, title: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('takes only web links as video links', () => {
    expect(
      problems(createEventSchema.safeParse({ ...timed, videoUrl: 'javascript:alert(1)' })),
    ).toEqual(['Use a link that starts with https://.']);
    expect(createEventSchema.safeParse({ ...timed, videoUrl: null }).success).toBe(true);
  });
});

describe('editEventSchema', () => {
  it('takes one changed field', () => {
    expect(editEventSchema.parse({ title: 'Team lunch' })).toEqual({ title: 'Team lunch' });
    expect(editEventSchema.parse({ repeat: null })).toEqual({ repeat: null });
  });

  it('needs a change', () => {
    expect(problems(editEventSchema.safeParse({}))).toEqual(['Send at least one change.']);
    expect(problems(editEventSchema.safeParse({ scope: 'all' }))).toEqual([
      'Send at least one change.',
    ]);
  });

  it('moves with allDay, start and end together', () => {
    expect(editEventSchema.safeParse({ ...timed, scope: 'all' }).success).toBe(true);
    expect(problems(editEventSchema.safeParse({ start: timed.start }))).toEqual([
      'Send allDay, start and end.',
    ]);
    expect(problems(editEventSchema.safeParse({ ...allDay, end: '2026-11-04' }))).toEqual([
      'End after the start.',
    ]);
  });

  it('needs the occurrence for This event and This and following', () => {
    expect(problems(editEventSchema.safeParse({ title: 'Moved', scope: 'one' }))).toEqual([
      'Choose an occurrence.',
    ]);
    const edit = { title: 'Moved', scope: 'following', occurrence: '2026-10-27T10:00' };
    expect(editEventSchema.parse(edit)).toEqual(edit);
    expect(editEventSchema.safeParse({ ...edit, occurrence: '27/10/2026' }).success).toBe(false);
  });

  it('takes a time zone only with the times', () => {
    const zone = { timeZone: 'America/New_York' };
    expect(editEventSchema.safeParse({ ...timed, ...zone }).success).toBe(true);
    expect(problems(editEventSchema.safeParse(zone))).toEqual([
      'Send the time zone with allDay, start and end.',
    ]);
  });

  it("doesn't change the repeat or the people of one occurrence", () => {
    const one = { scope: 'one', occurrence: '2026-10-27T10:00' };
    expect(problems(editEventSchema.safeParse({ ...one, repeat: null, people: [] }))).toEqual([
      'Change this for all events, or for this and following.',
      'Change this for all events, or for this and following.',
    ]);
    expect(editEventSchema.safeParse({ ...one, people: [], scope: 'all' }).success).toBe(true);
  });
});

describe('deleteEventQuerySchema', () => {
  it('needs the occurrence unless it deletes all events', () => {
    expect(deleteEventQuerySchema.parse({})).toEqual({});
    expect(deleteEventQuerySchema.parse({ scope: 'all' })).toEqual({ scope: 'all' });
    expect(problems(deleteEventQuerySchema.safeParse({ scope: 'following' }))).toEqual([
      'Choose an occurrence.',
    ]);
    expect(
      deleteEventQuerySchema.safeParse({ scope: 'one', occurrence: '2026-11-05' }).success,
    ).toBe(true);
  });
});

describe('duplicateSchema', () => {
  it('copies a Care Hub event or a synced event, not both', () => {
    expect(duplicateSchema.parse({ eventId: 'event-1', occurrence: '2026-10-27T10:00' })).toEqual({
      eventId: 'event-1',
      occurrence: '2026-10-27T10:00',
    });
    expect(duplicateSchema.parse({ syncedEventId: 'synced-1' })).toEqual({
      syncedEventId: 'synced-1',
    });
    expect(
      duplicateSchema.safeParse({ eventId: 'event-1', syncedEventId: 'synced-1' }).success,
    ).toBe(false);
  });
});

describe('replyBodySchema', () => {
  it('takes a reply with a short note', () => {
    expect(replyBodySchema.parse({ reply: 'maybe', note: ' Running late ' })).toEqual({
      reply: 'maybe',
      note: 'Running late',
    });
    expect(replyBodySchema.safeParse({ reply: 'maybe', note: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(replyBodySchema.safeParse({ reply: 'accepted' }).success).toBe(false);
  });
});

describe('layers and rows', () => {
  it('needs a layer change, and colour names', () => {
    expect(layerPatchSchema.parse({ on: false })).toEqual({ on: false });
    expect(problems(layerPatchSchema.safeParse({}))).toEqual(['Send at least one change.']);
    expect(problems(layerPatchSchema.safeParse({ color: '#ff0000' }))).toEqual([
      'Pick a colour from the list.',
    ]);
  });

  it('moves a row date, with or without an end', () => {
    const row = { propertyId: 'prop-due', allDay: true, start: '2026-11-05' };
    expect(rowDatePatchSchema.parse({ ...row, end: null })).toEqual({ ...row, end: null });
    expect(rowDatePatchSchema.safeParse({ ...row, start: timed.start }).success).toBe(false);
  });
});

describe('itemsResponseSchema', () => {
  const response: ItemsResponse = {
    from: '2026-10-25',
    to: '2026-11-01',
    timeZone: 'America/New_York',
    truncated: false,
    items: [
      {
        id: 'event-1:2026-10-27T10:00',
        source: 'event',
        layerId: 'meetings',
        title: 'Rota planning',
        allDay: false,
        start: '2026-10-27T16:00:00.000Z',
        end: '2026-10-27T17:00:00.000Z',
        timeZone: 'America/Denver',
        canEdit: false,
        eventId: 'event-1',
        occurrence: { key: '2026-10-27T10:00' },
        repeat: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
        location: '',
        description: '',
        videoLink: { url: 'https://meet.google.com/abc-defg-hij', provider: 'google-meet' },
        organizer: { id: 'user-ana', name: 'Ana Example', avatarUrl: null },
        people: [
          { id: 'user-ben', name: 'Ben Sample', avatarUrl: null, reply: 'maybe', note: 'Late' },
        ],
        myReply: 'maybe',
        canReply: true,
        notesPageId: null,
      },
      {
        id: 'synced-1',
        source: 'synced',
        layerId: 'layer-google-1',
        title: 'Dentist',
        allDay: false,
        start: '2026-10-28T13:00:00.000Z',
        end: '2026-10-28T14:00:00.000Z',
        timeZone: 'America/New_York',
        canEdit: false,
        syncedEventId: 'synced-1',
        occurrence: null,
        provider: 'google',
        calendarName: 'Personal',
        location: '',
        description: '',
        videoLink: null,
        organizer: null,
        people: [],
        myReply: null,
        externalUrl: 'https://calendar.google.com/calendar/event?eid=example',
        iOrganize: true,
      },
      {
        id: 'row-1',
        source: 'row',
        layerId: 'layer-db-1',
        title: 'Audit due',
        allDay: true,
        start: '2026-10-30',
        end: '2026-10-31',
        timeZone: null,
        canEdit: true,
        rowId: 'row-1',
        databaseId: 'db-1',
        propertyId: 'prop-due',
      },
      {
        id: 'course-1',
        source: 'learning',
        layerId: 'learning',
        title: 'Safe lifting',
        allDay: true,
        start: '2026-10-29',
        end: '2026-10-30',
        timeZone: null,
        canEdit: false,
        courseId: 'course-1',
        url: '/learning/courses/course-1',
      },
    ],
  };

  it('reads every kind of item', () => {
    expect(itemsResponseSchema.parse(response)).toEqual(response);
  });

  it('never lets a synced event be editable', () => {
    const items = response.items.map((item) => ({ ...item, canEdit: true }));
    expect(itemsResponseSchema.safeParse({ ...response, items }).success).toBe(false);
  });
});
