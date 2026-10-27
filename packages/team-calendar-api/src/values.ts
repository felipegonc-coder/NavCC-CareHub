import { checkRule } from '@carehub/team-repeat';
import type { OccurrenceKey, RepeatRule } from '@carehub/team-repeat';
import { isCivilDate, isCivilDateTime, isValidTimeZone } from '@carehub/team-time';
import type { CivilDate } from '@carehub/team-time';
import { z } from 'zod';

/** Longest values the API takes. The description and reply note limits come from the spec. */
export const LIMITS = {
  title: 1000,
  location: 1000,
  description: 8000,
  videoUrl: 2000,
  people: 200,
  replyNote: 200,
  /** Days in one range request: six weeks, enough for a month grid. */
  rangeDays: 42,
} as const;

/** Ids of users, events, rows and the rest. */
export const idSchema = z.string().min(1).max(100);

/** A date such as '2026-10-27': all-day starts and ends, and range bounds. */
export const civilDateSchema = z.custom<CivilDate>(isCivilDate, 'Use a date like 2026-10-27.');

/** An exact moment in UTC, as `toISOString` writes it: '2026-10-27T16:00:00.000Z'. */
export type Instant = string;

export const instantSchema = z.iso.datetime({
  error: 'Use a UTC time like 2026-10-27T16:00:00.000Z.',
});

/** An all-day item's date or a timed item's instant. */
export const whenSchema = z.union([civilDateSchema, instantSchema]);

export const timeZoneSchema = z.custom<string>(isValidTimeZone, 'Pick a time zone from the list.');

/**
 * Which occurrence of a repeating event: its original start in the event's time zone, such as
 * '2026-10-26T10:00', or '2026-10-26' for an all-day event. It stays the same when it moves.
 */
export const occurrenceKeySchema = z.custom<OccurrenceKey>(
  (value) => isCivilDate(value) || isCivilDateTime(value),
  'Use the occurrence key from the item.',
);

/** A synced occurrence's original start: a date, or an exact moment for timed events. */
export const syncedOccurrenceKeySchema = z.string().min(10).max(40);

/** A repeat rule in the `@carehub/team-repeat` shape, checked with its `checkRule`. */
export const repeatRuleSchema = z.custom<RepeatRule>().superRefine((value, ctx) => {
  for (const message of checkRule(value)) ctx.addIssue({ code: 'custom', message });
});

export const replySchema = z.enum(['going', 'maybe', 'not-going']);
export type Reply = z.infer<typeof replySchema>;

/** A link that Join opens. */
export const videoLinkSchema = z.object({
  url: z.string(),
  provider: z.enum(['zoom', 'google-meet', 'teams', 'webex']),
});
export type VideoLink = z.infer<typeof videoLinkSchema>;

/** A workspace member as events show them. */
export const memberSchema = z.object({
  id: idSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type Member = z.infer<typeof memberSchema>;

/** An invited member and their answer for this occurrence. */
export const personSchema = memberSchema.extend({
  reply: replySchema.nullable(),
  note: z.string().nullable(),
});
export type Person = z.infer<typeof personSchema>;

type Times = { allDay: boolean; start: string; end?: string | null | undefined };

/** All-day: two dates, end after start. Timed: two instants, end not before start. */
export function checkTimes({ allDay, start, end }: Times, ctx: z.RefinementCtx): void {
  if (allDay !== isCivilDate(start)) {
    const message = allDay ? 'All-day events use dates.' : 'Timed events use UTC times.';
    ctx.addIssue({ code: 'custom', path: ['start'], message });
  } else if (end != null && isCivilDate(end) !== allDay) {
    ctx.addIssue({
      code: 'custom',
      path: ['end'],
      message: 'Use the same kind of value as start.',
    });
  } else if (end != null && (allDay ? end <= start : Date.parse(end) < Date.parse(start))) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'End after the start.' });
  }
}
