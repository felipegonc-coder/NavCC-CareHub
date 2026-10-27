import { describe, expect, it } from 'vitest';
import type { ExternalEvent, ExternalTime } from '../types';
import { parseCalendar } from './parse';
import { serializeCalendar } from './serialize';
import { logicalLines, parseContentLine, readComponents } from './text';

const NOW = new Date('2026-06-01T12:34:56Z');
const zoned = (dateTime: string, timeZone = 'America/Denver'): ExternalTime => ({
  kind: 'zoned',
  dateTime,
  timeZone,
});

const SERIES: ExternalEvent = {
  uid: 'shift@example.com',
  status: 'confirmed',
  title: 'Opening shift, Bluebird Bakery',
  description: 'Bring keys; unlock at 5:45\nAsk Sam Ortiz about deliveries',
  location: 'Bluebird Bakery, 12 Main St',
  videoLink: 'https://zoom.us/j/5550100123',
  start: zoned('2026-10-26T06:00'),
  end: zoned('2026-10-26T14:00'),
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE',
  rdates: [zoned('2026-10-31T06:00')],
  exdates: [
    zoned('2026-11-02T06:00'),
    zoned('2026-11-03T06:00'),
    { kind: 'date', date: '2026-11-04' },
  ],
  sequence: 4,
  updatedAt: '2026-05-30T10:00:15.000Z',
  busy: true,
  visibility: 'private',
};

const MOVED: ExternalEvent = {
  uid: 'shift@example.com',
  recurrenceId: zoned('2026-10-28T06:00'),
  status: 'confirmed',
  title: 'Opening shift (late start)',
  start: zoned('2026-10-28T08:00'),
  end: zoned('2026-10-28T16:00'),
  updatedAt: '2026-05-31T09:00:00.000Z',
  busy: true,
};

const OTHERS: ExternalEvent[] = [
  {
    uid: 'holidays@example.com',
    status: 'confirmed',
    title: 'Closed for the holidays',
    start: { kind: 'date', date: '2026-12-24' },
    end: { kind: 'date', date: '2026-12-27' },
    updatedAt: '2026-05-01T00:00:00.000Z',
    busy: false,
  },
  {
    uid: 'call@example.com',
    status: 'tentative',
    title: 'Call with Northwind Tiles',
    start: { kind: 'utc', instant: '2026-11-05T16:00:00.000Z' },
    end: { kind: 'utc', instant: '2026-11-05T16:30:00.000Z' },
    updatedAt: '2026-05-02T00:00:00.000Z',
    busy: true,
    visibility: 'public',
  },
  {
    uid: 'inventory@example.com',
    status: 'cancelled',
    title: 'Inventory',
    start: { kind: 'floating', dateTime: '2026-11-06T09:00' },
    end: { kind: 'floating', dateTime: '2026-11-06T10:30' },
    updatedAt: '2026-05-03T00:00:00.000Z',
    busy: true,
  },
];

const physicalLines = (text: string) => text.split('\r\n').slice(0, -1);

