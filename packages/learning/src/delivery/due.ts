import type { IsoDate, IsoDateTime } from '../format/index';
import { daysBetween } from '../util/index';
import { dayOf } from './internal';

/** Where a course stands against its due date. */
export type DueStatus = 'none' | 'upcoming' | 'due_soon' | 'overdue' | 'done_on_time' | 'done_late';

/**
 * Due-date status on `today`. Without a due date: "none". Finished (`completedAt` set):
 * "done_on_time" if it was finished on or before the due date, else "done_late". Otherwise:
 * "overdue" after the due date, "due_soon" from `soonDays` days before it through the due date
 * itself, "upcoming" before that. `completedAt` is read as a calendar day in `timeZone`; pass it
 * only for finished (completed or passed) courses.
 */
export function dueStatus(
  dueDate: IsoDate | null | undefined,
  completedAt: IsoDateTime | IsoDate | null | undefined,
  today: IsoDate,
  soonDays = 3,
  timeZone = 'UTC',
): DueStatus {
  if (!dueDate) return 'none';
  if (completedAt) return dayOf(completedAt, timeZone) <= dueDate ? 'done_on_time' : 'done_late';
  const daysLeft = daysBetween(today, dueDate);
  if (daysLeft < 0) return 'overdue';
  return daysLeft <= soonDays ? 'due_soon' : 'upcoming';
}
