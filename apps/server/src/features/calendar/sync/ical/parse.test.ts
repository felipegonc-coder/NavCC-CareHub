import { describe, expect, it } from 'vitest';
import { IcalParseError, parseCalendar } from './parse';
import type { ParseOptions } from './parse';

const CRLF = '\r\n';
const NOW = new Date('2026-06-01T00:00:00Z');

function calendar(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Care Hub tests//EN',
    ...lines,
    'END:VCALENDAR',
    '',
  ].join(CRLF);
}

const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

function parse(text: string | Uint8Array, options: ParseOptions = {}) {
  return parseCalendar(text, { now: NOW, ...options });
}

function failure(run: () => unknown): IcalParseError {
  try {
    run();
  } catch (error) {
    if (error instanceof IcalParseError) return error;
    throw error;
  }
  throw new Error('Expected an IcalParseError');
}

const OUTLOOK_MOUNTAIN = [
  'BEGIN:VTIMEZONE',
  'TZID:(UTC-07:00) Mountain Time (US & Canada)',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0700',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0600',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

describe('parseCalendar: times', () => {
  it('reads zoned, UTC, floating and all-day times', () => {
    const { events, warnings } = parse(
      calendar(
        ...event(
          'UID:zoned@example.com',
          'DTSTART;TZID=America/New_York:20261102T090000',
          'DTEND;TZID=America/New_York:20261102T100000',
        ),
        ...event('UID:utc@example.com', 'DTSTART:20261102T150030Z', 'DTEND:20261102T160000Z'),
        ...event('UID:floating@example.com', 'DTSTART:20261102T090000', 'DTEND:20261102T0930'),
        ...event(
          'UID:all-day@example.com',
          'DTSTART;VALUE=DATE:20261224',
          'DTEND;VALUE=DATE:20261227',
        ),
      ),
    );
    expect(warnings).toEqual([]);
    expect(events.map((e) => [e.start, e.end])).toEqual([
      [
        { kind: 'zoned', dateTime: '2026-11-02T09:00', timeZone: 'America/New_York' },
        { kind: 'zoned', dateTime: '2026-11-02T10:00', timeZone: 'America/New_York' },
      ],
      [
        { kind: 'utc', instant: '2026-11-02T15:00:00.000Z' },
        { kind: 'utc', instant: '2026-11-02T16:00:00.000Z' },
      ],
      [
        { kind: 'floating', dateTime: '2026-11-02T09:00' },
        { kind: 'floating', dateTime: '2026-11-02T09:30' },
      ],
      [
        { kind: 'date', date: '2026-12-24' },
        { kind: 'date', date: '2026-12-27' },
      ],
    ]);
  });

  it('maps Windows and path-prefixed TZIDs to IANA zones', () => {
    const { events } = parse(
      calendar(
        ...event(
          'UID:windows@example.com',
          'DTSTART;TZID="Pacific Standard Time":20261103T150000',
          'DTEND;TZID=Pacific Standard Time:20261103T160000',
        ),
        ...event(
          'UID:prefixed@example.com',
          'DTSTART;TZID=/mozilla.org/20050126_1/Europe/London:20261103T150000',
        ),
      ),
    );
    expect(events[0]?.start).toEqual({
      kind: 'zoned',
      dateTime: '2026-11-03T15:00',
      timeZone: 'America/Los_Angeles',
    });
    expect(events[0]?.end).toMatchObject({ timeZone: 'America/Los_Angeles' });
    expect(events[1]?.start).toMatchObject({ timeZone: 'Europe/London' });
  });

  it('matches a custom VTIMEZONE to the IANA zone that behaves the same', () => {
    const { events, warnings } = parse(
      calendar(
        ...OUTLOOK_MOUNTAIN,
        ...event(
          'UID:outlook@example.com',
          'DTSTART;TZID="(UTC-07:00) Mountain Time (US & Canada)":20261103T150000',
          'DTEND;TZID="(UTC-07:00) Mountain Time (US & Canada)":20261103T160000',
        ),
      ),
    );
    expect(warnings).toEqual([]);
    expect(events[0]?.start).toEqual({
      kind: 'zoned',
      dateTime: '2026-11-03T15:00',
      timeZone: 'America/Denver',
    });
  });

  it('converts times in a custom zone that matches nothing to UTC', () => {
    const { events, warnings } = parse(
      calendar(
        'BEGIN:VTIMEZONE',
        'TZID:Bluebird Bakery Time',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0517',
        'TZOFFSETTO:+0517',
        'END:STANDARD',
        'END:VTIMEZONE',
        ...event(
          'UID:odd@example.com',
          'DTSTART;TZID=Bluebird Bakery Time:20261102T100000',
          'DURATION:PT1H',
        ),
      ),
    );
    expect(events[0]?.start).toEqual({ kind: 'utc', instant: '2026-11-02T04:43:00.000Z' });
    expect(events[0]?.end).toEqual({ kind: 'utc', instant: '2026-11-02T05:43:00.000Z' });
    expect(warnings[0]).toMatch(/matches no IANA zone/);
  });

  it('reads times in an unknown zone as floating', () => {
    const { events, warnings } = parse(
      calendar(...event('UID:unknown@example.com', 'DTSTART;TZID=Bakery/Nowhere:20261102T100000')),
    );
    expect(events[0]?.start).toEqual({ kind: 'floating', dateTime: '2026-11-02T10:00' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown/);
  });

  it('adds DURATION days on the wall clock and hours exactly, across a DST change', () => {
    const { events } = parse(
      calendar(
        ...event(
          'UID:night@example.com',
          'DTSTART;TZID=America/New_York:20261031T230000',
          'DURATION:PT4H',
        ),
        ...event(
          'UID:day@example.com',
          'DTSTART;TZID=America/New_York:20261031T090000',
          'DURATION:P1D',
        ),
        ...event('UID:dates@example.com', 'DTSTART;VALUE=DATE:20261224', 'DURATION:P2D'),
        ...event('UID:utc@example.com', 'DTSTART:20261102T150000Z', 'DURATION:PT1H30M'),
      ),
    );
    expect(events.map((e) => e.end)).toEqual([
      // 23:00 EDT plus four hours is 02:00 EST: the clocks went back at 02:00 EDT.
      { kind: 'zoned', dateTime: '2026-11-01T02:00', timeZone: 'America/New_York' },
      { kind: 'zoned', dateTime: '2026-11-01T09:00', timeZone: 'America/New_York' },
      { kind: 'date', date: '2026-12-26' },
      { kind: 'utc', instant: '2026-11-02T16:30:00.000Z' },
    ]);
  });

  it('uses the RFC 5545 default end, and resets ends that come before the start', () => {
    const { events, warnings } = parse(
      calendar(
        ...event('UID:a@example.com', 'DTSTART;VALUE=DATE:20261224'),
        ...event('UID:b@example.com', 'DTSTART:20261102T150000Z'),
        ...event('UID:c@example.com', 'DTSTART:20261102T150000Z', 'DTEND:20261102T140000Z'),
        ...event('UID:d@example.com', 'DTSTART;VALUE=DATE:20261224', 'DTEND:20261224T100000'),
        ...event('UID:e@example.com', 'DTSTART:20261102T090000', 'DTEND:20261102T240000'),
      ),
    );
    expect(events.map((e) => e.end)).toEqual([
      { kind: 'date', date: '2026-12-25' },
      { kind: 'utc', instant: '2026-11-02T15:00:00.000Z' },
      { kind: 'utc', instant: '2026-11-02T15:00:00.000Z' },
      { kind: 'date', date: '2026-12-25' },
      { kind: 'floating', dateTime: '2026-11-03T00:00' },
    ]);
    expect(warnings.filter((w) => /end was reset/.test(w))).toHaveLength(2);
  });
});

describe('parseCalendar: series', () => {
  it('reads a series with EXDATEs, a moved occurrence and a cancelled one', () => {
    const { events } = parse(
      calendar(
        ...event(
          'UID:standup@example.com',
          'DTSTART;TZID=America/Chicago:20261005T093000',
          'DTEND;TZID=America/Chicago:20261005T094500',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z',
          'EXDATE;TZID=America/Chicago:20261012T093000,20261014T093000',
          'EXDATE;VALUE=DATE:20261102',
          'SUMMARY:Bluebird Bakery stand-up',
          'SEQUENCE:2',
        ),
        ...event(
          'UID:standup@example.com',
          'RECURRENCE-ID;TZID=America/Chicago:20261019T093000',
          'DTSTART;TZID=America/Chicago:20261019T110000',
          'DTEND;TZID=America/Chicago:20261019T111500',
          'SUMMARY:Bluebird Bakery stand-up (moved)',
        ),
        ...event(
          'UID:standup@example.com',
          'RECURRENCE-ID;TZID=America/Chicago:20261021T093000',
          'DTSTART;TZID=America/Chicago:20261021T093000',
          'STATUS:CANCELLED',
          'SUMMARY:Bluebird Bakery stand-up',
        ),
      ),
    );
    const zoned = (dateTime: string) => ({
      kind: 'zoned',
      dateTime,
      timeZone: 'America/Chicago',
    });
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      uid: 'standup@example.com',
      status: 'confirmed',
      title: 'Bluebird Bakery stand-up',
      start: zoned('2026-10-05T09:30'),
      end: zoned('2026-10-05T09:45'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z',
      exdates: [
        zoned('2026-10-12T09:30'),
        zoned('2026-10-14T09:30'),
        { kind: 'date', date: '2026-11-02' },
      ],
      sequence: 2,
      busy: true,
    });
    expect(events[1]).toMatchObject({
      recurrenceId: zoned('2026-10-19T09:30'),
      start: zoned('2026-10-19T11:00'),
      title: 'Bluebird Bakery stand-up (moved)',
    });
    expect(events[2]).toMatchObject({
      recurrenceId: zoned('2026-10-21T09:30'),
      status: 'cancelled',
    });
  });

  it('warns about what it leaves out', () => {
    const { events, warnings } = parse(
      calendar(
        ...event(
          'UID:rules@example.com',
          'DTSTART:20261102T150000Z',
          'RRULE:FREQ=FORTNIGHTLY',
          'EXRULE:FREQ=WEEKLY',
        ),
        ...event(
          'UID:range@example.com',
          'RECURRENCE-ID;RANGE=THISANDFUTURE:20261109T150000Z',
          'DTSTART:20261109T160000Z',
        ),
      ),
    );
    expect(events[0]?.rrule).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/invalid RRULE/);
    expect(warnings.join('\n')).toMatch(/EXRULE/);
    expect(warnings.join('\n')).toMatch(/THISANDFUTURE/);
    expect(events[1]?.recurrenceId).toEqual({ kind: 'utc', instant: '2026-11-09T15:00:00.000Z' });
  });

  it('reads RDATE dates, times and periods as extra occurrences', () => {
    const { events } = parse(
      calendar(
        ...event(
          'UID:extra@example.com',
          'DTSTART;TZID=America/Denver:20261102T090000',
          'RDATE;TZID=America/Denver:20261104T090000,20261106T100000',
          'RDATE;VALUE=PERIOD:20261109T160000Z/PT1H',
        ),
        ...event(
          'UID:days@example.com',
          'DTSTART;VALUE=DATE:20261102',
          'RDATE;VALUE=DATE:20261105',
        ),
      ),
    );
    const denver = (dateTime: string) => ({ kind: 'zoned', dateTime, timeZone: 'America/Denver' });
    expect(events[0]?.rdates).toEqual([
      denver('2026-11-04T09:00'),
      denver('2026-11-06T10:00'),
      { kind: 'utc', instant: '2026-11-09T16:00:00.000Z' },
    ]);
    expect(events[1]?.rdates).toEqual([{ kind: 'date', date: '2026-11-05' }]);
  });
});

