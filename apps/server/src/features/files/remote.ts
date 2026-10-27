// Copies a file from another website, for POST /api/files/from-url (decision 0007, section 4.3). Only
// the public internet is reached: private, loopback, link-local and tailnet addresses are refused, for
// the address given and for every redirect. The check is made on the addresses the connection uses, so
// a name can't pass it with a public address and then connect to a private one.
import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export const REMOTE_MAX_BYTES = 10 * 1024 * 1024;
export const REMOTE_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const WEB_PORTS = new Set([80, 443]);

/** Why a copy failed: the route turns each into a message. */
export type RemoteFailure =
  | 'address' // not an http(s) address, or one with a user name or password
  | 'not_public' // a private, loopback, link-local or tailnet address, or a port other than 80 and 443
  | 'not_found' // the name doesn't exist
  | 'unreachable' // no connection, or it broke off
  | 'status' // an answer other than 200, after redirects
  | 'redirects' // more than 5 redirects
  | 'too_large' // over maxBytes
  | 'timeout'; // over timeoutMs in all

export class RemoteError extends Error {
  constructor(
    readonly reason: RemoteFailure,
    /** The website's status for `status`; the announced size in bytes for `too_large`, when known. */
    readonly detail?: number,
  ) {
    super(`The file couldn't be copied (${reason}).`);
    this.name = 'RemoteError';
  }
}

export interface RemoteOptions {
  /** Default 10 MB. */
  maxBytes?: number;
  /** For the whole copy, redirects included. Default 5 seconds. */
  timeoutMs?: number;
  /** Default: public addresses only (isPublicAddress). */
  isAllowedAddress?: (address: string) => boolean;
  /** Default: 80 and 443. */
  isAllowedPort?: (port: number) => boolean;
  /** Finds a name's addresses. Default: the system's resolver, as for any connection. */
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
}

export interface RemoteFile {
  bytes: Buffer;
  /** The last part of the final address's path, decoded ("" when there is none). */
  name: string;
}

/**
 * Downloads `address` (at most `maxBytes`), following up to 5 redirects. Throws a RemoteError when it
 * can't: see RemoteFailure.
 */
export async function downloadRemoteFile(
  address: string,
  options: RemoteOptions = {},
): Promise<RemoteFile> {
  const maxBytes = options.maxBytes ?? REMOTE_MAX_BYTES;
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  const allowedPort = options.isAllowedPort ?? ((port: number) => WEB_PORTS.has(port));
  const resolve = options.resolve ?? ((hostname: string) => lookup(hostname, { all: true }));
  const deadline = AbortSignal.timeout(options.timeoutMs ?? REMOTE_TIMEOUT_MS);
  const connectLookup = guardedLookup(resolve, allowed);
  let url = checkedUrl(address, allowed, allowedPort);
  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await get(url, connectLookup, deadline);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECTS.has(status) && location) {
        response.destroy();
        if (redirects === MAX_REDIRECTS) throw new RemoteError('redirects');
        url = checkedUrl(parseUrl(location, url)?.href ?? '', allowed, allowedPort);
        continue;
      }
      if (status !== 200) {
        response.destroy();
        throw new RemoteError('status', status);
      }
      const declared = Number(response.headers['content-length']);
      if (declared > maxBytes) {
        response.destroy();
        throw new RemoteError('too_large', declared);
      }
      return { bytes: await readBody(response, maxBytes), name: lastPart(url) };
    }
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    if (deadline.aborted) throw new RemoteError('timeout');
    const code = (error as NodeJS.ErrnoException).code;
    throw new RemoteError(
      code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'not_found' : 'unreachable',
    );
  }
}

/** Whether an IP address is on the public internet: not private, loopback, link-local, tailnet or reserved. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(ipv4(address));
  return version === 6 && isPublicV6(address);
}

/** An http(s) address without a user name or password, on an allowed port; IP addresses checked here. */
function checkedUrl(
  address: string,
  allowed: (address: string) => boolean,
  allowedPort: (port: number) => boolean,
): URL {
  const url = parseUrl(address);
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password
  ) {
    throw new RemoteError('address');
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!allowedPort(port) || (isIP(host) !== 0 && !allowed(host)))
    throw new RemoteError('not_public');
  return url;
}

/** For each connection: the name's addresses, refused when any of them isn't allowed. */
function guardedLookup(
  resolve: (hostname: string) => Promise<LookupAddress[]>,
  allowed: (address: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const [first] = addresses;
        if (!addresses.every(({ address }) => allowed(address))) {
          callback(new RemoteError('not_public'), '');
        } else if (!first) {
          callback(
            Object.assign(new Error(`${hostname} wasn't found.`), { code: 'ENOTFOUND' }),
            '',
          );
        } else if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, ''),
    );
  };
}

function get(url: URL, connectLookup: LookupFunction, signal: AbortSignal) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const headers = { accept: 'image/*', 'accept-encoding': 'identity', 'user-agent': 'Care Hub' };
    // A new connection each time (agent: false), so every one goes through the check.
    client
      .get(url, { agent: false, headers, lookup: connectLookup, signal }, resolve)
      .on('error', reject);
  });
}

async function readBody(response: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      response.destroy();
      throw new RemoteError('too_large');
    }
    chunks.push(chunk);
  }
  if (!response.complete) throw new RemoteError('unreachable');
  return Buffer.concat(chunks, size);
}

function parseUrl(text: string, base?: URL): URL | null {
  try {
    return new URL(text, base);
  } catch {
    return null;
  }
}

function lastPart(url: URL): string {
  const part = url.pathname.split('/').pop() ?? '';
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

const ipv4 = (address: string): number =>
  address.split('.').reduce((value, part) => value * 256 + Number(part), 0);

/** IPv4 that isn't the public internet (RFC 6890); 100.64.0.0/10 holds the tailnet's addresses. */
const NOT_PUBLIC_V4 = (
  [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const
).map(([base, bits]) => ({ base: ipv4(base) >>> (32 - bits), bits }));

const isPublicV4 = (value: number): boolean =>
  !NOT_PUBLIC_V4.some(({ base, bits }) => value >>> (32 - bits) === base);

/** The eight 16-bit groups of an IPv6 address that isIP accepted. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const value = ipv4(dotted[1]);
    text = `${text.slice(0, dotted.index)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [left = '', right] = text.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const zeros = right === undefined ? [] : Array<string>(8 - head.length - tail.length).fill('0');
  return [...head, ...zeros, ...tail].map((group) => parseInt(group, 16));
}

function isPublicV6(address: string): boolean {
  if (address.includes('%')) return false; // a zone: link-local
  const groups = ipv6Groups(address);
  const at = (index: number) => groups[index] ?? 0;
  const zeroUntil = (end: number) => groups.slice(0, end).every((group) => group === 0);
  const lastV4 = at(6) * 0x10000 + at(7);
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): judged by the IPv4 address inside.
  if (zeroUntil(5) && at(5) === 0xffff) return isPublicV4(lastV4);
  if (at(0) === 0x64 && at(1) === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return isPublicV4(lastV4);
  }
  if (at(0) >>> 13 !== 1) return false; // only global unicast, 2000::/3
  if (at(0) === 0x2001 && (at(1) < 0x200 || at(1) === 0xdb8)) return false; // protocols, Teredo, docs
  if (at(0) === 0x3fff && at(1) < 0x1000) return false; // documentation
  if (at(0) === 0x2002) return isPublicV4(at(1) * 0x10000 + at(2)); // 6to4
  return true;
}
