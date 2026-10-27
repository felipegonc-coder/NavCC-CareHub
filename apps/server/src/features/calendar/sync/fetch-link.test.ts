import type { IncomingHttpHeaders } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createTransport,
  fetchCalendarLink,
  FetchLinkError,
  pinnedLookup,
  testCalendarOrigins,
  toHttpsUrl,
} from './fetch-link';
import type {
  FetchLinkOptions,
  ResolvedAddress,
  Resolver,
  Transport,
  TransportRequest,
  TransportResponse,
} from './fetch-link';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const LINK = 'https://calendar.example.com/feeds/avery.ics?token=fictional-token';

const DNS: Record<string, string[]> = {
  'calendar.example.com': ['93.184.216.34'],
  'mirror.example.org': ['2606:2800:220:1:248:1893:25c8:1946'],
  'internal.example.net': ['10.0.0.5'],
  'metadata.example.net': ['169.254.169.254'],
  'mixed.example.net': ['93.184.216.34', '127.0.0.1'],
  'nothing.example.net': [],
};

function resolver(lookups: string[] = []): Resolver {
  return async (hostname) => {
    lookups.push(hostname);
    const list = DNS[hostname];
    if (!list)
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

function reply(
  status: number,
  headers: IncomingHttpHeaders = {},
  body: string | Uint8Array[] = '',
): TransportResponse & { closed: () => boolean } {
  const chunks = typeof body === 'string' ? [Buffer.from(body)] : body;
  let closed = false;
  return {
    status,
    headers,
    body: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    close: () => {
      closed = true;
    },
    closed: () => closed,
  };
}

function server(...responses: ((request: TransportRequest) => TransportResponse)[]) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    const respond = responses[Math.min(requests.length, responses.length) - 1];
    if (!respond) throw new Error('No response');
    return respond(request);
  };
  return { requests, transport };
}

async function failure(link: string, options: FetchLinkOptions): Promise<FetchLinkError> {
  try {
    await fetchCalendarLink(link, options);
  } catch (error) {
    if (error instanceof FetchLinkError) return error;
    throw error;
  }
  throw new Error('Expected the fetch to fail');
}

const text = (body: Uint8Array) => Buffer.from(body).toString('utf8');

