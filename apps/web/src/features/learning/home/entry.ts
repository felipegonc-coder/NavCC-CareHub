import type { IsoDate, IsoDateTime, MyLearningEntry } from '@carehub/learning';

// What a My learning card says about the learner's place in a course and its due date.

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dueDayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A due date (a calendar day, the same everywhere): "31 Oct 2026" in the browser's language. */
export const formatDueDate = (date: IsoDate): string =>
  dueDayFormat.format(new Date(`${date}T00:00:00Z`));

/** The day something happened, in the browser's time zone and language. */
export const formatDay = (at: IsoDateTime): string => dayFormat.format(new Date(at));

/** The learner's place in the course: "Not started", "40% done", "Passed on 12 Oct 2026". */
export function entryStatus(entry: MyLearningEntry): string {
  const on = entry.completedAt ? ` on ${formatDay(entry.completedAt)}` : '';
  switch (entry.status) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return `${entry.progressPercent}% done`;
    case 'completed':
      return `Completed${on}`;
    case 'passed':
      return `Passed${on}`;
    case 'failed':
      return 'Not passed';
  }
}

/** The due date in a few words, or null when there's nothing to say about it. */
export function dueLine(entry: MyLearningEntry): string | null {
  if (!entry.dueDate) return null;
  const day = formatDueDate(entry.dueDate);
  switch (entry.dueStatus) {
    case 'upcoming':
      return `Due ${day}`;
    case 'due_soon':
      return `Due soon: ${day}`;
    case 'overdue':
      return `Overdue: it was due ${day}`;
    case 'done_late':
      return `Finished after the due date (${day})`;
    default:
      return null;
  }
}
