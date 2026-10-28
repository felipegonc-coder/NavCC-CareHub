// Take meeting notes: the request, the page's title and its sections (Meetings spec, section 3).
import { datePart, formatDate, isCivilDate, isCivilDateTime, toCivil } from '@carehub/team-time';
import { z } from 'zod';
import type { MeetingEvent } from '../types';

/** `POST /api/meetings/notes`: the event, and the occurrence's key when it repeats. */
export const takeNotesSchema = z.strictObject({
  eventId: z.string().min(1).max(100),
  occurrence: z
    .string()
    .refine(
      (key) => isCivilDate(key) || isCivilDateTime(key),
      'Use the occurrence key from the item.',
    )
    .optional(),
});
export type TakeNotesInput = z.infer<typeof takeNotesSchema>;

type Timing = Pick<MeetingEvent, 'allDay' | 'start' | 'timeZone'>;

/** The occurrence's day in the event's own time zone, so the title is the same whoever clicks. */
export function meetingDate({ allDay, start, timeZone }: Timing): string {
  return allDay ? start : datePart(toCivil(new Date(start), timeZone));
}

/** "Team huddle · Oct 27, 2026". */
export function notesTitle(event: Timing & Pick<MeetingEvent, 'title'>): string {
  return `${event.title.trim() || '(No title)'} · ${formatDate(meetingDate(event))}`;
}

/** The organizer and the invited members: who may take notes, and who gets Can edit (MT-D1). */
export function attendeesOf(event: Pick<MeetingEvent, 'organizerId' | 'memberIds'>): string[] {
  return [...new Set([event.organizerId, ...event.memberIds])];
}

/**
 * The sections a new notes page starts with. Attendees, Video link and Your transcript come from
 * the event and the transcript, in the meeting notes block.
 */
export const NOTES_MARKDOWN = '## Agenda\n\n## Notes\n\n## Action items\n\n- [ ] \n\n## Summary\n';
