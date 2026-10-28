import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchLinkError } from './fetch-link';
import type { Resolver, Transport, TransportRequest } from './fetch-link';
import { IcalParseError } from './ical/parse';
import { linkHost, MAX_LINK_READS, readCalendarLink } from './link-reader';
import type { ReadLinkOptions } from './link-reader';

// The reader's worker runs as plain JavaScript, so it's built here the way build.mjs builds it.
let dir = '';
let workerFile = new URL('file:///');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'carehub-link-reader-'));
  const outfile = join(dir, 'calendar-parse-worker.js');
  await build({
    entryPoints: [fileURLToPath(new URL('./ical/parse-worker.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'silent',
  });
  workerFile = pathToFileURL(outfile);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

const LINK = 'webcal://calendar.example.com/feeds/avery.ics?token=fictional-token';
const NOW = new Date('2026-10-27T12:00:00Z');

const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];

function feed(...events: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Care Hub tests//EN',
    'X-WR-CALNAME:Care Team Demo',
    'X-WR-TIMEZONE:America/New_York',
    'COLOR:teal',
    ...events.flat(),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

const visit = (uid: string, start: string, ...lines: string[]) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  `DTSTART:${start}`,
  'SUMMARY:Visit with Jordan Patel',
  ...lines,
  'END:VEVENT',
];

/** Answers every request with this status, headers and body, and keeps the requests. */
function server(status: number, headers: Record<string, string> = {}, body = '') {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    return {
      status,
      headers,
      body: (async function* () {
        yield Buffer.from(body);
      })(),
      close: () => undefined,
    };
  };
  return { requests, transport };
}

const options = (more: ReadLinkOptions): ReadLinkOptions => ({
  resolve,
  workerFile,
  now: NOW,
  ...more,
});

describe('readCalendarLink', () => {
  it("reads a feed's events, name, time zone and validators", async () => {
    const { requests, transport } = server(
      200,
      {
        'content-type': 'text/calendar; charset=utf-8',
        etag: '"v2"',
        'last-modified': 'Tue, 27 Oct 2026 10:00:00 GMT',
      },
      feed(
        visit(
          'visit-1@example.com',
          '20261028T140000Z',
          'ATTENDEE;CN=Avery Lin;PARTSTAT=ACCEPTED:mailto:Avery.Lin@example.com',
          'ATTENDEE;CN=Sam Ortiz:mailto:sam.ortiz@example.org',
        ),
      ),
    );
    const read = await readCalendarLink(
      LINK,
      undefined,
      options({ transport, ownAddresses: ['avery.lin@example.com'] }),
    );
    expect(requests[0]?.url.href).toBe(
      'https://calendar.example.com/feeds/avery.ics?token=fictional-token',
    );
    expect(read).toEqual({
      status: 'ok',
      events: [
        {
          uid: 'visit-1@example.com',
          status: 'confirmed',
          title: 'Visit with Jordan Patel',
          start: { kind: 'utc', instant: '2026-10-28T14:00:00.000Z' },
          end: { kind: 'utc', instant: '2026-10-28T14:00:00.000Z' },
          busy: true,
          attendees: [
            {
              email: 'Avery.Lin@example.com',
              name: 'Avery Lin',
              response: 'accepted',
              self: true,
            },
            { email: 'sam.ortiz@example.org', name: 'Sam Ortiz', response: 'needs-action' },
          ],
        },
      ],
      calendar: { name: 'Care Team Demo', timeZone: 'America/New_York' },
      cursor: { etag: '"v2"', lastModified: 'Tue, 27 Oct 2026 10:00:00 GMT' },
      complete: true,
      warnings: [],
    });
  });

  it('sends the saved validators, and keeps them when the feed is unchanged', async () => {
    const { requests, transport } = server(304, { etag: '"v3"' });
    const read = await readCalendarLink(
      LINK,
      { etag: '"v2"', lastModified: 'Tue, 27 Oct 2026 10:00:00 GMT' },
      options({ transport }),
    );
    expect(requests[0]?.headers).toMatchObject({
      'if-none-match': '"v2"',
      'if-modified-since': 'Tue, 27 Oct 2026 10:00:00 GMT',
    });
    expect(read).toEqual({
      status: 'not-modified',
      cursor: { etag: '"v3"', lastModified: 'Tue, 27 Oct 2026 10:00:00 GMT' },
    });
  });

  it('uses only string validators from a saved cursor', async () => {
    const { requests, transport } = server(200, {}, feed());
    const saved = JSON.parse('{"etag":{"x":1},"lastModified":42,"timeoutMs":1}') as object;
    const read = await readCalendarLink(LINK, saved, options({ transport }));
    expect(requests[0]?.headers['if-none-match']).toBeUndefined();
    expect(requests[0]?.headers['if-modified-since']).toBeUndefined();
    expect(read.cursor).toEqual({});
  });

  it('leaves out events that cannot touch the window', async () => {
    const { transport } = server(
      200,
      {},
      feed(
        visit('soon@example.com', '20261028T140000Z'),
        visit('next-year@example.com', '20271028T140000Z'),
      ),
    );
    const read = await readCalendarLink(
      LINK,
      undefined,
      options({
        transport,
        window: { start: new Date('2026-10-26T00:00:00Z'), end: new Date('2026-12-07T00:00:00Z') },
      }),
    );
    expect(read.status === 'ok' && read.events.map((e) => e.uid)).toEqual(['soon@example.com']);
  });

  it('says a feed is incomplete when it stops early or has more than the reader keeps', async () => {
    const cut = feed(visit('visit-1@example.com', '20261028T140000Z')).replace(
      /END:VCALENDAR\r\n$/,
      '',
    );
    const many = feed(
      ...Array.from({ length: 5001 }, (_, i) =>
        visit(`visit-${i}@example.com`, '20261028T140000Z'),
      ),
    );
    const results = [];
    for (const body of [cut, many]) {
      const { transport } = server(200, {}, body);
      results.push(await readCalendarLink(LINK, undefined, options({ transport })));
    }
    expect(results.map((r) => r.status === 'ok' && r.complete)).toEqual([false, false]);
    expect(results.map((r) => r.status === 'ok' && r.events.length)).toEqual([1, 5000]);
  });

  it('passes on fetch and reader errors', async () => {
    const missing = server(404);
    const fetchError = await readCalendarLink(
      LINK,
      undefined,
      options({ transport: missing.transport }),
    ).catch((e: unknown) => e);
    expect(fetchError).toBeInstanceOf(FetchLinkError);
    expect((fetchError as FetchLinkError).message).not.toContain('fictional-token');
    const page = server(200, { 'content-type': 'text/html' }, '<!doctype html><p>Sign in</p>');
    const readError = await readCalendarLink(
      LINK,
      undefined,
      options({ transport: page.transport }),
    ).catch((e: unknown) => e);
    expect(readError).toBeInstanceOf(IcalParseError);
    expect((readError as IcalParseError).code).toBe('not-calendar');
  });

  it('refuses links fetchCalendarLink refuses', async () => {
    const { requests, transport } = server(200, {}, feed());
    for (const link of ['http://calendar.example.com/a.ics', 'https://10.0.0.5/a.ics']) {
      const error = await readCalendarLink(link, undefined, options({ transport })).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(FetchLinkError);
    }
    expect(requests).toHaveLength(0);
  });

  it('reads http links to test origins only when it gets them', async () => {
    const { requests, transport } = server(
      200,
      { 'content-type': 'text/calendar; charset=utf-8' },
      feed(visit('visit-9@example.com', '20261028T140000Z')),
    );
    const loopback: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    const link = 'http://127.0.0.1:4598/avery.ics';
    const testOrigins = ['http://127.0.0.1:4598'];
    const read = await readCalendarLink(
      link,
      undefined,
      options({ transport, resolve: loopback, testOrigins }),
    );
    expect(read).toMatchObject({ status: 'ok', events: [{ uid: 'visit-9@example.com' }] });
    const error = await readCalendarLink(
      link,
      undefined,
      options({ transport, resolve: loopback }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FetchLinkError);
    expect(error).toMatchObject({ code: 'invalid-link' });
    expect(requests).toHaveLength(1);
  });

  it('reads at most four links at once; a read cancelled while it waits never starts', async () => {
    const waiting: (() => void)[] = [];
    let calls = 0;
    let fetching = 0;
    let most = 0;
    const transport: Transport = async () => {
      calls++;
      fetching++;
      most = Math.max(most, fetching);
      await new Promise<void>((done) => waiting.push(done));
      fetching--;
      return {
        status: 200,
        headers: {},
        body: (async function* () {
          yield Buffer.from(feed());
        })(),
        close: () => undefined,
      };
    };
    const tick = () => new Promise((done) => setTimeout(done, 10));
    const first = Array.from({ length: 5 }, () =>
      readCalendarLink(LINK, undefined, options({ transport })),
    );
    const controller = new AbortController();
    const cancelled = readCalendarLink(
      LINK,
      undefined,
      options({ transport, signal: controller.signal }),
    ).catch((e: unknown) => e);
    // Lets every fetch answer until all five reads are done, even if a check fails.
    const finish = async () => {
      let settled = false;
      const all = Promise.allSettled(first).finally(() => {
        settled = true;
      });
      while (!settled) {
        for (const done of waiting.splice(0)) done();
        await tick();
      }
      return all;
    };
    try {
      await tick();
      expect(MAX_LINK_READS).toBe(4);
      expect(fetching).toBe(4);
      const reason = new Error('The sync stopped.');
      controller.abort(reason);
      const late = new Promise((done) => setTimeout(() => done('still waiting'), 500));
      expect(await Promise.race([cancelled, late])).toBe(reason);
    } finally {
      const reads = await finish();
      expect(reads.map((r) => r.status === 'fulfilled' && r.value.status)).toEqual([
        'ok',
        'ok',
        'ok',
        'ok',
        'ok',
      ]);
    }
    expect(most).toBe(4);
    expect(calls).toBe(5);
  });

  it('can be cancelled while it reads', async () => {
    const controller = new AbortController();
    const transport: Transport = ({ signal }) => {
      setTimeout(() => controller.abort(), 5);
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    };
    const error = await readCalendarLink(
      LINK,
      undefined,
      options({ transport, signal: controller.signal }),
    ).catch((e: unknown) => e);
    expect((error as FetchLinkError).code).toBe('aborted');
  });
});

describe('linkHost', () => {
  it("gives a link's host without its path or secret", () => {
    expect(linkHost(LINK)).toBe('calendar.example.com');
    expect(linkHost(' https://Calendar.Example.org:8443/a.ics?token=x ')).toBe(
      'calendar.example.org',
    );
    expect(linkHost('webcals://calendar.example.net/b.ics')).toBe('calendar.example.net');
    expect(linkHost('http://127.0.0.1:4598/c.ics')).toBe('127.0.0.1');
  });

  it('gives nothing for anything else', () => {
    for (const link of [
      '',
      'calendar.example.com/a.ics',
      'ftp://example.com/a.ics',
      'mailto:a@example.com',
    ]) {
      expect(linkHost(link)).toBeUndefined();
    }
  });
});
