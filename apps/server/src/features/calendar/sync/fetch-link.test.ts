import type {
  IncomingHttpHeaders,
  IncomingMessage,
  RequestListener,
  RequestOptions,
} from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createTransport,
  fetchCalendarLink,
  FetchLinkError,
  LINK_MAX_HEADER_BYTES,
  pinnedLookup,
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

  it('refuses redirects to private addresses, to http, with credentials or without a location', async () => {
    const unusable = "The link redirected to an address Care Hub can't use.";
    const cases: [IncomingHttpHeaders, string, string?][] = [
      [{ location: 'https://metadata.example.net/latest' }, 'blocked-address'],
      [{ location: 'https://127.0.0.1/a.ics' }, 'blocked-address'],
      [{ location: 'http://calendar.example.com/a.ics' }, 'invalid-link', unusable],
      [{ location: 'https://avery:fictional@mirror.example.org/a.ics' }, 'invalid-link', unusable],
      [{ location: 'https://avery@mirror.example.org/a.ics' }, 'invalid-link', unusable],
      [{}, 'invalid-link', unusable],
    ];
    for (const [headers, code, message] of cases) {
      const lookups: string[] = [];
      const { requests, transport } = server(() => reply(302, headers));
      const error = await failure(LINK, { resolve: resolver(lookups), transport });
      expect(error.code).toBe(code);
      if (message) expect(error.message).toBe(message);
      expect(requests).toHaveLength(1);
      if (code === 'invalid-link') expect(lookups).toEqual(['calendar.example.com']);
    }
  });

  it('refuses links with a user name and password', async () => {
    const lookups: string[] = [];
    const { requests, transport } = server(() => reply(200, {}, ICS));
    for (const link of [
      'https://avery:fictional@calendar.example.com/a.ics',
      'webcal://avery@calendar.example.com/a.ics',
      'https://:fictional@calendar.example.com/a.ics',
    ]) {
      const error = await failure(link, { resolve: resolver(lookups), transport });
      expect(error.code).toBe('invalid-link');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe(
        "Links with a user name and password aren't supported. Use the calendar's private link, which has its secret in the address.",
      );
    }
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
    expect(requests.every((r) => !('authorization' in r.headers))).toBe(true);
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

describe('fetchCalendarLink with test origins', () => {
  const testOrigins = ['http://127.0.0.1:4598', 'http://localhost:4597'];
  const local: Resolver = async (hostname) =>
    hostname === 'localhost'
      ? [
          { address: '::1', family: 6 },
          { address: '127.0.0.1', family: 4 },
        ]
      : resolver()(hostname);

  it('lets links to exactly these origins use http and loopback addresses', async () => {
    const { requests, transport } = server(() => reply(200, {}, ICS));
    for (const link of ['http://127.0.0.1:4598/avery.ics', 'http://localhost:4597/sam.ics']) {
      const result = await fetchCalendarLink(link, { testOrigins, resolve: local, transport });
      expect(result.status).toBe('ok');
    }
    expect(requests.map((r) => [r.url.href, r.addresses])).toEqual([
      ['http://127.0.0.1:4598/avery.ics', [{ address: '127.0.0.1', family: 4 }]],
      [
        'http://localhost:4597/sam.ics',
        [
          { address: '::1', family: 6 },
          { address: '127.0.0.1', family: 4 },
        ],
      ],
    ]);
    expect(toHttpsUrl('http://127.0.0.1:4598/a.ics', testOrigins).protocol).toBe('http:');
  });

  it('refuses every other http link or local address, as without them', async () => {
    const elsewhere: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
    const cases: [string, FetchLinkOptions, string][] = [
      ['http://127.0.0.1:4598/a.ics', {}, 'invalid-link'],
      ['http://127.0.0.1:4599/a.ics', { testOrigins }, 'invalid-link'],
      ['http://calendar.example.com/a.ics', { testOrigins }, 'invalid-link'],
      ['https://127.0.0.1:4598/a.ics', { testOrigins }, 'blocked-address'],
      ['webcal://127.0.0.1:4598/a.ics', { testOrigins }, 'blocked-address'],
      ['http://sam:fictional@127.0.0.1:4598/a.ics', { testOrigins }, 'invalid-link'],
      ['http://localhost:4597/a.ics', { testOrigins, resolve: elsewhere }, 'blocked-address'],
      ['http://10.0.0.5:4598/a.ics', { testOrigins: ['http://10.0.0.5:4598'] }, 'invalid-link'],
      [
        'http://calendar.example.com:4598/a.ics',
        { testOrigins: ['http://calendar.example.com:4598'] },
        'invalid-link',
      ],
    ];
    const { requests, transport } = server(() => reply(200, {}, ICS));
    for (const [link, options, code] of cases) {
      const error = await failure(link, { resolve: local, transport, ...options });
      expect([link, error.code]).toEqual([link, code]);
    }
    expect(requests).toEqual([]);
  });

  it('checks redirects to and from them like any other', async () => {
    const followed = server(
      () => reply(302, { location: 'http://127.0.0.1:4598/b.ics' }),
      () => reply(302, { location: '/c.ics' }),
      () => reply(200, {}, ICS),
    );
    await fetchCalendarLink(LINK, { testOrigins, resolve: local, transport: followed.transport });
    expect(followed.requests.map((r) => r.url.href)).toEqual([
      LINK,
      'http://127.0.0.1:4598/b.ics',
      'http://127.0.0.1:4598/c.ics',
    ]);
    for (const [location, code] of [
      ['http://127.0.0.1:4599/a.ics', 'invalid-link'],
      ['http://calendar.example.com/a.ics', 'invalid-link'],
      ['http://sam:fictional@127.0.0.1:4598/a.ics', 'invalid-link'],
      ['https://internal.example.net/a.ics', 'blocked-address'],
    ]) {
      const { requests, transport } = server(() => reply(302, { location }));
      const error = await failure('http://127.0.0.1:4598/a.ics', {
        testOrigins,
        resolve: local,
        transport,
      });
      expect([location, error.code]).toEqual([location, code]);
      expect(requests).toHaveLength(1);
    }
  });

  it('keeps the size and time limits', async () => {
    const link = 'http://127.0.0.1:4598/a.ics';
    const big = server(() => reply(200, {}, [Buffer.alloc(2000, 0x41)]));
    expect(
      (await failure(link, { testOrigins, maxBytes: 1000, transport: big.transport })).code,
    ).toBe('too-large');
    const hanging: Transport = ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    expect((await failure(link, { testOrigins, timeoutMs: 30, transport: hanging })).code).toBe(
      'timeout',
    );
  });

  it('fetches from a stand-in on this computer over plain http', async () => {
    const standIn = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', etag: '"v1"' });
      res.end(ICS);
    });
    await new Promise<void>((resolve) => standIn.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${(standIn.address() as AddressInfo).port}`;
      const result = await fetchCalendarLink(`${origin}/avery.ics`, { testOrigins: [origin] });
      expect(result).toEqual({
        status: 'ok',
        body: Buffer.from(ICS),
        charset: 'utf-8',
        etag: '"v1"',
      });
      expect((await failure(`${origin}/avery.ics`, {})).code).toBe('invalid-link');
    } finally {
      standIn.closeAllConnections();
      await new Promise((resolve) => standIn.close(resolve));
    }
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
  async function withServer(handler: RequestListener, run: (port: number) => Promise<void>) {
    const local = createServer(handler);
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    try {
      await run((local.address() as AddressInfo).port);
    } finally {
      local.closeAllConnections();
      await new Promise((resolve) => local.close(resolve));
    }
  }

  const signal = new AbortController().signal;
  const caught = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (error: unknown) => error,
    );

  it('connects to the pinned address and keeps the host name', async () => {
    const seen: { host?: string; path?: string; agent?: string }[] = [];
    const handler: RequestListener = (req, res) => {
      seen.push({ host: req.headers.host, path: req.url, agent: req.headers['user-agent'] });
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(ICS);
    };
    await withServer(handler, async (port) => {
      const response = await createTransport(httpRequest)({
        url: new URL(`http://calendar.example.com:${port}/feeds/avery.ics?view=week`),
        addresses: [{ address: '127.0.0.1', family: 4 }],
        headers: { 'user-agent': 'CareHub-Calendar/test' },
        signal,
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
    });
  });

  it("drops a connection that reached an address that wasn't checked, before sending anything", async () => {
    let requests = 0;
    const handler: RequestListener = (_req, res) => {
      requests++;
      res.end(ICS);
    };
    // A request function whose lookup ignores the checked addresses, as a rebinding bug would.
    const leaky = ((options: RequestOptions, callback?: (res: IncomingMessage) => void) =>
      httpRequest(
        { ...options, lookup: pinnedLookup([{ address: '127.0.0.1', family: 4 }]) },
        callback,
      )) as unknown as Parameters<typeof createTransport>[0];
    await withServer(handler, async (port) => {
      const error = await caught(
        createTransport(leaky)({
          url: new URL(`http://calendar.example.com:${port}/a.ics`),
          addresses: [{ address: '93.184.216.34', family: 4 }],
          headers: {},
          signal,
        }),
      );
      expect(error).toBeInstanceOf(FetchLinkError);
      expect((error as FetchLinkError).code).toBe('blocked-address');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requests).toBe(0);
    });
  });

  it('refuses response headers over 16 KB', async () => {
    expect(LINK_MAX_HEADER_BYTES).toBe(16 * 1024);
    const handler: RequestListener = (_req, res) => {
      res.writeHead(200, { 'x-padding': 'a'.repeat(20_000) });
      res.end(ICS);
    };
    await withServer(handler, async (port) => {
      const error = await caught(
        createTransport(httpRequest)({
          url: new URL(`http://calendar.example.com:${port}/a.ics`),
          addresses: [{ address: '127.0.0.1', family: 4 }],
          headers: {},
          signal,
        }),
      );
      expect((error as NodeJS.ErrnoException | undefined)?.code).toBe('HPE_HEADER_OVERFLOW');
    });
  });
});
