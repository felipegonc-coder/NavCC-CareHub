import { z } from 'zod';
import {
  LIMITS,
  checkTimes,
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

const title = z.string().trim().max(LIMITS.title);
const location = z.string().trim().max(LIMITS.location);
const description = z.string().max(LIMITS.description);
const videoUrl = z.url({ protocol: /^https?$/, error: 'Use a link that starts with https://.' });
const people = z.array(idSchema).max(LIMITS.people);

/**
 * `POST /api/calendar/events` (201 `{ event }`). Timed start and end are instants; all-day ones
 * are dates, with `end` exclusive. The time zone is the creator's unless given. New timed events
 * get the creator's default reminder.
 */
export const createEventSchema = z
  .strictObject({
    title: title.optional(),
    allDay: z.boolean(),
    start: whenSchema,
    end: whenSchema,
    timeZone: timeZoneSchema.optional(),
    repeat: repeatRuleSchema.nullable().optional(),
    location: location.optional(),
    description: description.optional(),
    videoUrl: videoUrl.max(LIMITS.videoUrl).nullable().optional(),
    /** Members to invite; any makes it a meeting. */
    people: people.optional(),
  })
  .superRefine((event, ctx) => checkTimes(event, ctx));
export type CreateEvent = z.infer<typeof createEventSchema>;

/** This event, This and following, or All events. */
export const scopeSchema = z.enum(['one', 'following', 'all']);
export type Scope = z.infer<typeof scopeSchema>;

const scoped = {
  /** Needed on a repeating event. */
  scope: scopeSchema.optional(),
  /** The chosen occurrence's key; needed with 'one' and 'following'. */
  occurrence: occurrenceKeySchema.optional(),
};

function checkScope(
  value: { scope?: Scope | undefined; occurrence?: string },
  ctx: z.RefinementCtx,
) {
  if ((value.scope === 'one' || value.scope === 'following') && value.occurrence === undefined) {
    ctx.addIssue({ code: 'custom', path: ['occurrence'], message: 'Choose an occurrence.' });
  }
}

/**
 * `PATCH /api/calendar/events/:eventId` with only the changed fields (200 `{ event, split }`).
 * `allDay`, `start` and `end` go together, and `timeZone` only with them. `repeat: null` stops
 * repeating. This event (`scope: 'one'`) can't change `repeat` or `people`.
 */
export const editEventSchema = z
  .strictObject({
    title: title.optional(),
    allDay: z.boolean().optional(),
    start: whenSchema.optional(),
    end: whenSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    repeat: repeatRuleSchema.nullable().optional(),
    location: location.optional(),
    description: description.optional(),
    videoUrl: videoUrl.max(LIMITS.videoUrl).nullable().optional(),
    people: people.optional(),
    ...scoped,
  })
  .superRefine((edit, ctx) => {
    const { scope, occurrence, ...fields } = edit;
    if (Object.values(fields).every((value) => value === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Send at least one change.' });
    }
    const { allDay, start, end } = edit;
    if (allDay !== undefined && start !== undefined && end !== undefined) {
      checkTimes({ allDay, start, end }, ctx);
    } else if (allDay !== undefined || start !== undefined || end !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['start'], message: 'Send allDay, start and end.' });
    } else if (edit.timeZone !== undefined) {
      const message = 'Send the time zone with allDay, start and end.';
      ctx.addIssue({ code: 'custom', path: ['timeZone'], message });
    }
    if (scope === 'one') {
      for (const key of ['repeat', 'people'] as const) {
        const message = 'Change this for all events, or for this and following.';
        if (edit[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message });
      }
    }
    checkScope({ scope, occurrence }, ctx);
  });
export type EditEvent = z.infer<typeof editEventSchema>;

/** `DELETE /api/calendar/events/:eventId?scope=…&occurrence=…` (204). */
export const deleteEventQuerySchema = z
  .object(scoped)
  .superRefine((query, ctx) => checkScope(query, ctx));
export type DeleteEventQuery = z.infer<typeof deleteEventQuerySchema>;

/**
 * `POST /api/calendar/duplicate` (201 `{ event }`): a Care Hub copy at the same time. From a
 * series, it copies the series from the chosen occurrence's date. People get a new invite; no
 * replies or notes come along. From a synced event, it invites only the workspace members.
 */
export const duplicateSchema = z.union([
  z.strictObject({ eventId: idSchema, occurrence: occurrenceKeySchema.optional() }),
  z.strictObject({ syncedEventId: idSchema, occurrence: syncedOccurrenceKeySchema.optional() }),
]);
export type Duplicate = z.infer<typeof duplicateSchema>;

/**
 * `PUT /api/calendar/events/:eventId/reply` (204). Without `occurrence` the reply covers the
 * whole series; with it, Just this event.
 */
export const replyBodySchema = z.strictObject({
  reply: replySchema,
  note: z.string().trim().max(LIMITS.replyNote).optional(),
  occurrence: occurrenceKeySchema.optional(),
});
export type ReplyBody = z.infer<typeof replyBodySchema>;

/** A whole Care Hub event: the series, for the edit dialog. */
export const calendarEventSchema = z.object({
  id: idSchema,
  layerId: z.enum(['my-events', 'meetings']),
  title: z.string(),
  allDay: z.boolean(),
  /** The first occurrence. */
  start: whenSchema,
  end: whenSchema,
  timeZone: timeZoneSchema,
  repeat: repeatRuleSchema.nullable(),
  location: z.string(),
  description: z.string(),
  /** As typed; `videoLink` is what Join opens, also when found in the location or description. */
  videoUrl: z.string().nullable(),
  videoLink: videoLinkSchema.nullable(),
  organizer: memberSchema,
  /** Invited members with their replies for the whole series. */
  people: z.array(personSchema),
  myReply: replySchema.nullable(),
  canEdit: z.boolean(),
  canReply: z.boolean(),
  notesPageId: idSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** `GET /api/calendar/events/:eventId`, `POST /api/calendar/events` and duplicate. */
export const eventResponseSchema = z.object({ event: calendarEventSchema });
export type EventResponse = z.infer<typeof eventResponseSchema>;

/**
 * The PATCH response. `split` is the new series that This and following made, from the chosen
 * occurrence on; `event` keeps the occurrences before it.
 */
export const editResponseSchema = z.object({
  event: calendarEventSchema,
  split: calendarEventSchema.nullable(),
});
export type EditResponse = z.infer<typeof editResponseSchema>;
