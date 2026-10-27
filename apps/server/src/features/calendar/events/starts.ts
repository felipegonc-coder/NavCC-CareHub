import { RepeatError, occurrenceAt } from '@carehub/team-repeat';
import { toInstant } from '@carehub/team-time';
import type { EventStart } from '../../reminders';
import { seriesOf, type Schedule } from './model';

/**
 * When an event that doesn't repeat starts, or one occurrence of one that does (by its key, as
 * reminders name it). Null for an occurrence that's gone, or a key that doesn't fit the event.
 */
export function startOf(schedule: Schedule, key?: string): EventStart | null {
  const series = seriesOf(schedule);
  let start = schedule.start;
  if (series || key !== undefined) {
    if (!series || key === undefined) return null;
    try {
      const occurrence = occurrenceAt(series, key);
      if (!occurrence) return null;
      start = occurrence.start;
    } catch (error) {
      if (error instanceof RepeatError) return null;
      throw error;
    }
  }
  return schedule.allDay ? { allDay: start } : { start: toInstant(start, schedule.timeZone) };
}
