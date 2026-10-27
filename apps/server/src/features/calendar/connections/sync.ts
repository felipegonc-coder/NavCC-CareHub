// Keeps connected calendars in step (Calendar spec, Connections): Google every 5 minutes, private
// links every 15, and on Calendar open when the last look is over a minute old. Only reads:
// nothing is ever written to Google or to a link. When a Google sign-in stops working, the
// connection says "Google needs you to sign in again" and the person gets one 🔔 notice (CA-12).
import { z } from 'zod';
import type { SendNotice } from '../../notices';
import {
  type GoogleCalendarClient,
  GoogleCalendarError,
  createGoogleCalendarClient,
  directTransport,
} from '../sync/google/client';
import { type FetchLike, TransportError } from '../sync/google/http';
import { fromGoogleEvent } from '../sync/google/map';
import {
  GOOGLE_SIGN_IN_MESSAGES,
  type GoogleOAuth,
  type GoogleTokens,
  tokensNeedRefresh,
} from '../sync/google/oauth';
import type { ExternalEvent, ExternalTime } from '../sync/types';
import type { SyncCursor } from './schema';
import {
  type SecretBox,
  SecretError,
  connectionSecretContext,
  openJson,
  sealJson,
} from './secrets';
import type {
  SyncCalendar,
  SyncConnection,
  SyncOutcome,
  SyncStore,
  SyncedEventInput,
} from './sync-store';

export const GOOGLE_EVERY_MS = 5 * 60_000;
export const LINK_EVERY_MS = 15 * 60_000;
/** On Calendar open, connections read less than this long ago are left alone. */
export const FRESH_MS = 60_000;
/** Google: a full read at least weekly keeps the copies to the window. */
const FULL_READ_EVERY_MS = 7 * 86_400_000;
const MAX_WAIT_MS = 6 * 3_600_000;
/** Failures in a row before the layer shows the problem. */
const FAILURES_SHOWN = 3;
const PER_RUN = 25;
const AT_ONCE = 4;

export const RECONNECT_MESSAGE = 'Google needs you to sign in again.';
const SIGN_IN_UNREADABLE = "Care Hub can't open this connection's saved sign-in. Connect it again.";
const LINK_UNREADABLE = "Care Hub can't open this saved calendar link. Remove it and add it again.";
const NOT_SUPPORTED = "Care Hub can't read this kind of calendar yet.";
const UNKNOWN = 'Something went wrong reading this calendar. Care Hub will try again shortly.';
/** A layer's message is a plain sentence: never a link, which may be private (CA-11). */
const plain = (message: string) =>
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
const NO_CHANGES = { upserts: [], removed: [] };

/** The iCalendar reader's readCalendarLink, as agreed with its owner. */
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

export interface CalendarSyncDeps {
  store: SyncStore;
  /** From CALENDAR_SECRET_KEY. Without it nothing syncs. */
  box: SecretBox | undefined;
  /** Undefined when Google sign-in isn't set up. */
  google: GoogleOAuth | undefined;
  /** Reaches the Google Calendar API. */
  fetch: FetchLike;
  /** Without it, private links say Care Hub can't read them yet. */
  readLink?: ReadCalendarLink | undefined;
  notify: SendNotice;
  /** Tells the person's open screens which of their calendars changed: events, name or status. */
  changed: (ownerId: string, calendarIds: string[]) => void;
  now?: () => Date;
  log?: (message: string, error: unknown) => void;
}

type FailureKind = 'reconnect' | 'temporary' | 'broken';

class SyncFailure extends Error {
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
const isReaderError = (error: unknown): error is Error & { retryable?: unknown } =>
  error instanceof Error && (error.name === 'FetchLinkError' || error.name === 'IcalParseError');

function classify(error: unknown): SyncFailure {
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
    return new SyncFailure(error.retryable === true ? 'temporary' : 'broken', error.message);
  }
  return new SyncFailure('temporary', UNKNOWN);
}

