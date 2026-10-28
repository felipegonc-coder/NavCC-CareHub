import { z } from 'zod';
import { idSchema } from './values';

/**
 * The live message after a change: sent to the organizer and attendees of a changed event, and
 * to a layer's owner when sync updates it. Refetch the items query on it.
 */
export const CALENDAR_CHANGED = 'calendar.changed';

export const calendarChangedSchema = z.object({
  eventId: idSchema.optional(),
  layerId: idSchema.optional(),
});
export type CalendarChanged = z.infer<typeof calendarChangedSchema>;
