import { daysBetween } from '@carehub/team-time';
import { z } from 'zod';
import {
  LIMITS,
  checkTimes,
  civilDateSchema,
  idSchema,
  memberSchema,
  occurrenceKeySchema,
  personSchema,
  repeatRuleSchema,
  replySchema,
  syncedOccurrenceKeySchema,
  timeZoneSchema,
  videoLinkSchema,
  whenSchema,
} from './values';

/**
 * `GET /api/calendar/items?from=2026-10-25&to=2026-11-01`: dates in the viewer's own time zone,
 * `to` exclusive, at most 42 days.
 */
export const itemsQuerySchema = z
  .object({ from: civilDateSchema, to: civilDateSchema })
  .superRefine(({ from, to }, ctx) => {
    const days = daysBetween(from, to);
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'End after the start.' });
    if (days > LIMITS.rangeDays) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Ask for at most 42 days at a time.' });
    }
  });
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;

/** What every item has. */
const base = {
  /** Stable, and unique in one response. */
  id: z.string().min(1),
  layerId: idSchema,
  /** '' shows "(No title)". */
  title: z.string(),
  allDay: z.boolean(),
  /** Timed items: instants. All-day items: dates, which never shift. `end` is exclusive. */
  start: whenSchema,
  end: whenSchema,
  /** The item's own time zone; null when it's all-day. */
  timeZone: timeZoneSchema.nullable(),
  /** False: dragging shows "Read-only". */
  canEdit: z.boolean(),
};

/** One occurrence of a Care Hub event, on My events or Meetings. */
export const eventItemSchema = z.object({
  ...base,
  source: z.literal('event'),
  /** The series. */
  eventId: idSchema,
  /** Null when the event doesn't repeat. Send `key` back for scoped changes and replies. */
  occurrence: z.object({ key: occurrenceKeySchema }).nullable(),
  repeat: repeatRuleSchema.nullable(),
  location: z.string(),
  description: z.string(),
  videoLink: videoLinkSchema.nullable(),
  organizer: memberSchema,
  /** Invited members, without the organizer. */
  people: z.array(personSchema),
  /** The viewer's answer for this occurrence; 'not-going' shows faded, or hidden. */
  myReply: replySchema.nullable(),
  canReply: z.boolean(),
  notesPageId: idSchema.nullable(),
});
export type EventItem = z.infer<typeof eventItemSchema>;

/** An event from a connected calendar. Always read-only in Care Hub (CA-D3). */
export const syncedItemSchema = z.object({
  ...base,
  source: z.literal('synced'),
  canEdit: z.literal(false),
  syncedEventId: idSchema,
  /** Null unless it repeats. Send `key` back for Remind me and Duplicate. */
  occurrence: z.object({ key: syncedOccurrenceKeySchema }).nullable(),
  provider: z.enum(['google', 'icloud', 'link']),
  calendarName: z.string(),
  location: z.string(),
  description: z.string(),
  videoLink: videoLinkSchema.nullable(),
  organizer: z.object({ name: z.string(), email: z.string().nullable() }).nullable(),
  people: z.array(
    z.object({ name: z.string(), email: z.string().nullable(), reply: replySchema.nullable() }),
  ),
  /** As Google or iCloud has it. */
  myReply: replySchema.nullable(),
  /** Open or Reply in Google Calendar or iCloud; null for private links. */
  externalUrl: z.string().nullable(),
  /** True: show "Open in…"; false: "Reply in…". */
  iOrganize: z.boolean(),
});
export type SyncedItem = z.infer<typeof syncedItemSchema>;

/** A database row on a database layer. Open it at `/p/<rowId>`. */
export const rowItemSchema = z.object({
  ...base,
  source: z.literal('row'),
  rowId: idSchema,
  databaseId: idSchema,
  propertyId: idSchema,
});
export type RowItem = z.infer<typeof rowItemSchema>;

/** A course due date: all-day and read-only. */
export const learningItemSchema = z.object({
  ...base,
  source: z.literal('learning'),
  allDay: z.literal(true),
  canEdit: z.literal(false),
  courseId: idSchema,
  url: z.string(),
});
export type LearningItem = z.infer<typeof learningItemSchema>;

export const calendarItemSchema = z.discriminatedUnion('source', [
  eventItemSchema,
  syncedItemSchema,
  rowItemSchema,
  learningItemSchema,
]);
export type CalendarItem = z.infer<typeof calendarItemSchema>;

/**
 * The range response: items from every layer, on or off, each with its `layerId`, so switching a
 * layer needs no request. `truncated` is true when a limit left items out.
 */
export const itemsResponseSchema = z.object({
  from: civilDateSchema,
  to: civilDateSchema,
  timeZone: timeZoneSchema,
  items: z.array(calendarItemSchema),
  truncated: z.boolean(),
});
export type ItemsResponse = z.infer<typeof itemsResponseSchema>;

/** `PATCH /api/calendar/rows/:rowId`: dragging a row changes its date (needs Can edit). */
export const rowDatePatchSchema = z
  .strictObject({
    propertyId: idSchema,
    allDay: z.boolean(),
    start: whenSchema,
    /** Null for a date without an end. */
    end: whenSchema.nullable().optional(),
  })
  .superRefine((patch, ctx) => checkTimes(patch, ctx));
export type RowDatePatch = z.infer<typeof rowDatePatchSchema>;