const monthsFrom = (date: Date, months: number) => {
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

export function createCalendarSync(deps: CalendarSyncDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  function open<T>(box: SecretBox, connection: SyncConnection, schema: z.ZodType<T>): T {
    return openJson(box, connection.secret, connectionSecretContext(connection.id), schema);
  }

  /** One Google calendar: everything in the window, or the changes since the last run. */
  async function readGoogleCalendar(client: GoogleCalendarClient, calendar: SyncCalendar) {
    const at = now();
    const token = calendar.cursor?.syncToken;
    const stale =
      !calendar.lastFullSyncAt ||
      at.getTime() - calendar.lastFullSyncAt.getTime() > FULL_READ_EVERY_MS;
    const changes = await client.listEventChanges({
      calendarId: calendar.remoteId,
      ...(typeof token === 'string' && !stale ? { syncToken: token } : {}),
      window: {
        timeMin: monthsFrom(at, -6).toISOString(),
        timeMax: monthsFrom(at, 12).toISOString(),
      },
    });
    const calendarTimeZone = changes.timeZone ?? calendar.timeZone ?? undefined;
    const upserts: SyncedEventInput[] = [];
    const removed: string[] = [];
    for (const item of changes.events) {
      const mapped = fromGoogleEvent(item, calendarTimeZone ? { calendarTimeZone } : {});
      if (mapped.kind !== 'event') removed.push(mapped.remoteId);
      else
        upserts.push({
          remoteId: item.id,
          event: mapped.event,
          version: item.etag,
          htmlLink: mapped.htmlLink,
        });
    }
    const cursor = changes.nextSyncToken ? { syncToken: changes.nextSyncToken } : null;
    const saved = changes.full
      ? await store.replaceEvents(calendar.id, upserts, cursor, at)
      : await store.applyChanges(calendar.id, { upserts, removed }, cursor, at);
    return saved.changed;
  }

  async function syncGoogle(
    box: SecretBox,
    connection: SyncConnection,
    calendars: SyncCalendar[],
    state: { secret?: string; changed: Set<string> },
  ) {
    const google = deps.google;
    if (!google) throw new SyncFailure('broken', GOOGLE_SIGN_IN_MESSAGES['missing-settings']);
    let tokens: GoogleTokens;
    try {
      tokens = open(box, connection, googleTokensSchema);
    } catch (error) {
      if (error instanceof SecretError) throw new SyncFailure('reconnect', SIGN_IN_UNREADABLE);
      throw error;
    }
    const refresh = async () => {
      const outcome = await google.refresh(tokens.refreshToken);
      if (outcome.kind === 'connected') {
        tokens = outcome.tokens;
        state.secret = sealJson(box, tokens, connectionSecretContext(connection.id));
        return;
      }
      if (outcome.kind === 'needs-reconnect') throw new SyncFailure('reconnect', RECONNECT_MESSAGE);
      if (outcome.kind === 'not-configured') throw new SyncFailure('broken', outcome.message);
      throw new SyncFailure('temporary', outcome.message, outcome.retryAfterMs);
    };
    const read = async () => {
      const client = createGoogleCalendarClient({
        transport: (request, signal) =>
          directTransport({ fetch: deps.fetch, accessToken: tokens.accessToken })(request, signal),
      });
      const list = await client.listCalendars();
      const first = calendars.length === 0;
      const saved = await store.saveCalendarList(
        connection.id,
        list.map((calendar) => ({
          remoteId: calendar.id,
          name: calendar.name,
          timeZone: calendar.timeZone,
          shown: first && calendar.primary,
        })),
      );
      // Layers that went away or were renamed in Google.
      for (const before of calendars.filter((c) => c.shown)) {
        const after = saved.find((c) => c.id === before.id);
        if (after?.name !== before.name) state.changed.add(before.id);
      }
      for (const calendar of saved.filter((c) => c.shown)) {
        try {
          if (await readGoogleCalendar(client, calendar)) state.changed.add(calendar.id);
        } catch (error) {
          // A calendar shared with the person and then taken away: the others still sync.
          const gone = error instanceof GoogleCalendarError && error.kind === 'not-found';
          if (!gone && !(error instanceof GoogleCalendarError && error.kind === 'forbidden')) {
            throw error;
          }
        }
      }
    };
    if (tokensNeedRefresh(tokens, now())) await refresh();
    try {
      await read();
    } catch (error) {
      if (!(error instanceof GoogleCalendarError && error.kind === 'unauthorized')) throw error;
      await refresh();
      await read();
    }
  }

  async function syncLink(
    box: SecretBox,
    connection: SyncConnection,
    calendars: SyncCalendar[],
    state: { changed: Set<string> },
  ) {
    const [calendar] = calendars;
    if (!calendar?.shown) return;
    const { readLink } = deps;
    if (!readLink) throw new SyncFailure('broken', NOT_SUPPORTED);
    let url: string;
    try {
      ({ url } = open(box, connection, linkSecretSchema));
    } catch (error) {
      if (error instanceof SecretError) throw new SyncFailure('broken', LINK_UNREADABLE);
      throw error;
    }
    const at = now();
    const result = await readLink(url, calendar.cursor ?? undefined, {
      ownAddresses: [connection.ownerEmail],
      window: { start: monthsFrom(at, -6), end: monthsFrom(at, 12) },
    });
    if (result.status === 'not-modified') {
      if (result.cursor) await store.applyChanges(calendar.id, NO_CHANGES, result.cursor, at);
      return;
    }
    const events = result.events.map((event) => ({ remoteId: linkEventId(event), event }));
    const saved = result.complete
      ? await store.replaceEvents(calendar.id, events, result.cursor, at)
      : await store.applyChanges(calendar.id, { upserts: events, removed: [] }, result.cursor, at);
    if (saved.changed) state.changed.add(calendar.id);
  }

  async function tellReconnect(connection: SyncConnection) {
    if (!connection.workspaceId) return;
    try {
      await deps.notify({
        workspaceId: connection.workspaceId,
        userId: connection.ownerId,
        kind: 'alert',
        sender: 'Calendar',
        icon: '📅',
        title: 'Google needs you to sign in again',
        text: 'Your Google calendars stopped updating in Care Hub. Reconnect to keep them up to date.',
        buttons: [{ label: 'Reconnect', href: '/calendar/connections' }],
        groupKey: `calendar-connection:${connection.id}`,
      });
    } catch (error) {
      deps.log?.('The calendar reconnect notice was not sent.', error);
    }
  }

  function failed(connection: SyncConnection, failure: SyncFailure, at: number): SyncOutcome {
    const failures = connection.failures + 1;
    if (failure.kind === 'reconnect') {
      return {
        status: 'needs-reconnect',
        lastError: failure.message,
        failures,
        nextSyncAt: new Date(at + MAX_WAIT_MS),
      };
    }
    const base = failure.kind === 'broken' ? LINK_EVERY_MS : 60_000;
    const backoff = Math.min(MAX_WAIT_MS, base * 2 ** Math.min(failures - 1, 12));
    const wait = Math.max(failure.retryAfterMs ?? 0, backoff);
    // A link that was never read shows its problem at once: the link may just be wrong (CA-10).
    const firstLook = connection.kind === 'link' && !connection.lastSyncedAt;
    const shown = failure.kind === 'broken' || failures >= FAILURES_SHOWN || firstLook;
    const status = shown ? 'error' : connection.status;
    return {
      status,
      lastError: status === 'ok' ? null : plain(failure.message),
      failures,
      nextSyncAt: new Date(at + wait),
    };
  }

  /** Syncs one connection this process holds the lease on. */
  async function run(id: string) {
    const box = deps.box;
    const loaded = await store.load(id);
    if (!box || !loaded) return;
    const { connection, calendars } = loaded;
    const at = now().getTime();
    const state: { secret?: string; changed: Set<string> } = { changed: new Set() };
    let outcome: SyncOutcome;
    try {
      if (connection.kind === 'google') await syncGoogle(box, connection, calendars, state);
      else if (connection.kind === 'link') await syncLink(box, connection, calendars, state);
      else throw new SyncFailure('broken', NOT_SUPPORTED);
      const every = connection.kind === 'google' ? GOOGLE_EVERY_MS : LINK_EVERY_MS;
      outcome = {
        status: 'ok',
        lastError: null,
        failures: 0,
        nextSyncAt: new Date(at + every),
        syncedAt: new Date(at),
      };
    } catch (error) {
      if (!(error instanceof SyncFailure)) deps.log?.('A calendar sync failed.', error);
      outcome = failed(connection, classify(error), at);
    }
    const recorded = await store.finish(id, connection.secret, {
      ...outcome,
      secret: state.secret,
    });
    const before = connection;
    if (recorded && (outcome.status !== before.status || outcome.lastError !== before.lastError)) {
      for (const calendar of calendars) if (calendar.shown) state.changed.add(calendar.id);
    }
    if (state.changed.size > 0) deps.changed(connection.ownerId, [...state.changed]);
    if (recorded && outcome.status === 'needs-reconnect' && before.status !== 'needs-reconnect') {
      await tellReconnect(connection);
    }
  }

  async function runAll(ids: string[]) {
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        // One connection's trouble (the database, say) doesn't stop the others.
        await run(id).catch((error: unknown) => deps.log?.('A calendar sync failed.', error));
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, worker));
  }

  return {
    /** The periodic task: connections that are due, a few at a time. Returns how many ran. */
    async runDue() {
      if (!deps.box) return 0;
      const ids = await store.claimDue(now(), PER_RUN);
      await runAll(ids);
      return ids.length;
    },
    /** "Sync now". False when the connection isn't theirs or is syncing already. */
    async syncNow(ownerId: string, id: string) {
      if (!deps.box || !(await store.claim({ id, ownerId, now: now() }))) return false;
      await run(id);
      return true;
    },
    /** Calendar opened: reads the person's connections that weren't read in the last minute. */
    async refresh(ownerId: string, ids: string[]) {
      if (!deps.box) return;
      const at = now();
      const unlessSyncedAfter = new Date(at.getTime() - FRESH_MS);
      const claimed: string[] = [];
      for (const id of ids) {
        if (await store.claim({ id, ownerId, now: at, unlessSyncedAfter })) claimed.push(id);
      }
      await runAll(claimed);
    },
  };
}
export type CalendarSync = ReturnType<typeof createCalendarSync>;
