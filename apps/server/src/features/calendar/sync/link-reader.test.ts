import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { FetchLinkError } from './fetch-link';
import type { Resolver, Transport, TransportRequest } from './fetch-link';
import { IcalParseError } from './ical/parse';
import { readCalendarLink } from './link-reader';
import type { LinkCursor } from './link-reader';

const LINK = 'webcal://calendar.example.com/feeds/avery.ics?token=fictional-token';
const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];

const feed = (...lines: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Calendar//EN',
    'X-WR-CALNAME:Care Team Demo',
    'X-WR-CALDESC:Shifts and visits',
    'X-WR-TIMEZONE:America/New_York',
    ...lines,
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const event = (uid: string, start: string) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  'DTSTAMP:20261020T120000Z',
  `DTSTART:${start}`,
  'DURATION:PT1H',
  'SUMMARY:Visit at Bluebird Bakery',
  'ORGANIZER;CN=Sam Ortiz:mailto:sam.ortiz@example.com',
  'ATTENDEE;CN=Avery Lin;PARTSTAT=ACCEPTED:mailto:Avery.Lin@example.com',
  'ATTENDEE;CN=Riley Chen;PARTSTAT=NEEDS-ACTION:mailto:riley.chen@example.org',
  'END:VEVENT',
];

function server(...replies: [number, IncomingHttpHeaders?, string?][]) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    const [status, headers = {}, body = ''] = replies[requests.length - 1] ?? [500];
    return {
      status,
      headers,
      body: (async function* () {
        yield Buffer.from(body);
      })(),
      close: () => {},
    };
  };
  return { requests, transport };
}

describe('readCalendarLink', () => {
  it('reads the whole feed, marks the person and returns a plain cursor', async () => {
    const lastModified = 'Tue, 27 Oct 2026 08:00:00 GMT';
    const { requests, transport } = server([
      200,
      {
        'content-type': 'text/calendar; charset=utf-8',
        etag: '"v1"',
        'last-modified': lastModified,
      },
      feed(...event('visit-1@example.com', '20261027T140000Z')),
    ]);
    const read = await readCalendarLink(LINK, undefined, {
      ownAddresses: [' avery.lin@EXAMPLE.com '],
      resolve,
      transport,
    });
    expect(requests[0]!.url.protocol).toBe('https:');
    if (read.status !== 'ok') throw new Error('Expected a feed');
    expect(read.calendar).toEqual({ name: 'Care Team Demo', timeZone: 'America/New_York' });
    expect(read.cursor).toEqual({ etag: '"v1"', lastModified });
    expect(read.complete).toBe(true);
    expect(read.warnings).toEqual([]);
    expect(read.events.map((e) => e.uid)).toEqual(['visit-1@example.com']);
    expect(read.events[0]!.attendees!.map((a) => [a.email.toLowerCase(), a.self])).toEqual([
      ['avery.lin@example.com', true],
      ['riley.chen@example.org', undefined],
    ]);
  });

  it('sends the cursor back and reports an unchanged feed', async () => {
    const { requests, transport } = server([304], [304, { etag: '"v2"' }]);
    const cursor: LinkCursor = { etag: '"v1"', lastModified: 'Tue, 27 Oct 2026 08:00:00 GMT' };
    const options = { ownAddresses: [], resolve, transport };
    expect(await readCalendarLink(LINK, cursor, options)).toEqual({
      status: 'not-modified',
      cursor,
    });
    expect(requests[0]!.headers['if-none-match']).toBe('"v1"');
    expect(requests[0]!.headers['if-modified-since']).toBe(cursor.lastModified);
    const again = await readCalendarLink(LINK, cursor, options);
    expect(again).toEqual({ status: 'not-modified', cursor: { ...cursor, etag: '"v2"' } });
  });

  it('uses only string validators from a stored cursor', async () => {
    const { requests, transport } = server([200, {}, feed()]);
    const stored = { etag: 5, lastModified: '', timeoutMs: 1 } as unknown as LinkCursor;
    const read = await readCalendarLink(LINK, stored, { resolve, transport });
    expect(read).toMatchObject({ status: 'ok', cursor: {}, complete: true });
    expect(requests[0]!.headers['if-none-match']).toBeUndefined();
    expect(requests[0]!.headers['if-modified-since']).toBeUndefined();
  });

  it('marks a feed that was cut off as incomplete, keeping what came', async () => {
    const whole = feed(...event('visit-1@example.com', '20261027T140000Z'));
    const cut = whole.slice(0, whole.indexOf('END:VCALENDAR'));
    const { transport } = server([200, {}, cut]);
    const read = await readCalendarLink(LINK, undefined, { resolve, transport });
    expect(read).toMatchObject({ status: 'ok', complete: false });
    if (read.status === 'ok') expect(read.events).toHaveLength(1);
  });

  it('leaves out events that cannot touch the window', async () => {
    const { transport } = server([
      200,
      {},
      feed(
        ...event('old@example.com', '20200105T140000Z'),
        ...event('new@example.com', '20261105T140000Z'),
      ),
    ]);
    const window = {
      start: new Date('2026-05-01T00:00:00Z'),
      end: new Date('2027-11-01T00:00:00Z'),
    };
    const read = await readCalendarLink(LINK, undefined, { window, resolve, transport });
    if (read.status !== 'ok') throw new Error('Expected a feed');
    expect(read.events.map((e) => e.uid)).toEqual(['new@example.com']);
  });

  it('throws safe errors for a failed fetch or a page that is not a calendar', async () => {
    const missing = server([404]);
    const error = await readCalendarLink(LINK, undefined, {
      resolve,
      transport: missing.transport,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FetchLinkError);
    expect((error as FetchLinkError).message).not.toContain('fictional-token');
    const page = server([200, { 'content-type': 'text/html' }, '<!doctype html><p>Sign in</p>']);
    const notCalendar = await readCalendarLink(LINK, undefined, {
      resolve,
      transport: page.transport,
    }).catch((e: unknown) => e);
    expect(notCalendar).toBeInstanceOf(IcalParseError);
    expect((notCalendar as IcalParseError).code).toBe('not-calendar');
  });

  it('passes test origins through to the fetcher', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const { requests, transport } = server([200, {}, feed()]);
      const read = await readCalendarLink('http://127.0.0.1:4599/family.ics', undefined, {
        allowLocalOrigins: ['http://127.0.0.1:4599'],
        transport,
      });
      expect(read.status).toBe('ok');
      expect(requests[0]!.addresses).toEqual([{ address: '127.0.0.1', family: 4 }]);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
