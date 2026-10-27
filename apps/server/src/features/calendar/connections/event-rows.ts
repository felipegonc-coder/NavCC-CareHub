// The rows a calendar's copies become (Calendar spec, Connections and Limits): one per outside
// event, with rough bounds for range reads and a version to tell changes by. Nearest to now come
// first, so a calendar with too many keeps the events nearest to now.
import { createHash } from 'node:crypto';
import type { ExternalEvent } from '../sync/types';
import { eventBounds } from './bounds';

/** An outside event as a run read it. */
export interface SyncedEventInput {
  remoteId: string;
  event: ExternalEvent;
  /** The etag. Without one, a hash of the event. */
  version?: string | undefined;
  htmlLink?: string | undefined;
}

const versionOf = (input: SyncedEventInput) =>
  input.version ??
  createHash('sha256').update(JSON.stringify(input.event)).digest('base64url').slice(0, 27);

/** How far an event is from now: 0 while it (or its series) is on. */
function distance(row: { startsAt: Date; endsAt: Date | null }, now: number) {
  const start = row.startsAt.getTime();
  if (start > now) return start - now;
  return row.endsAt === null || row.endsAt.getTime() > now ? 0 : now - row.endsAt.getTime();
}

/** One row per remote id (the last copy wins), nearest to now first. */
export function eventRows(calendarId: string, inputs: SyncedEventInput[], now: Date) {
  const byId = new Map(inputs.map((input) => [input.remoteId, input]));
  const at = now.getTime();
  return [...byId.values()]
    .map((input) => ({
      calendarId,
      remoteId: input.remoteId,
      uid: input.event.uid,
      version: versionOf(input),
      event: input.event,
      htmlLink: input.htmlLink ?? null,
      ...eventBounds(input.event),
      readAt: now,
    }))
    .sort((a, b) => distance(a, at) - distance(b, at));
}
