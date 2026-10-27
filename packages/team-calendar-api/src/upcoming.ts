import { z } from 'zod';
import { videoLinkSchema, whenSchema } from './values';

/** `GET /api/calendar/upcoming?limit=6`: what's next, for Home and the sidebar. */
export const upcomingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(6),
});
export type UpcomingQuery = z.infer<typeof upcomingQuerySchema>;

/**
 * An event or occurrence that's under way or starts by the end of tomorrow in the viewer's zone,
 * from a layer that's switched on. Never database rows, courses or events the viewer declined.
 */
export const upcomingItemSchema = z.object({
  /** As in `GET /items`. */
  id: z.string().min(1),
  /** '' shows "(No title)". */
  title: z.string(),
  allDay: z.boolean(),
  /** Timed items: instants. All-day items: dates, `end` exclusive. */
  start: whenSchema,
  end: whenSchema,
  videoLink: videoLinkSchema.nullable(),
  /** Opens it in Calendar (`eventHref`). */
  href: z.string().startsWith('/calendar?'),
});
export type UpcomingItem = z.infer<typeof upcomingItemSchema>;

/** Soonest first, all-day items first on their day. */
export const upcomingResponseSchema = z.object({ items: z.array(upcomingItemSchema) });
export type UpcomingResponse = z.infer<typeof upcomingResponseSchema>;

/** Join shows this many minutes before a timed item with a video link starts. */
export const JOIN_EARLY_MINUTES = 10;

/** Whether to show Join: a timed item with a video link, from 10 minutes before until it ends. */
export function isJoinable(
  item: { allDay: boolean; start: string; end: string; videoLink: unknown },
  now: Date = new Date(),
): boolean {
  if (item.allDay || !item.videoLink) return false;
  const time = now.getTime();
  const opens = Date.parse(item.start) - JOIN_EARLY_MINUTES * 60_000;
  return opens <= time && time < Date.parse(item.end);
}

/**
 * The Calendar link that opens an event (`/calendar?event=<id>`), or one occurrence of a
 * repeating one (`&occurrence=<key>`), as notices, reminders and Upcoming use it.
 */
export function eventHref(eventId: string, occurrence?: string | null): string {
  const query = new URLSearchParams({ event: eventId });
  if (occurrence) query.set('occurrence', occurrence);
  return `/calendar?${query.toString()}`;
}
