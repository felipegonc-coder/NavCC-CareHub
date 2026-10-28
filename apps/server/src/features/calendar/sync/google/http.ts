// Shared HTTP pieces for the Google connection. Nothing here does I/O itself: callers inject `fetch`.

/** How long one call to Google may take, reply included. */
export const GOOGLE_TIMEOUT_MS = 10_000;
/** The most Care Hub reads of one reply: sign-in answers are small, event pages can be big. */
export const SIGN_IN_MAX_BYTES = 1024 * 1024;
export const CALENDAR_MAX_BYTES = 10 * 1024 * 1024;

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

/** A signal for one call: the caller's own, or the time limit, whichever ends first. */
export function timeLimit(signal?: AbortSignal, ms = GOOGLE_TIMEOUT_MS) {
  const timer = AbortSignal.timeout(ms);
  return {
    signal: signal ? AbortSignal.any([signal, timer]) : timer,
    timedOut: () => timer.aborted,
  };
}

const tooLarge = () =>
  new TransportError('too-large', 'Google sent an answer too large for Care Hub to read.', false);

/** Reads a body as text, stopping with a `too-large` TransportError past `maxBytes`. */
export async function readText(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/** Reads a body as JSON within `maxBytes`; `undefined` when it's empty or not JSON. */
export async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  return parseJson(await readText(response, maxBytes));
}
