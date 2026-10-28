// The rules a calendar sync follows (Calendar spec, Connections): how often it reads, what a layer
// says when reading fails, and how a failure is sorted into "sign in again", "try again later" and
// "can't read this". Nothing here reads a calendar, the database or the network.
import { z } from 'zod';
import { GoogleCalendarError } from '../sync/google/client';
import { TransportError } from '../sync/google/http';
import type { GoogleTokens } from '../sync/google/oauth';
import type { ExternalEvent, ExternalTime } from '../sync/types';
import type { SyncCursor } from './schema';

export const GOOGLE_EVERY_MS = 5 * 60_000;
export const LINK_EVERY_MS = 15 * 60_000;
/** On Calendar open, connections read less than this long ago are left alone. */
export const FRESH_MS = 60_000;
/** Google: a full read at least weekly keeps the copies to the window. */
export const FULL_READ_EVERY_MS = 7 * 86_400_000;
export const MAX_WAIT_MS = 6 * 3_600_000;
/** Failures in a row before the layer shows the problem. */
export const FAILURES_SHOWN = 3;
export const PER_RUN = 25;
export const AT_ONCE = 4;

export const RECONNECT_MESSAGE = 'Google needs you to sign in again.';
export const SIGN_IN_UNREADABLE =
  "Care Hub can't open this connection's saved sign-in. Connect it again.";
export const LINK_UNREADABLE =
  "Care Hub can't open this saved calendar link. Remove it and add it again.";
export const NOT_SUPPORTED = "Care Hub can't read this kind of calendar yet.";
const UNKNOWN = 'Something went wrong reading this calendar. Care Hub will try again shortly.';
/** A layer's message is a plain sentence: never a link, which may be private (CA-11). */
export const plain = (message: string) =>
  message && message.length <= 300 && !/[a-z][a-z\d+.-]*:\/\/|webcal:|www\./i.test(message)
    ? message
    : UNKNOWN;

export const googleTokensSchema: z.ZodType<GoogleTokens> = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string(),
  scopes: z.array(z.string()),
  refreshTokenExpiresAt: z.string().optional(),
});
/** What a private link connection seals: the link as the person entered it. */
export const linkSecretSchema = z.object({ url: z.string().min(1) });

/**
 * What readCalendarLink (sync/link-reader.ts) answers, and how it's called. It fetches a link only
 * through fetchCalendarLink and parses it only in parseCalendarInWorker; sync does neither itself.
 */
export type LinkReadResult =
  /** The cursor, when given, carries fresh validators: keep it. */
  | { status: 'not-modified'; cursor?: SyncCursor }
  | {
      status: 'ok';
      events: ExternalEvent[];
      cursor: SyncCursor;
      /** False when the reader stopped early: keep what came and delete nothing. */
      complete: boolean;
      calendar: { name?: string; timeZone?: string };
      warnings: string[];
    };
export type ReadCalendarLink = (
  link: string,
  cursor: SyncCursor | undefined,
  options: { ownAddresses: string[]; signal?: AbortSignal; window?: { start: Date; end: Date } },
) => Promise<LinkReadResult>;

export type FailureKind = 'reconnect' | 'temporary' | 'broken';

export class SyncFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SyncFailure';
  }
}

/** Errors from the link reader: FetchLinkError (with `retryable`) and IcalParseError. */
const isReaderError = (error: unknown): error is Error & { retryable?: unknown; code?: unknown } =>
  error instanceof Error && (error.name === 'FetchLinkError' || error.name === 'IcalParseError');

export function classify(error: unknown): SyncFailure {
  if (error instanceof SyncFailure) return error;
  if (error instanceof GoogleCalendarError) {
    if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
      return new SyncFailure('reconnect', RECONNECT_MESSAGE);
    }
    const kind = error.kind === 'not-configured' ? 'broken' : 'temporary';
    return new SyncFailure(kind, error.message, error.retryAfterMs);
  }
  if (error instanceof TransportError) {
    return new SyncFailure(error.retryable ? 'temporary' : 'broken', error.message);
  }
  if (isReaderError(error)) {
    // Too complex to read in time may pass, so it backs off like a failed fetch.
    const retry = error.retryable === true || error.code === 'too-complex';
    return new SyncFailure(retry ? 'temporary' : 'broken', error.message);
  }
  return new SyncFailure('temporary', UNKNOWN);
}

export const monthsFrom = (date: Date, months: number) => {
  const shifted = new Date(date);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  return shifted;
};

const timeKey = (time: ExternalTime) =>
  time.kind === 'date'
    ? time.date
    : time.kind === 'utc'
      ? time.instant
      : time.kind === 'zoned'
        ? `${time.dateTime} ${time.timeZone}`
        : time.dateTime;

/** A link event's id: its uid, and the occurrence it changes. */
export const linkEventId = (event: ExternalEvent) =>
  event.recurrenceId ? `${event.uid}#${timeKey(event.recurrenceId)}` : event.uid;