describe('fetchCalendarLink', () => {
  it('fetches the calendar, reading webcal:// as https://', async () => {
    const { requests, transport } = server(() =>
      reply(
        200,
        {
          'content-type': 'text/calendar; charset=utf-8',
          etag: '"v1"',
          'last-modified': 'Tue, 27 Oct 2026 16:00:00 GMT',
        },
        ICS,
      ),
    );
    const result = await fetchCalendarLink(LINK.replace('https://', 'webcal://'), {
      resolve: resolver(),
      transport,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(text(result.body)).toBe(ICS);
    expect(result.charset).toBe('utf-8');
    expect(result.etag).toBe('"v1"');
    expect(result.lastModified).toBe('Tue, 27 Oct 2026 16:00:00 GMT');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.href).toBe(LINK);
    expect(requests[0]?.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(requests[0]?.headers).toMatchObject({
      accept: 'text/calendar, */*;q=0.5',
      'accept-encoding': 'gzip',
    });
  });

  it('accepts only https:// and webcal:// links', async () => {
    const lookups: string[] = [];
    const { requests, transport } = server(() => reply(200, {}, ICS));
    for (const link of [
      'http://calendar.example.com/a.ics',
      'ftp://calendar.example.com/a.ics',
      'file:///etc/hosts',
      'calendar.example.com/a.ics',
      'not a link',
    ]) {
      const error = await failure(link, { resolve: resolver(lookups), transport });
      expect(error.code).toBe('invalid-link');
      expect(error.retryable).toBe(false);
    }
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('refuses hosts that resolve to private or local addresses', async () => {
    const lookups: string[] = [];
    const { requests, transport } = server(() => reply(200, {}, ICS));
    for (const host of ['internal.example.net', 'metadata.example.net', 'mixed.example.net']) {
      const error = await failure(`https://${host}/a.ics`, {
        resolve: resolver(lookups),
        transport,
      });
      expect(error.code).toBe('blocked-address');
    }
    for (const host of ['127.0.0.1', '[::1]', '[::ffff:a9fe:a9fe]', '0x7f000001', '10.0.0.5']) {
      const error = await failure(`https://${host}/a.ics`, {
        resolve: resolver(lookups),
        transport,
      });
      expect(error.code).toBe('blocked-address');
    }
    expect(lookups).toEqual(['internal.example.net', 'metadata.example.net', 'mixed.example.net']);
    expect(requests).toEqual([]);
  });

  it('connects to a public IP address in the link without a lookup', async () => {
    const lookups: string[] = [];
    const { requests, transport } = server(() => reply(200, {}, ICS));
    await fetchCalendarLink('https://93.184.216.34/a.ics', {
      resolve: resolver(lookups),
      transport,
    });
    expect(lookups).toEqual([]);
    expect(requests[0]?.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('reports lookups that fail or find nothing', async () => {
    const { transport } = server(() => reply(200, {}, ICS));
    for (const host of ['unknown.example.net', 'nothing.example.net']) {
      const error = await failure(`https://${host}/a.ics`, { resolve: resolver(), transport });
      expect(error.code).toBe('dns');
      expect(error.retryable).toBe(true);
    }
  });

  it('follows up to three redirects, checking every host again', async () => {
    const lookups: string[] = [];
    const { requests, transport } = server(
      () => reply(301, { location: 'https://mirror.example.org/a.ics' }),
      () => reply(302, { location: '/b.ics' }),
      () => reply(307, { location: 'https://calendar.example.com/c.ics' }),
      () => reply(200, {}, ICS),
    );
    const result = await fetchCalendarLink(LINK, { resolve: resolver(lookups), transport });
    expect(result.status).toBe('ok');
    expect(requests.map((r) => r.url.href)).toEqual([
      LINK,
      'https://mirror.example.org/a.ics',
      'https://mirror.example.org/b.ics',
      'https://calendar.example.com/c.ics',
    ]);
    expect(lookups).toEqual([
      'calendar.example.com',
      'mirror.example.org',
      'mirror.example.org',
      'calendar.example.com',
    ]);
    expect(requests[1]?.addresses).toEqual([
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
  });

  it('stops after three redirects', async () => {
    const { requests, transport } = server(() =>
      reply(302, { location: 'https://calendar.example.com/again.ics' }),
    );
    const error = await failure(LINK, { resolve: resolver(), transport });
    expect(error.code).toBe('too-many-redirects');
    expect(requests).toHaveLength(4);
  });

  it('refuses redirects to private addresses, to http or without a location', async () => {
    const cases: [IncomingHttpHeaders, string][] = [
      [{ location: 'https://metadata.example.net/latest' }, 'blocked-address'],
      [{ location: 'https://127.0.0.1/a.ics' }, 'blocked-address'],
      [{ location: 'http://calendar.example.com/a.ics' }, 'invalid-link'],
      [{}, 'invalid-link'],
    ];
    for (const [headers, code] of cases) {
      const { requests, transport } = server(() => reply(302, headers));
      const error = await failure(LINK, { resolve: resolver(), transport });
      expect(error.code).toBe(code);
      expect(requests).toHaveLength(1);
    }
  });

  it('sends credentials from the link only to its own origin', async () => {
    const { requests, transport } = server(
      () => reply(302, { location: '/moved.ics' }),
      () => reply(302, { location: 'https://mirror.example.org/a.ics' }),
      () => reply(200, {}, ICS),
    );
    await fetchCalendarLink('https://avery:fictional@calendar.example.com/a.ics', {
      resolve: resolver(),
      transport,
    });
    const basic = `Basic ${Buffer.from('avery:fictional').toString('base64')}`;
    expect(requests.map((r) => r.headers.authorization)).toEqual([basic, basic, undefined]);
    expect(requests.every((r) => r.url.username === '' && r.url.password === '')).toBe(true);
  });

  it('sends validators and reports an unchanged calendar', async () => {
    const response = reply(304, { etag: '"v1"' });
    const { requests, transport } = server(() => response);
    const result = await fetchCalendarLink(LINK, {
      etag: '"v1"',
      lastModified: 'Tue, 27 Oct 2026 16:00:00 GMT',
      resolve: resolver(),
      transport,
    });
    expect(result).toEqual({ status: 'not-modified', etag: '"v1"' });
    expect(requests[0]?.headers).toMatchObject({
      'if-none-match': '"v1"',
      'if-modified-since': 'Tue, 27 Oct 2026 16:00:00 GMT',
    });
    expect(response.closed()).toBe(true);
  });

  it('reports HTTP errors in plain words, without the link', async () => {
    const cases: [number, boolean, RegExp][] = [
      [401, false, /refused this link/],
      [403, false, /refused this link/],
      [404, false, /no calendar at this link/],
      [410, false, /no calendar at this link/],
      [429, true, /error 429/],
      [500, true, /error 500/],
      [503, true, /error 503/],
    ];
    for (const [status, retryable, message] of cases) {
      const response = reply(status, {}, 'Not here');
      const { transport } = server(() => response);
      const error = await failure(LINK, { resolve: resolver(), transport });
      expect(error.code).toBe('http');
      expect(error.httpStatus).toBe(status);
      expect(error.retryable).toBe(retryable);
      expect(error.message).toMatch(message);
      expect(error.message).not.toMatch(/example\.com|token|avery/);
      expect(response.closed()).toBe(true);
    }
  });

  it('refuses calendars over the size limit', async () => {
    const declared = reply(200, { 'content-length': '2000' }, ICS);
    const first = server(() => declared);
    const error = await failure(LINK, {
      maxBytes: 1000,
      resolve: resolver(),
      transport: first.transport,
    });
    expect(error.code).toBe('too-large');
    expect(declared.closed()).toBe(true);
    const chunk = Buffer.alloc(400, 0x41);
    const streamed = server(() => reply(200, {}, [chunk, chunk, chunk]));
    expect(
      (await failure(LINK, { maxBytes: 1000, resolve: resolver(), transport: streamed.transport }))
        .code,
    ).toBe('too-large');
  });

  it('decompresses gzip, applying the limit to the decompressed size', async () => {
    const zipped = server(() => reply(200, { 'content-encoding': 'gzip' }, [gzipSync(ICS)]));
    const result = await fetchCalendarLink(LINK, {
      resolve: resolver(),
      transport: zipped.transport,
    });
    expect(result.status === 'ok' && text(result.body)).toBe(ICS);
    const bomb = server(() =>
      reply(200, { 'content-encoding': 'gzip' }, [gzipSync(Buffer.alloc(200_000))]),
    );
    const error = await failure(LINK, {
      maxBytes: 100_000,
      resolve: resolver(),
      transport: bomb.transport,
    });
    expect(error.code).toBe('too-large');
    const brotli = server(() => reply(200, { 'content-encoding': 'br' }, ICS));
    expect((await failure(LINK, { resolve: resolver(), transport: brotli.transport })).code).toBe(
      'network',
    );
  });

  it('times out, also while the body is arriving', async () => {
    const hanging: Transport = ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const error = await failure(LINK, { timeoutMs: 30, resolve: resolver(), transport: hanging });
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(true);
    const stalled: Transport = async ({ signal }) => ({
      status: 200,
      headers: {},
      close: () => undefined,
      body: (async function* () {
        yield Buffer.from('BEGIN:VCALENDAR\r\n');
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        );
      })(),
    });
    expect(
      (await failure(LINK, { timeoutMs: 30, resolve: resolver(), transport: stalled })).code,
    ).toBe('timeout');
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const hanging: Transport = ({ signal }) => {
      setTimeout(() => controller.abort(), 5);
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    };
    const error = await failure(LINK, {
      signal: controller.signal,
      resolve: resolver(),
      transport: hanging,
    });
    expect(error.code).toBe('aborted');
    const done = new AbortController();
    done.abort();
    expect(
      (await failure(LINK, { signal: done.signal, resolve: resolver(), transport: hanging })).code,
    ).toBe('aborted');
  });

  it('reports connection failures without their details', async () => {
    const broken: Transport = async () => {
      throw new Error('connect ECONNREFUSED 93.184.216.34:443');
    };
    const error = await failure(LINK, { resolve: resolver(), transport: broken });
    expect(error.code).toBe('network');
    expect(error.message).not.toMatch(/93\.184|ECONNREFUSED/);
  });
});

describe('toHttpsUrl', () => {
  it('reads webcal links as https and drops the fragment', () => {
    expect(toHttpsUrl(' webcals://calendar.example.com/a.ics#top ').href).toBe(
      'https://calendar.example.com/a.ics',
    );
    expect(toHttpsUrl('WEBCAL://calendar.example.com/a.ics').protocol).toBe('https:');
  });
});

describe('pinnedLookup', () => {
  const addresses: ResolvedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ];
  const lookup = (options: object, list = addresses) =>
    new Promise<unknown[]>((resolve) =>
      pinnedLookup(list)('calendar.example.com', options, (...args: unknown[]) => resolve(args)),
    );

  it('answers only with the checked addresses', async () => {
    expect(await lookup({})).toEqual([null, '93.184.216.34', 4]);
    expect(await lookup({ family: 6 })).toEqual([null, '2606:2800:220:1:248:1893:25c8:1946', 6]);
    expect(await lookup({ all: true })).toEqual([null, addresses]);
    const [error] = await lookup({ family: 6 }, [addresses[0]!]);
    expect((error as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });
});

describe('createTransport', () => {
  it('connects to the pinned address and keeps the host name', async () => {
    const seen: { host?: string; path?: string; agent?: string }[] = [];
    const local = createServer((req, res) => {
      seen.push({ host: req.headers.host, path: req.url, agent: req.headers['user-agent'] });
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(ICS);
    });
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    const { port } = local.address() as AddressInfo;
    try {
      const response = await createTransport(httpRequest)({
        url: new URL(`http://calendar.example.com:${port}/feeds/avery.ics?view=week`),
        addresses: [{ address: '127.0.0.1', family: 4 }],
        headers: { 'user-agent': 'CareHub-Calendar/test' },
        signal: new AbortController().signal,
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) chunks.push(chunk);
      expect(response.status).toBe(200);
      expect(Buffer.concat(chunks).toString()).toBe(ICS);
      expect(seen).toEqual([
        {
          host: `calendar.example.com:${port}`,
          path: '/feeds/avery.ics?view=week',
          agent: 'CareHub-Calendar/test',
        },
      ]);
    } finally {
      local.close();
    }
  });
});

describe('test origins (browser tests only)', () => {
  const ORIGIN = 'http://127.0.0.1:4599';
  const FEED = `${ORIGIN}/family.ics`;
  const WARNING = 'CAREHUB_TEST_CALENDAR_ORIGINS is ignored outside test and development.';

  async function withNodeEnv(value: string | undefined, run: () => Promise<void>) {
    const saved = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    try {
      await run();
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  }

  it('refuses 127.0.0.1 without the option', () =>
    withNodeEnv('test', async () => {
      const { requests, transport } = server(() => reply(200, {}, ICS));
      expect((await failure(FEED, { transport })).code).toBe('invalid-link');
      const https = await failure('https://127.0.0.1:4599/family.ics', { transport });
      expect(https.code).toBe('blocked-address');
      expect(requests).toHaveLength(0);
    }));

  it('lets through only the exact listed origin, skipping only the address check', () =>
    withNodeEnv('test', async () => {
      const { requests, transport } = server(() => reply(200, {}, ICS));
      const allowLocalOrigins = [ORIGIN, 'https://[::1]:4600'];
      expect((await fetchCalendarLink(FEED, { allowLocalOrigins, transport })).status).toBe('ok');
      const v6 = await fetchCalendarLink('https://[::1]:4600/a.ics', {
        allowLocalOrigins,
        transport,
      });
      expect(v6.status).toBe('ok');
      expect(requests.map((r) => r.addresses)).toEqual([
        [{ address: '127.0.0.1', family: 4 }],
        [{ address: '::1', family: 6 }],
      ]);
      const others: [string, string][] = [
        ['http://127.0.0.1:4600/family.ics', 'invalid-link'],
        ['http://127.0.0.2:4599/family.ics', 'invalid-link'],
        ['http://localhost:4599/family.ics', 'invalid-link'],
        ['https://127.0.0.1:4599/family.ics', 'blocked-address'],
        ['webcal://127.0.0.1:4599/family.ics', 'blocked-address'],
        ['http://[::1]:4600/a.ics', 'invalid-link'],
      ];
      for (const [link, code] of others) {
        const error = await failure(link, { allowLocalOrigins, resolve: resolver(), transport });
        expect(error.code).toBe(code);
      }
      expect(requests).toHaveLength(2);
    }));

  it('checks every redirect from a listed origin again', () =>
    withNodeEnv('test', async () => {
      const cases: [string, string][] = [
        ['http://10.0.0.5/a.ics', 'invalid-link'],
        ['https://internal.example.net/a.ics', 'blocked-address'],
        ['http://127.0.0.1:4600/a.ics', 'invalid-link'],
        ['https://127.0.0.1:4600/a.ics', 'blocked-address'],
      ];
      for (const [location, code] of cases) {
        const { requests, transport } = server(() => reply(302, { location }));
        const options = { allowLocalOrigins: [ORIGIN], resolve: resolver(), transport };
        expect((await failure(FEED, options)).code).toBe(code);
        expect(requests).toHaveLength(1);
      }
      const moved = server(
        () => reply(302, { location: '/moved.ics' }),
        () => reply(200, {}, ICS),
      );
      await fetchCalendarLink(FEED, { allowLocalOrigins: [ORIGIN], transport: moved.transport });
      expect(moved.requests.map((r) => r.url.href)).toEqual([FEED, `${ORIGIN}/moved.ics`]);
    }));

  it('keeps the size limit and the timeout for a listed origin', () =>
    withNodeEnv('development', async () => {
      const allowLocalOrigins = [ORIGIN];
      const big = server(() => reply(200, { 'content-length': '2000' }, ICS));
      const tooLarge = await failure(FEED, {
        allowLocalOrigins,
        maxBytes: 1000,
        transport: big.transport,
      });
      expect(tooLarge.code).toBe('too-large');
      const silent: Transport = ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        });
      const late = await failure(FEED, { allowLocalOrigins, timeoutMs: 20, transport: silent });
      expect(late.code).toBe('timeout');
    }));

  it('accepts only exact loopback origins with a port', () =>
    withNodeEnv('test', async () => {
      const bad = [
        'http://127.0.0.1',
        'http://127.0.0.1:80',
        'http://127.0.0.1:4599/',
        'http://localhost:4599',
        'http://10.0.0.5:4599',
        'http://192.168.1.20:4599',
        'ftp://127.0.0.1:4599',
        'http://avery@127.0.0.1:4599',
      ];
      for (const entry of bad) {
        await expect(fetchCalendarLink(FEED, { allowLocalOrigins: [entry] })).rejects.toThrow(
          TypeError,
        );
        expect(() => testCalendarOrigins(entry, 'test', () => {})).toThrow(TypeError);
      }
      const list = ` ${ORIGIN}, http://[::1]:4600 ,`;
      expect(testCalendarOrigins(list, 'test', () => {})).toEqual([ORIGIN, 'http://[::1]:4600']);
    }));

  it('is ignored in production, with a warning', () =>
    withNodeEnv('production', async () => {
      const { requests, transport } = server(() => reply(200, {}, ICS));
      const allowLocalOrigins = [ORIGIN, 'https://127.0.0.1:4600'];
      expect((await failure(FEED, { allowLocalOrigins, transport })).code).toBe('invalid-link');
      const https = await failure('https://127.0.0.1:4600/a.ics', { allowLocalOrigins, transport });
      expect(https.code).toBe('blocked-address');
      expect(requests).toHaveLength(0);
      for (const nodeEnv of ['production', undefined, 'staging']) {
        const warnings: string[] = [];
        expect(testCalendarOrigins(ORIGIN, nodeEnv, (m) => warnings.push(m))).toEqual([]);
        expect(warnings).toEqual([WARNING]);
      }
      const quiet: string[] = [];
      expect(testCalendarOrigins(undefined, 'production', (m) => quiet.push(m))).toEqual([]);
      expect(quiet).toEqual([]);
    }));
});
