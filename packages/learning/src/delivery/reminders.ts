import type { CourseStatus, IsoDate } from '../format/index';
import { daysBetween } from '../util/index';
import type { LearnerAssignment } from './assignments';
import { isFinished } from './internal';

/** The reminder messages a learner can get for an assignment. */
export type ReminderKind = 'assigned' | 'due_soon' | 'overdue';

/** A reminder that was sent, and the calendar day it went out. */
export type SentReminder = { kind: ReminderKind; on: IsoDate };

const OVERDUE_EVERY_DAYS = 3;

/**
 * The reminders to send `today` for one learner's assignment, given the ones it already sent
 * (`sentLog`): "assigned" once; "due_soon" once, on the day before the due date or on the due date
 * itself; "overdue" the day after the due date and then every 3 days. Nothing else goes out on the
 * day the "assigned" message does (so a course assigned today never gets two messages), nothing at
 * all once the course is completed or passed, and optional assignments only ever get "assigned".
 * Calling it again on the same day sends nothing new.
 */
export function remindersDue(
  assignment: Pick<LearnerAssignment, 'dueDate' | 'required'> & { status: CourseStatus },
  sentLog: readonly SentReminder[],
  today: IsoDate,
): ReminderKind[] {
  if (isFinished(assignment.status)) return [];
  const assignedOn = sentLog.find((sent) => sent.kind === 'assigned')?.on;
  if (assignedOn === undefined) return ['assigned'];
  const { dueDate } = assignment;
  if (!assignment.required || dueDate === undefined || assignedOn === today) return [];

  const due: ReminderKind[] = [];
  const daysLeft = daysBetween(today, dueDate);
  if ((daysLeft === 0 || daysLeft === 1) && !sentLog.some((sent) => sent.kind === 'due_soon')) {
    due.push('due_soon');
  }
  const lastOverdue = sentLog
    .filter((sent) => sent.kind === 'overdue')
    .map((sent) => sent.on)
    .sort()
    .at(-1);
  if (
    daysLeft < 0 &&
    (lastOverdue === undefined || daysBetween(lastOverdue, today) >= OVERDUE_EVERY_DAYS)
  ) {
    due.push('overdue');
  }
  return due;
}
