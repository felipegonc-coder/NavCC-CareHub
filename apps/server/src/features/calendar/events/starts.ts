import { RepeatError, occurrenceAt, type Civil } from '@carehub/team-repeat';
import { isCivilDate, toInstant } from '@carehub/team-time';
import type { EventStart } from '../../reminders';
import { seriesOf, type EventFields, type Schedule } from './model';

/** One occurrence as it is now: Calendar's key for it (null when the event doesn't repeat). */
export type FoundOccurrence = { key: string | null; start: Civil; changes: Partial<EventFields> };

/**
 * An event that doesn't repeat, or one occurrence of one that does (by its key), moved or not,
 * with the fields changed for it alone. Null for an occurrence that's gone, or a key that doesn't
 * fit the event.
 */
export function occurrenceOf(schedule: Schedule, key?: string): FoundOccurrence | null {
  const series = seriesOf(schedule);
  if (!series) return key === undefined ? { key: null, start: schedule.start, changes: {} } : null;
  if (key === undefined) return null;
  try {
    const occurrence = occurrenceAt(series, key);
    if (!occurrence) return null;
    return { key: occurrence.key, start: occurrence.start, changes: occurrence.changes ?? {} };
  } catch (error) {
    if (error instanceof RepeatError) return null;
    throw error;
  }
}

/**
 * When an event that doesn't repeat starts, or one occurrence of one that does (by its key, as
 * reminders name it), or null. A moved occurrence can be all-day in a timed series (or the other
 * way round), so the start's own kind decides.
 */
export function startOf(schedule: Schedule, key?: string): EventStart | null {
  const found = occurrenceOf(schedule, key);
  if (!found) return null;
  const { start } = found;
  return isCivilDate(start) ? { allDay: start } : { start: toInstant(start, schedule.timeZone) };
}
