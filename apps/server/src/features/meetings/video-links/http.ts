// Calls to the providers: 10-second timeouts, no redirects, answers up to 256 KB. Tokens go only in
// headers and bodies, never in URLs, and nothing here logs.

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;

export type Fetch = typeof fetch;

/**
 * Why a provider call failed: `reconnect` (the person's sign-in has ended), `client-rejected` (the
 * client ID or secret is wrong), `temporary` (no answer, busy, or a server error) or `failed`.
 */
export type ProviderErrorKind = 'reconnect' | 'client-rejected' | 'temporary' | 'failed';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** The provider's HTTP status, when it answered. */
  readonly status: number | undefined;

  constructor(kind: ProviderErrorKind, status?: number) {
    super(`The provider call failed (${kind}${status === undefined ? '' : `, ${status}`}).`);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}

/** One request to a provider. A network failure or a timeout is `temporary`. */
export async function send(fetcher: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    return await fetcher(url, { ...init, redirect: 'error', signal });
  } catch {
    throw new ProviderError('temporary');
  }
}

/** The answer's JSON, or null when it isn't JSON. A longer answer is `failed`. */
export async function readJson(response: Response): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) throw new ProviderError('failed', response.status);
      chunks.push(chunk);
    }
  } catch (error) {
    throw error instanceof ProviderError ? error : new ProviderError('temporary', response.status);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** A refused API call: 401 means the sign-in has ended; 429 and 5xx are `temporary`. */
export function apiError(status: number): ProviderError {
  if (status === 401) return new ProviderError('reconnect', status);
  if (status === 429 || status >= 500) return new ProviderError('temporary', status);
  return new ProviderError('failed', status);
}

/** Whether `value` is an https:// link on one of `hosts` or their subdomains, without a port. */
export function isHttpsLinkOn(value: string, hosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
