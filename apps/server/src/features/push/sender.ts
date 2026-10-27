// Sends one push message (RFC 8030) through an injected fetch and says what to do next: nothing,
// delete the subscription, retry later, or drop the message.
import { createHash } from 'node:crypto';
import {
  encryptPushMessage,
  MAX_PLAINTEXT_BYTES,
  type PushSubscriptionKeys,
} from './protocol/encrypt';
import { vapidAuthorization, type VapidKeys } from './protocol/vapid';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;
/** Padding rounds bodies up to a multiple of this, so the push service can't read text lengths. */
const PAD_TO_BYTES = 256;
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * The push services browsers use. Endpoints elsewhere are refused, so a crafted subscription
 * can't make the server call other addresses. A leading dot matches any subdomain.
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com', // Chrome, Android browsers, Opera, Brave
  'updates.push.services.mozilla.com', // Firefox
  '.push.apple.com', // Safari on Mac, iPhone and iPad
  '.notify.windows.com', // Edge on Windows
];

/** Where one browser gets push messages: `PushSubscription.toJSON()`'s endpoint and keys. */
export interface PushTarget {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface PushSender {
  /** `fetch`, or a stand-in in tests. */
  fetch: typeof fetch;
  /** From `resolvePushConfig` (settings.ts). */
  vapid: { keys: VapidKeys; subject: string };
}

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

export interface SendPushOptions {
  /** How long the push service keeps it for an offline device (RFC 8030 5.2). Default 1 day. */
  ttlSeconds?: number;
  /** RFC 8030 5.3. Default "normal"; "high" suits reminders. */
  urgency?: PushUrgency;
  /** A newer message with the same topic replaces an undelivered one (RFC 8030 5.4): `topicFor`. */
  topic?: string;
  /** Default 10 seconds. */
  timeoutMs?: number;
  now?: Date;
}

/**
 * delivered: the push service took it. gone: the subscription expired or was turned off (or is
 * unusable), so delete it. retry: try again later, after `retryAfterSeconds` when given.
 * rejected: don't retry this message; `detail` is the push service's own words, for logs.
 */
export type PushOutcome =
  | { result: 'delivered'; status: number }
  | { result: 'gone'; status: number | null }
  | { result: 'retry'; status: number | null; retryAfterSeconds: number | null }
  | { result: 'rejected'; status: number | null; reason: PushRejection; detail?: string };

export type PushRejection =
  'bad_request' | 'unauthorized' | 'too_large' | 'not_allowed' | 'refused';

/**
 * Encrypts `payload` (from `buildPushPayload`) for one subscription and sends it. Network errors
 * and timeouts come back as "retry" rather than throwing.
 */
export async function sendPush(
  sender: PushSender,
  target: PushTarget,
  payload: Uint8Array,
  options: SendPushOptions = {},
): Promise<PushOutcome> {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 0) throw new RangeError('TTL is a whole number of seconds.');
  if (options.topic !== undefined && !TOPIC.test(options.topic)) {
    throw new RangeError('A topic is 1 to 32 base64url characters.');
  }
  if (!isAllowedPushEndpoint(target.endpoint)) {
    return { result: 'rejected', status: null, reason: 'not_allowed' };
  }
  if (payload.length > MAX_PLAINTEXT_BYTES) {
    return { result: 'rejected', status: null, reason: 'too_large' };
  }
  let body: Uint8Array;
  try {
    body = encryptPushMessage(payload, target.keys, { padding: paddingFor(payload.length) });
  } catch (error) {
    if (error instanceof TypeError) return { result: 'gone', status: null }; // Malformed keys.
    throw error;
  }

  const headers: Record<string, string> = {
    TTL: String(ttl),
    Urgency: options.urgency ?? 'normal',
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    Authorization: vapidAuthorization({
      ...sender.vapid,
      audience: new URL(target.endpoint).origin,
      now: options.now,
    }),
  };
  if (options.topic) headers.Topic = options.topic;

  let response: Response;
  try {
    response = await sender.fetch(target.endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual', // Push services answer directly; never follow one elsewhere.
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    return { result: 'retry', status: null, retryAfterSeconds: null }; // Network error or timeout.
  }
  const outcome = classifyPushResponse(
    response.status,
    response.headers.get('retry-after'),
    options.now ?? new Date(),
  );
  if (outcome.result !== 'rejected') {
    await response.body?.cancel().catch(() => undefined);
    return outcome;
  }
  const detail = (await response.text().catch(() => '')).trim().slice(0, 200);
  return detail ? { ...outcome, detail } : outcome;
}

/** What a push service's answer means (RFC 8030 sections 5, 6 and 8.4). */
export function classifyPushResponse(
  status: number,
  retryAfter: string | null,
  now: Date,
): PushOutcome {
  if (status >= 200 && status < 300) return { result: 'delivered', status };
  if (status === 404 || status === 410) return { result: 'gone', status };
  if (status === 429 || status >= 500) {
    return { result: 'retry', status, retryAfterSeconds: parseRetryAfter(retryAfter, now) };
  }
  const reasons: Partial<Record<number, PushRejection>> = {
    400: 'bad_request',
    401: 'unauthorized', // The token was refused, for example after the VAPID keys changed.
    403: 'unauthorized',
    413: 'too_large',
  };
  return { result: 'rejected', status, reason: reasons[status] ?? 'refused' };
}

/** Only HTTPS endpoints on the default port at a known push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname;
  return PUSH_SERVICE_HOSTS.some((allowed) =>
    allowed.startsWith('.')
      ? host.endsWith(allowed) && host.length > allowed.length
      : host === allowed,
  );
}

/** A Topic for a tag: 32 base64url characters that don't reveal the tag to the push service. */
export function topicFor(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

/** Retry-After as seconds from now: a number of seconds or an HTTP date. */
function parseRetryAfter(value: string | null, now: Date): number | null {
  const text = value?.trim() ?? '';
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

function paddingFor(length: number): number {
  const rounded = Math.ceil(length / PAD_TO_BYTES) * PAD_TO_BYTES;
  return Math.min(rounded, MAX_PLAINTEXT_BYTES) - length;
}
