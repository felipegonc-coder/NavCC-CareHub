import { describe, expect, it } from 'vitest';
import { type GoogleEvent, createGoogleCalendarClient, directTransport } from './client';
import { fromGoogleEvent } from './map';
import { createMockGoogle } from './mock-google';

const NY = 'America/New_York';
const AVERY = 'avery.lin@example.com';

const event = (fields: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: 'evt1',
  etag: '"7"',
  status: 'confirmed',
  iCalUID: 'evt1@google.com',
  summary: 'Physio',
  start: { dateTime: '2026-11-03T09:00:00-05:00', timeZone: NY },
  end: { dateTime: '2026-11-03T10:00:00-05:00', timeZone: NY },
  ...fields,
});

function mapped(fields: Partial<GoogleEvent> = {}, calendarTimeZone?: string) {
  const result = fromGoogleEvent(event(fields), calendarTimeZone ? { calendarTimeZone } : {});
  if (result.kind !== 'event') throw new Error(`Expected an event, got ${result.kind}`);
  return result;
}

describe('times', () => {
  it('keeps the zone and the wall-clock time', () => {
    const { event: mappedEvent, htmlLink } = mapped({
      description: 'Bring the exercise sheet',
      location: 'Riverside Clinic',
      sequence: 2,
      updated: '2026-10-20T08:15:42.120Z',
      organizer: { email: 'sam.ortiz@example.net' },
      htmlLink: 'https://www.google.com/calendar/event?eid=ZXZ0MQ',
    });
    expect(mappedEvent).toEqual({
      uid: 'evt1@google.com',
      remoteId: 'evt1',
      etag: '"7"',
      status: 'confirmed',
      title: 'Physio',
      description: 'Bring the exercise sheet',
      location: 'Riverside Clinic',
      start: { kind: 'zoned', dateTime: '2026-11-03T09:00', timeZone: NY },
      end: { kind: 'zoned', dateTime: '2026-11-03T10:00', timeZone: NY },
      sequence: 2,
      updatedAt: '2026-10-20T08:15:42.120Z',
      busy: true,
      organizerEmail: 'sam.ortiz@example.net',
    });
    expect(htmlLink).toBe('https://www.google.com/calendar/event?eid=ZXZ0MQ');
  });

  it("reads offset-only times in the calendar's zone, or as instants without one", () => {
    const offsetOnly = { start: { dateTime: '2026-11-03T14:00:30Z' }, end: undefined };
    expect(mapped(offsetOnly, 'Europe/Lisbon').event.start).toEqual({
      kind: 'zoned',
      dateTime: '2026-11-03T14:00',
      timeZone: 'Europe/Lisbon',
    });
    expect(mapped(offsetOnly).event.start).toEqual({
      kind: 'utc',
      instant: '2026-11-03T14:00:00.000Z',
    });
    const unknownZone = { start: { dateTime: '2026-11-03T14:00:00Z', timeZone: 'Mars/Base' } };
    expect(mapped(unknownZone).event.start).toEqual({
      kind: 'utc',
      instant: '2026-11-03T14:00:00.000Z',
    });
    const local = { start: { dateTime: '2026-11-03T09:00:00' } };
    expect(mapped(local).event.start).toEqual({ kind: 'floating', dateTime: '2026-11-03T09:00' });
  });

  it('keeps all-day events all-day, and free time free', () => {
    const { event: respite } = mapped({
      summary: 'Respite week',
      start: { date: '2026-12-21' },
      end: { date: '2026-12-28' },
      transparency: 'transparent',
    });
    expect(respite).toMatchObject({
      start: { kind: 'date', date: '2026-12-21' },
      end: { kind: 'date', date: '2026-12-28' },
      busy: false,
    });
    expect(mapped({ endTimeUnspecified: true }).event.end).toBeUndefined();
  });
});

