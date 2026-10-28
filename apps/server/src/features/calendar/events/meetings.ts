import { LIMITS } from '@carehub/team-calendar-api';
import { isCivilDate, toInstant } from '@carehub/team-time';
import type { MeetingEvent } from '../../meetings';
import type { StoredEvent } from './items';
import { occurrenceOf } from './starts';

/** Meeting notes are for occurrences within a year of today, either way (366 days, as Meetings). */
export const MEETING_WINDOW_MS = 366 * 86_400_000;

/**
 * What meeting notes (features/meetings) get for one occurrence, as it is now: moved or not, with
 * its own title, under Calendar's key for it (null when the event doesn't repeat), and the people
 * invited without the organizer (at most `LIMITS.people`; the lookup then keeps only members).
 * Null for an occurrence that's gone or more than a year from `now`, for a repeating event without
 * a key, and for a key on an event that doesn't repeat.
 */
export function meetingOf(
  event: StoredEvent,
  occurrence: string | undefined,
  now: Date,
): MeetingEvent | null {
  const found = occurrenceOf(event, occurrence);
  if (!found) return null;
  const allDay = isCivilDate(found.start);
  const start = allDay ? found.start : toInstant(found.start, event.timeZone).toISOString();
  if (Math.abs(Date.parse(start) - now.getTime()) > MEETING_WINDOW_MS) return null;
  const invited = event.people.map((person) => person.userId);
  return {
    eventId: event.id,
    occurrence: found.key,
    title: found.changes.title ?? event.title,
    allDay,
    start,
    timeZone: event.timeZone,
    organizerId: event.organizerId,
    memberIds: invited.filter((id) => id !== event.organizerId).slice(0, LIMITS.people),
  };
}
