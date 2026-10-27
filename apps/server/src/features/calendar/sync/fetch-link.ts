// Fetches a private calendar link (https:// or webcal://, read as https). Every host is
// resolved and checked before connecting, redirects are checked again, and the connection
// uses only the checked addresses, so DNS rebinding can't point it at Care Hub's network.

import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { blockedReason } from './ip-address';

export const LINK_TIMEOUT_MS = 15_000;
export const LINK_MAX_BYTES = 10 * 1024 * 1024;
export const LINK_MAX_REDIRECTS = 3;
const USER_AGENT = 'CareHub-Calendar/1.0';
const TEST_ENVS = ['test', 'development'];

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface TransportRequest {
  url: URL; // https (http only for a test origin), without credentials
  addresses: readonly ResolvedAddress[]; // already checked; connect only to these
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface FetchLinkOptions {
  etag?: string; // sent as If-None-Match
  lastModified?: string; // sent as If-Modified-Since
  signal?: AbortSignal;
  timeoutMs?: number; // for the whole fetch, redirects included
  maxBytes?: number;
  // Browser tests only: exact loopback origins with a port (http://127.0.0.1:4599) that skip
  // the private-address check and may use http. Ignored unless NODE_ENV is test or development.
  allowLocalOrigins?: readonly string[];
  resolve?: Resolver; // injectable for tests
  transport?: Transport; // injectable for tests
}

export type FetchLinkResult =
  | { status: 'not-modified'; etag?: string; lastModified?: string }
  | { status: 'ok'; body: Uint8Array; charset?: string; etag?: string; lastModified?: string };

export type FetchLinkErrorCode =
  | 'invalid-link'
  | 'blocked-address'
  | 'dns'
  | 'network'
  | 'timeout'
  | 'too-large'
  | 'too-many-redirects'
  | 'http'
  | 'aborted';

/** A failure with a message that's safe to show: it never contains the link. */
export class FetchLinkError extends Error {
  readonly code: FetchLinkErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;
  constructor(code: FetchLinkErrorCode, message: string, retryable = false, httpStatus?: number) {
    super(message);
    this.name = 'FetchLinkError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

/** Reads a private link as an https URL (http only for a test origin), or throws `invalid-link`. */
export function toHttpsUrl(link: string, localOrigins: ReadonlySet<string> = new Set()): URL {
  const url = safeUrl(link.trim().replace(/^webcals?:\/\//i, 'https://'));
  if (!url?.hostname || (url.protocol !== 'https:' && !localOrigins.has(url.origin))) {
    throw new FetchLinkError(
      'invalid-link',
      'Calendar links must start with https:// or webcal://.',
    );
  }
  url.hash = '';
  return url;
}

/** Reads CAREHUB_TEST_CALENDAR_ORIGINS (comma-separated) for `allowLocalOrigins`. Outside test
 *  and development it's ignored with a warning; an entry that isn't a loopback origin throws. */
export function testCalendarOrigins(
  value: string | undefined,
  nodeEnv: string | undefined,
  warn: (message: string) => void,
): string[] {
  const entries = (value ?? '').split(',').flatMap((entry) => entry.trim() || []);
  if (entries.length > 0 && !TEST_ENVS.includes(nodeEnv ?? '')) {
    warn('CAREHUB_TEST_CALENDAR_ORIGINS is ignored outside test and development.');
    return [];
  }
  return entries.map(loopbackOrigin);
}

function localOrigins(entries: readonly string[] = []): Set<string> {
  return new Set(TEST_ENVS.includes(process.env.NODE_ENV ?? '') ? entries.map(loopbackOrigin) : []);
}

function loopbackOrigin(entry: string): string {
  const url = safeUrl(entry);
  const host = url?.hostname.replace(/^\[|\]$/g, '') ?? '';
  const exact = url?.origin === entry && /^https?:$/.test(url.protocol) && url.port !== '';
  if (!exact || blockedReason(host) !== 'loopback') {
    throw new TypeError('Test calendar origins look like http://127.0.0.1:4599.');
  }
  return entry;
}

export async function fetchCalendarLink(
  link: string,
  options: FetchLinkOptions = {},
): Promise<FetchLinkResult> {
  const local = localOrigins(options.allowLocalOrigins); // a bad entry throws here, unchanged
  const timeoutMs = options.timeoutMs ?? LINK_TIMEOUT_MS;
  const controller = new AbortController();
  const late = `The calendar's server didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`;
  const timer = setTimeout(
    () => controller.abort(new FetchLinkError('timeout', late, true)),
    timeoutMs,
  );
  const cancel = () =>
    controller.abort(new FetchLinkError('aborted', 'The calendar fetch was cancelled.', true));
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await fetchWithRedirects(toHttpsUrl(link, local), local, options, controller.signal);
  } catch (error) {
    const reason: unknown = controller.signal.reason;
    throw reason instanceof FetchLinkError ? reason : toFetchError(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

async function fetchWithRedirects(
  first: URL,
  local: ReadonlySet<string>,
  options: FetchLinkOptions,
  signal: AbortSignal,
): Promise<FetchLinkResult> {
  const transport = options.transport ?? nodeTransport;
  const maxBytes = options.maxBytes ?? LINK_MAX_BYTES;
  let url = first;
  let authorization = basicAuth(url);
  for (let redirects = 0; ; redirects++) {
    const addresses = await checkedAddresses(
      url.hostname,
      options.resolve ?? systemResolver,
      signal,
      local.has(url.origin),
    );
    const headers: Record<string, string> = {
      accept: 'text/calendar, */*;q=0.5',
      'accept-encoding': 'gzip',
      'user-agent': USER_AGENT,
    };
    if (options.etag) headers['if-none-match'] = options.etag;
    if (options.lastModified) headers['if-modified-since'] = options.lastModified;
    if (authorization) headers.authorization = authorization;
    const target = new URL(url.href);
    [target.username, target.password] = ['', ''];
    const response = await transport({ url: target, addresses, headers, signal });
    const get = (name: string) => {
      const value = response.headers[name];
      return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
    };
    const { status } = response;
    if (status !== 200 && status !== 203) response.close();
    if ([301, 302, 303, 307, 308].includes(status)) {
      if (redirects >= LINK_MAX_REDIRECTS) {
        throw new FetchLinkError('too-many-redirects', 'The link redirected too many times.');
      }
      const location = get('location');
      const next = location ? safeUrl(location, url) : undefined;
      if (!next || (next.protocol !== 'https:' && !local.has(next.origin))) {
        throw new FetchLinkError(
          'invalid-link',
          "The link redirected to an address that isn't https.",
        );
      }
      if (next.origin !== url.origin) authorization = undefined;
      url = next;
      continue;
    }
    const validators = { etag: get('etag'), lastModified: get('last-modified') };
    if (status === 304) return compact({ status: 'not-modified', ...validators });
    if (status !== 200 && status !== 203) throw httpError(status);
    const tooLarge = () =>
      new FetchLinkError(
        'too-large',
        `The calendar is larger than ${Math.round(maxBytes / 1048576)} MB.`,
      );
    if (Number(get('content-length')) > maxBytes) {
      response.close();
      throw tooLarge();
    }
    const encoding = get('content-encoding')?.toLowerCase() ?? 'identity';
    if (!['identity', 'gzip', 'x-gzip'].includes(encoding)) {
      response.close();
      throw new FetchLinkError('network', "The calendar's server sent an unsupported encoding.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const collect = async (source: AsyncIterable<Uint8Array>) => {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes) throw tooLarge();
        chunks.push(chunk);
      }
    };
    if (encoding === 'identity') await collect(response.body);
    else await pipeline(response.body, createGunzip(), collect);
    const charset = /;\s*charset="?([\w.:-]+)"?/i.exec(get('content-type') ?? '')?.[1];
    return compact({ status: 'ok', body: Buffer.concat(chunks), charset, ...validators });
  }
}

function safeUrl(value: string, base?: URL): URL | undefined {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

function basicAuth(url: URL): string | undefined {
  if (!url.username && !url.password) return undefined;
  const pair = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}

async function checkedAddresses(
  hostname: string,
  resolve: Resolver,
  signal: AbortSignal,
  testOrigin: boolean, // a listed test origin: skips only the private-address check
): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  let addresses: readonly ResolvedAddress[];
  if (literal) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await abortable(resolve(host), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new FetchLinkError('dns', "Couldn't find the calendar's server. Check the link.", true);
    }
  }
  if (addresses.length === 0) {
    throw new FetchLinkError('dns', "Couldn't find the calendar's server. Check the link.", true);
  }
  if (!testOrigin && addresses.some((a) => blockedReason(a.address) !== undefined)) {
    throw new FetchLinkError(
      'blocked-address',
      "This link points to a private or local network address, which Care Hub can't use.",
    );
  }
  return [...addresses];
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function httpError(status: number): FetchLinkError {
  const message =
    status === 401 || status === 403
      ? "The calendar's server refused this link. It may have been reset; get a new link and try again."
      : status === 404 || status === 410
        ? "The calendar's server says there's no calendar at this link."
        : `The calendar's server answered with error ${status}.`;
  const retryable = status === 408 || status === 429 || status >= 500;
  return new FetchLinkError('http', message, retryable, status);
}

function toFetchError(error: unknown): FetchLinkError {
  if (error instanceof FetchLinkError) return error;
  return new FetchLinkError('network', "Couldn't read the calendar from its server.", true);
}

const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

/** A lookup function that answers only with the checked addresses. */
export function pinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const wanted = options.family === 'IPv6' ? 6 : options.family === 'IPv4' ? 4 : options.family;
    const list = addresses.filter((a) => !wanted || a.family === wanted);
    const first = list[0];
    if (!first) {
      callback(Object.assign(new Error('No checked address'), { code: 'ENOTFOUND' }), '', 4);
    } else if (options.all) {
      callback(
        null,
        list.map(({ address, family }) => ({ address, family })),
      );
    } else {
      callback(null, first.address, first.family);
    }
  };
}

/** The real transport: node:https (node:http for a test origin), only to the checked addresses. */
export function createTransport(
  request: typeof httpsRequest = httpsRequest,
  plainRequest = httpRequest as typeof httpsRequest,
): Transport {
  return ({ url, addresses, headers, signal }) =>
    new Promise<TransportResponse>((resolve, reject) => {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const req = (url.protocol === 'http:' ? plainRequest : request)(
        {
          hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers,
          agent: false,
          lookup: pinnedLookup(addresses),
          ...(isIP(hostname) ? {} : { servername: hostname }),
          signal,
        },
        (res) =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: res,
            close: () => res.destroy(),
          }),
      );
      req.on('error', reject);
      req.end();
    });
}

const nodeTransport = createTransport();

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