describe('series', () => {
  it('keeps the RRULE, EXDATEs and RDATEs', () => {
    const { event: series } = mapped({
      summary: 'Physio',
      recurrence: [
        'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10',
        'EXDATE;TZID=America/New_York:20261110T090000,20261117T090000',
        'EXDATE:20261124T140000Z',
        'RDATE;VALUE=DATE:20261205',
        'RDATE;TZID=America/New_York:20261203T090000',
        'RDATE;VALUE=PERIOD:20261204T090000Z/PT1H',
        'EXRULE:FREQ=MONTHLY',
      ],
    });
    expect(series.rrule).toBe('FREQ=WEEKLY;BYDAY=TU;COUNT=10');
    expect(series.exdates).toEqual([
      { kind: 'zoned', dateTime: '2026-11-10T09:00', timeZone: NY },
      { kind: 'zoned', dateTime: '2026-11-17T09:00', timeZone: NY },
      { kind: 'utc', instant: '2026-11-24T14:00:00.000Z' },
    ]);
    expect(series.rdates).toEqual([
      { kind: 'date', date: '2026-12-05' },
      { kind: 'zoned', dateTime: '2026-12-03T09:00', timeZone: NY },
    ]);
  });

  it('gives a changed occurrence its series uid and the start it replaces', () => {
    const { event: moved } = mapped({
      id: 'evt1_20261110T140000Z',
      recurringEventId: 'evt1',
      originalStartTime: { dateTime: '2026-11-10T09:00:00-05:00', timeZone: NY },
      start: { dateTime: '2026-11-10T11:00:00-05:00', timeZone: NY },
      end: { dateTime: '2026-11-10T12:00:00-05:00', timeZone: NY },
      recurrence: ['RRULE:FREQ=DAILY'],
    });
    expect(moved).toMatchObject({
      uid: 'evt1@google.com',
      remoteId: 'evt1_20261110T140000Z',
      recurrenceId: { kind: 'zoned', dateTime: '2026-11-10T09:00', timeZone: NY },
      start: { kind: 'zoned', dateTime: '2026-11-10T11:00', timeZone: NY },
    });
    expect(moved.rrule).toBeUndefined();
  });

  it('marks a removed occurrence cancelled, and a removed event or series deleted', () => {
    const removed = fromGoogleEvent({
      id: 'evt1_20261117T140000Z',
      status: 'cancelled',
      recurringEventId: 'evt1',
      originalStartTime: { dateTime: '2026-11-17T09:00:00-05:00', timeZone: NY },
    });
    expect(removed).toEqual({
      kind: 'event',
      event: {
        uid: 'evt1@google.com',
        remoteId: 'evt1_20261117T140000Z',
        recurrenceId: { kind: 'zoned', dateTime: '2026-11-17T09:00', timeZone: NY },
        start: { kind: 'zoned', dateTime: '2026-11-17T09:00', timeZone: NY },
        status: 'cancelled',
        title: '',
        busy: false,
      },
    });
    expect(fromGoogleEvent({ id: 'evt2', status: 'cancelled' })).toEqual({
      kind: 'deleted',
      remoteId: 'evt2',
    });
  });
});

describe('people', () => {
  it("marks the person's own invitation, keeps replies, and leaves out rooms", () => {
    const { event: review } = mapped({
      organizer: { email: 'sam.ortiz@example.net', displayName: 'Sam Ortiz' },
      attendees: [
        { email: 'sam.ortiz@example.net', organizer: true, responseStatus: 'accepted' },
        { email: AVERY, displayName: 'Avery Lin', self: true, responseStatus: 'declined' },
        { email: 'jordan.lee@example.org', responseStatus: 'needsAction' },
        { email: 'room-2@resource.example.com', resource: true, responseStatus: 'accepted' },
        { displayName: 'No address', responseStatus: 'tentative' },
      ],
    });
    expect(review.attendees).toEqual([
      { email: 'sam.ortiz@example.net', response: 'accepted', organizer: true },
      { email: AVERY, name: 'Avery Lin', response: 'declined', self: true },
      { email: 'jordan.lee@example.org', response: 'needs-action' },
    ]);
    expect(review.organizerEmail).toBe('sam.ortiz@example.net');
  });

  it('reads confidential as private', () => {
    expect(mapped({ visibility: 'confidential' }).event.visibility).toBe('private');
    expect(mapped({ visibility: 'public' }).event.visibility).toBe('public');
  });
});

