// Shared HTTP pieces for the Google connection. Nothing here does I/O itself: callers inject `fetch`.

/** The part of `fetch` this folder uses, so tests, the mock and the bridge can supply their own. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A failure below HTTP, such as the network or the Apps Script bridge. */
export class TransportError extends Error {
  readonly code: string;
  /** False when trying again can't help (for example, a wrong bridge code). */
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransportError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Milliseconds to wait from a Retry-After header (seconds or an HTTP date), if it has one. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number,
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

/** Parses JSON text; `undefined` when it's empty or not JSON. */
export function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads a response body as JSON; `undefined` when it's empty or not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  return parseJson(await response.text());
}