describe('serializeCalendar', () => {
  it('round trips through the reader', () => {
    const text = serializeCalendar([MOVED, SERIES, ...OTHERS], { now: NOW });
    const result = parseCalendar(text, { now: NOW });
    expect(result.warnings).toEqual([]);
    expect(result.events).toEqual([SERIES, ...OTHERS, MOVED]);
  });

  it('writes the calendar and event properties', () => {
    const lines = [...logicalLines(serializeCalendar([SERIES], { now: NOW }))].map((l) => l.text);
    expect(lines.slice(0, 4)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Care Hub//Calendar//EN',
      'CALSCALE:GREGORIAN',
    ]);
    const event = lines.slice(lines.indexOf('BEGIN:VEVENT'));
    expect(event).toEqual([
      'BEGIN:VEVENT',
      'UID:shift@example.com',
      'DTSTAMP:20260601T123456Z',
      'DTSTART;TZID=America/Denver:20261026T060000',
      'DTEND;TZID=America/Denver:20261026T140000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE',
      'RDATE;TZID=America/Denver:20261031T060000',
      'EXDATE;TZID=America/Denver:20261102T060000,20261103T060000',
      'EXDATE;VALUE=DATE:20261104',
      'SUMMARY:Opening shift\\, Bluebird Bakery',
      'DESCRIPTION:Bring keys\\; unlock at 5:45\\nAsk Sam Ortiz about deliveries',
      'LOCATION:Bluebird Bakery\\, 12 Main St',
      'URL:https://zoom.us/j/5550100123',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'CLASS:PRIVATE',
      'SEQUENCE:4',
      'LAST-MODIFIED:20260530T100015Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
    expect(lines.filter((l) => l === 'BEGIN:VTIMEZONE')).toHaveLength(1);
  });

  it('writes CRLF lines of at most 75 octets, without splitting characters', () => {
    const title = `Cake tasting ${'🎂🧁'.repeat(30)} with Riley Chen`;
    const text = serializeCalendar([{ ...MOVED, recurrenceId: undefined, title }], { now: NOW });
    expect(text.endsWith('\r\n')).toBe(true);
    for (const line of physicalLines(text)) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
    expect(text.includes('\uFFFD')).toBe(false);
    expect(parseCalendar(new TextEncoder().encode(text)).events[0]?.title).toBe(title);
  });

  it('cannot be made to write extra properties', () => {
    const sneaky: ExternalEvent = {
      ...MOVED,
      recurrenceId: undefined,
      uid: 'sneaky@example.com\r\nX-INJECTED:1',
      title: 'Lunch\r\nATTENDEE:mailto:intruder@example.net',
      location: 'Room 2\nEND:VEVENT',
      rrule: 'FREQ=DAILY\r\nX-INJECTED:2',
      videoLink: 'https://zoom.us/j/5550100123\r\nX-INJECTED:3',
      organizerEmail: 'avery.lin@example.com',
      attendees: [{ email: 'sam.ortiz@example.org', response: 'accepted' }],
    };
    const text = serializeCalendar([sneaky], { now: NOW, prodId: 'Care Hub\r\nX-INJECTED:5' });
    const lines = [...logicalLines(text)].map((l) => parseContentLine(l.text, l.line)!);
    const names = lines.map((l) => l.name);
    expect(names.filter((n) => /^(X-INJECTED|ATTENDEE|ORGANIZER)$/.test(n))).toEqual([]);
    expect(lines.filter((l) => l.name === 'END' && l.value === 'VEVENT')).toHaveLength(1);
    const [read] = parseCalendar(text).events;
    expect(read?.title).toBe('Lunch\nATTENDEE:mailto:intruder@example.net');
    expect(read?.location).toBe('Room 2\nEND:VEVENT');
    expect(read?.attendees).toBeUndefined();
  });

  it('writes one VTIMEZONE per zone, covering the years in use', () => {
    const text = serializeCalendar(
      [
        SERIES,
        {
          ...MOVED,
          recurrenceId: undefined,
          uid: 'london@example.com',
          start: zoned('2030-01-10T09:00', 'Europe/London'),
          end: zoned('2030-01-10T10:00', 'Europe/London'),
        },
      ],
      { now: NOW },
    );
    const [calendar] = readComponents(
      [...logicalLines(text)].map((l) => parseContentLine(l.text, l.line)!),
    );
    const zones = calendar!.children.filter((c) => c.name === 'VTIMEZONE');
    expect(zones.map((z) => z.props.find((p) => p.name === 'TZID')?.value)).toEqual([
      'America/Denver',
      'Europe/London',
    ]);
  });

  it('refuses malformed times instead of writing them', () => {
    const bad = (start: ExternalTime) => () =>
      serializeCalendar([{ ...MOVED, recurrenceId: undefined, start }], { now: NOW });
    expect(bad({ kind: 'utc', instant: '2026-11-05T16:00:00' })).toThrow(/Invalid instant/);
    expect(bad({ kind: 'floating', dateTime: '2026-11-05 16:00' })).toThrow(/Invalid date/);
    expect(bad({ kind: 'date', date: '2026-02-30' })).toThrow(/Invalid date/);
  });
});