describe('meeting links', () => {
  it("prefers Google's conference details, then the location and description", () => {
    const meet = mapped({
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
          { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
        ],
      },
      location: 'https://example.zoom.us/j/5550100',
    });
    expect(meet.event.videoLink).toBe('https://meet.google.com/abc-defg-hij');
    expect(mapped({ hangoutLink: 'https://meet.google.com/xyz-abcd-efg' }).event.videoLink).toBe(
      'https://meet.google.com/xyz-abcd-efg',
    );
    const teams = mapped({
      location: 'Riverside Clinic',
      description: 'Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0 or call',
    });
    expect(teams.event.videoLink).toBe(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0',
    );
    expect(teams.event.location).toBe('Riverside Clinic');
    expect(mapped({ description: 'Notes: https://example.org/plan' }).event.videoLink).toBe(
      undefined,
    );
  });
});

describe('other events', () => {
  it('skips working-location entries and events without a start', () => {
    expect(fromGoogleEvent(event({ eventType: 'workingLocation' }))).toEqual({
      kind: 'skipped',
      remoteId: 'evt1',
      reason: 'working-location',
    });
    expect(fromGoogleEvent({ id: 'evt3', status: 'confirmed' })).toEqual({
      kind: 'skipped',
      remoteId: 'evt3',
      reason: 'no-start',
    });
  });

  it('only keeps an event page link that is really Google', () => {
    expect(mapped({ htmlLink: 'javascript:alert(1)' }).htmlLink).toBeUndefined();
    expect(mapped({ htmlLink: 'https://google.com.example.net/event' }).htmlLink).toBeUndefined();
    expect(mapped({ htmlLink: 'http://www.google.com/calendar/event' }).htmlLink).toBeUndefined();
  });
});

describe('with the client', () => {
  it('maps a series and its changes as read from Google', async () => {
    const google = createMockGoogle();
    const client = createGoogleCalendarClient({
      transport: directTransport({ fetch: google.fetch, accessToken: google.issueAccessToken() }),
    });
    const series = google.addEvent(AVERY, {
      summary: 'Physio',
      start: { dateTime: '2026-11-03T09:00:00', timeZone: NY },
      end: { dateTime: '2026-11-03T10:00:00', timeZone: NY },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=6'],
    });
    google.addEvent(AVERY, {
      id: `${String(series.id)}_20261110T140000Z`,
      iCalUID: series.iCalUID,
      recurringEventId: series.id,
      originalStartTime: { dateTime: '2026-11-10T09:00:00', timeZone: NY },
      summary: 'Physio (room 2)',
      start: { dateTime: '2026-11-10T09:00:00', timeZone: NY },
      end: { dateTime: '2026-11-10T10:00:00', timeZone: NY },
    });
    const window = { timeMin: '2026-04-27T00:00:00Z', timeMax: '2027-10-27T00:00:00Z' };
    const changes = await client.listEventChanges({ calendarId: AVERY, window });
    const events = changes.events.map((item) =>
      fromGoogleEvent(item, changes.timeZone ? { calendarTimeZone: changes.timeZone } : {}),
    );
    expect(events.map((item) => item.kind)).toEqual(['event', 'event']);
    const [master, moved] = events.map((item) => (item.kind === 'event' ? item.event : undefined));
    expect(master).toMatchObject({ rrule: 'FREQ=WEEKLY;COUNT=6', uid: series.iCalUID });
    expect(moved).toMatchObject({ uid: series.iCalUID, title: 'Physio (room 2)' });
    expect(events[0]?.kind === 'event' && events[0].htmlLink).toMatch(
      /^https:\/\/www\.google\.com\//,
    );
  });
});