describe('parseCalendar: event details', () => {
  it('unescapes text, and keeps an emoji split across a fold', () => {
    const cake = new TextEncoder().encode('🎂');
    const encoder = new TextEncoder();
    const bytes = Uint8Array.from([
      ...encoder.encode(
        calendar(
          'BEGIN:VEVENT',
          'UID:cake@example.com',
          'DTSTART;VALUE=DATE:20261224',
          'DESCRIPTION:Tiles\\, grout\\; sealant\\nBring samples\\\\swatches',
          'LOCATION:Northwind Tiles\\, Main St',
        ).replace('END:VCALENDAR\r\n', ''),
      ),
      ...encoder.encode('SUMMARY:Cake tasting '),
      ...cake.subarray(0, 2),
      ...encoder.encode('\r\n '),
      ...cake.subarray(2),
      ...encoder.encode('\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'),
    ]);
    const [cakeEvent] = parse(bytes).events;
    expect(cakeEvent?.title).toBe('Cake tasting 🎂');
    expect(cakeEvent?.description).toBe('Tiles, grout; sealant\nBring samples\\swatches');
    expect(cakeEvent?.location).toBe('Northwind Tiles, Main St');
  });

  it('decodes the charset the server named', () => {
    const latin1 = Uint8Array.from(
      Buffer.from(
        calendar(...event('UID:cafe@example.com', 'DTSTART:20261102T150000Z', 'SUMMARY:Café')),
        'latin1',
      ),
    );
    expect(parse(latin1, { charset: 'ISO-8859-1' }).events[0]?.title).toBe('Café');
    const utf8 = new TextEncoder().encode(
      calendar(...event('UID:cafe@example.com', 'DTSTART:20261102T150000Z', 'SUMMARY:Café')),
    );
    expect(parse(utf8, { charset: 'not-a-charset' }).events[0]?.title).toBe('Café');
  });

  it('reads the organizer and attendees', () => {
    const [meeting] = parse(
      calendar(
        ...event(
          'UID:meeting@example.com',
          'DTSTART:20261102T150000Z',
          'ORGANIZER;CN=Avery Lin:mailto:avery.lin@example.com',
          'ATTENDEE;CN="Ortiz, Sam";PARTSTAT=ACCEPTED:mailto:sam.ortiz@example.org',
          'ATTENDEE;PARTSTAT=DECLINED;CN=Riley Chen:MAILTO:riley.chen@example.net',
          'ATTENDEE;CN=Avery Lin;PARTSTAT=ACCEPTED:mailto:Avery.Lin@example.com',
          'ATTENDEE;CN=Jordan Patel;EMAIL=jordan.patel@example.com:urn:uuid:00000000-0000-4000-8000-000000000001',
          'ATTENDEE;PARTSTAT=TENTATIVE:mailto:morgan.lee@example.org',
          'ATTENDEE;CN=Casey Nguyen:mailto:casey.nguyen@example.net',
          'ATTENDEE;CN=Nobody:not-an-address',
        ),
      ),
    ).events;
    expect(meeting?.organizerEmail).toBe('avery.lin@example.com');
    expect(meeting?.attendees).toEqual([
      { email: 'sam.ortiz@example.org', name: 'Ortiz, Sam', response: 'accepted' },
      { email: 'riley.chen@example.net', name: 'Riley Chen', response: 'declined' },
      { email: 'Avery.Lin@example.com', name: 'Avery Lin', response: 'accepted', organizer: true },
      { email: 'jordan.patel@example.com', name: 'Jordan Patel', response: 'needs-action' },
      { email: 'morgan.lee@example.org', response: 'tentative' },
      { email: 'casey.nguyen@example.net', name: 'Casey Nguyen', response: 'needs-action' },
    ]);
  });

  it('reads status, busy time and visibility', () => {
    const { events } = parse(
      calendar(
        ...event(
          'UID:a@example.com',
          'DTSTART:20261102T150000Z',
          'STATUS:TENTATIVE',
          'TRANSP:TRANSPARENT',
          'CLASS:CONFIDENTIAL',
        ),
        ...event(
          'UID:b@example.com',
          'DTSTART:20261102T150000Z',
          'CLASS:PUBLIC',
          'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
        ),
        ...event('UID:c@example.com', 'DTSTART:20261102T150000Z'),
        ...event('UID:d@example.com', 'DTSTART:20261102T150000Z', 'STATUS:CANCELLED'),
      ),
    );
    expect(events.map((e) => [e.status, e.busy, e.visibility])).toEqual([
      ['tentative', false, 'private'],
      ['confirmed', false, 'public'],
      ['confirmed', true, undefined],
      ['cancelled', true, undefined],
    ]);
  });

  it('finds video links in conference fields, location and descriptions', () => {
    const { events } = parse(
      calendar(
        ...event(
          'UID:meet@example.com',
          'DTSTART:20261102T150000Z',
          'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
          'DESCRIPTION:Also https://zoom.us/j/5550100123',
        ),
        ...event(
          'UID:conference@example.com',
          'DTSTART:20261102T150000Z',
          'CONFERENCE;VALUE=URI;FEATURE=PHONE:tel:+1-555-0100',
          'CONFERENCE;VALUE=URI;FEATURE=AUDIO,VIDEO:https://teams.live.com/meet/9876543210',
        ),
        ...event(
          'UID:zoom@example.com',
          'DTSTART:20261102T150000Z',
          'LOCATION:Zoom https://us06web.zoom.us/j/5550100123?context=example',
        ),
        ...event(
          'UID:teams@example.com',
          'DTSTART:20261102T150000Z',
          'X-ALT-DESC;FMTTYPE=text/html:<a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0">Join</a>',
        ),
        ...event(
          'UID:none@example.com',
          'DTSTART:20261102T150000Z',
          'URL:https://www.example.com/menu',
        ),
      ),
    );
    expect(events.map((e) => e.videoLink)).toEqual([
      'https://meet.google.com/abc-defg-hij',
      'https://teams.live.com/meet/9876543210',
      'https://us06web.zoom.us/j/5550100123?context=example',
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0',
      undefined,
    ]);
  });

  it('reads updatedAt from LAST-MODIFIED, or from DTSTAMP when there is no METHOD', () => {
    const events = [
      ...event('UID:a@example.com', 'DTSTART:20261102T150000Z', 'DTSTAMP:20261001T120030Z'),
      ...event(
        'UID:b@example.com',
        'DTSTART:20261102T150000Z',
        'DTSTAMP:20261001T120030Z',
        'LAST-MODIFIED:20261002T080000Z',
      ),
    ];
    expect(parse(calendar(...events)).events.map((e) => e.updatedAt)).toEqual([
      '2026-10-01T12:00:30.000Z',
      '2026-10-02T08:00:00.000Z',
    ]);
    expect(parse(calendar('METHOD:PUBLISH', ...events)).events.map((e) => e.updatedAt)).toEqual([
      undefined,
      '2026-10-02T08:00:00.000Z',
    ]);
  });

  it('ignores to-dos, journals and alarm properties', () => {
    const { events } = parse(
      calendar(
        'BEGIN:VTODO',
        'UID:todo@example.com',
        'DTSTART:20261102T150000Z',
        'SUMMARY:Order flour',
        'END:VTODO',
        'BEGIN:VJOURNAL',
        'UID:journal@example.com',
        'DTSTART:20261102T150000Z',
        'END:VJOURNAL',
        ...event(
          'UID:tasting@example.com',
          'DTSTART:20261102T150000Z',
          'SUMMARY:Tasting',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'DESCRIPTION:Reminder',
          'TRIGGER:-PT15M',
          'END:VALARM',
        ),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe('tasting@example.com');
    expect(events[0]?.description).toBeUndefined();
  });

  it('reads the calendar name, time zone and method, but no colour', () => {
    const { calendar: info } = parse(
      calendar(
        'METHOD:publish',
        'X-WR-CALNAME:Avery Lin',
        'X-WR-CALDESC:Shifts at Bluebird Bakery',
        'X-APPLE-CALENDAR-COLOR:#1BADF8',
        'X-WR-TIMEZONE:America/New_York',
      ),
    );
    expect(info).toEqual({
      name: 'Avery Lin',
      description: 'Shifts at Bluebird Bakery',
      timeZone: 'America/New_York',
      method: 'PUBLISH',
    });
  });
});

describe('parseCalendar: robustness', () => {
  it('skips broken events and keeps the rest', () => {
    const result = parse(
      calendar(
        ...event('UID:no-start@example.com', 'SUMMARY:No start'),
        ...event('UID:bad-start@example.com', 'DTSTART:2026-11-02'),
        ...event('UID:bad-recurrence@example.com', 'DTSTART:20261102T150000Z', 'RECURRENCE-ID:x'),
        'NOT A CONTENT LINE',
        ...event('UID:good@example.com', 'DTSTART:20261102T150000Z'),
      ),
    );
    expect(result.events.map((e) => e.uid)).toEqual(['good@example.com']);
    expect(result.skipped).toBe(3);
    expect(result.warnings.join('\n')).toMatch(/near line 5 has no valid start time/);
    expect(result.warnings.join('\n')).toMatch(/Line 17 isn't a valid iCalendar line/);
  });

  it('gives an event without a UID a stable one', () => {
    const text = calendar(...event('DTSTART:20261102T150000Z', 'SUMMARY:Delivery'));
    const first = parse(text).events[0]?.uid;
    expect(first).toMatch(/^nouid-[0-9a-f]{32}$/);
    expect(parse(text).events[0]?.uid).toBe(first);
  });

  it('keeps the newer copy of a repeated event', () => {
    const copy = (sequence: number, modified: string, title: string) =>
      event(
        'UID:repeat@example.com',
        'DTSTART:20261102T150000Z',
        `SEQUENCE:${sequence}`,
        `LAST-MODIFIED:${modified}`,
        `SUMMARY:${title}`,
      );
    const { events, warnings } = parse(
      calendar(
        ...copy(1, '20261001T000000Z', 'one'),
        ...copy(3, '20261001T000000Z', 'three'),
        ...copy(2, '20261009T000000Z', 'two'),
        ...copy(3, '20261005T000000Z', 'three, later'),
      ),
    );
    expect(events.map((e) => e.title)).toEqual(['three, later']);
    expect(warnings).toHaveLength(3);
  });

  it('stops at maxEvents and says so', () => {
    const many = [1, 2, 3].flatMap((n) =>
      event(`UID:${n}@example.com`, 'DTSTART:20261102T150000Z'),
    );
    const result = parse(calendar(...many), { maxEvents: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(parse(calendar(...many)).truncated).toBe(false);
  });

  it('keeps only events that may touch the window', () => {
    const { events } = parse(
      calendar(
        ...event('UID:inside@example.com', 'DTSTART:20261102T150000Z'),
        ...event('UID:past@example.com', 'DTSTART:20250102T150000Z'),
        ...event('UID:future@example.com', 'DTSTART;VALUE=DATE:20280102'),
        ...event('UID:open-series@example.com', 'DTSTART:20250106T150000Z', 'RRULE:FREQ=WEEKLY'),
        ...event(
          'UID:ended-series@example.com',
          'DTSTART:20250106T150000Z',
          'RRULE:FREQ=WEEKLY;UNTIL=20250601T000000Z',
        ),
        ...event('UID:later-series@example.com', 'DTSTART:20280106T150000Z', 'RRULE:FREQ=DAILY'),
        ...event(
          'UID:open-series@example.com',
          'RECURRENCE-ID:20261103T150000Z',
          'DTSTART:20280103T150000Z',
        ),
        ...event(
          'UID:long@example.com',
          'DTSTART;VALUE=DATE:20260901',
          'DTEND;VALUE=DATE:20261015',
        ),
      ),
      {
        window: { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') },
      },
    );
    expect(events.map((e) => `${e.uid}${e.recurrenceId ? ' (moved)' : ''}`)).toEqual([
      'inside@example.com',
      'open-series@example.com',
      'open-series@example.com (moved)',
      'long@example.com',
    ]);
  });

  it('accepts events outside a VCALENDAR', () => {
    const loose = ['BEGIN:VEVENT', 'UID:loose@example.com', 'DTSTART:20261102T150000Z', ''].join(
      '\n',
    );
    expect(parse(loose).events.map((e) => e.uid)).toEqual(['loose@example.com']);
  });

  it('rejects input that is not a calendar', () => {
    for (const text of ['', 'hello', '<!doctype html><html><body>Sign in</body></html>']) {
      expect(failure(() => parse(text)).code).toBe('not-calendar');
    }
  });

  it('rejects input over maxBytes', () => {
    const text = calendar(...event('UID:big@example.com', 'DTSTART:20261102T150000Z'));
    expect(failure(() => parse(text, { maxBytes: 100 })).code).toBe('too-large');
    expect(failure(() => parse(new TextEncoder().encode(text), { maxBytes: 100 })).code).toBe(
      'too-large',
    );
  });

  it('keeps at most 50 warnings', () => {
    const noise = Array.from({ length: 60 }, (_, i) => `noise line ${i}`);
    expect(parse(calendar(...noise)).warnings).toHaveLength(50);
  });
});
