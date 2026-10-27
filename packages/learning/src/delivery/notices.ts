import type { Id, IsoDate } from '../format/index';
import { daysBetween } from '../util/index';
import type { ReminderKind } from './reminders';

/**
 * The wording and button of an assignment reminder; the job adds workspaceId, userId, kind and
 * sender.
 */
export type AssignmentNotice = {
  title: string;
  text: string;
  buttons: { label: string; href: string }[];
};

function relativeDay(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * The notice for one assignment reminder on `today`. The course title appears only when `canOpen`
 * is true (the person can open the course now); otherwise the text says "a new course" or "one of
 * your courses" and the button opens My learning, so a notice never names a course the person might
 * not have access to.
 */
export function assignmentNotice(
  kind: ReminderKind,
  course: { id: Id; title: string },
  options: { today: IsoDate; dueDate?: IsoDate | undefined; canOpen: boolean },
): AssignmentNotice {
  const { today, dueDate, canOpen } = options;
  const days = dueDate === undefined ? undefined : daysBetween(today, dueDate);
  const name = canOpen ? `“${course.title}”` : 'One of your courses';
  const buttons = canOpen
    ? [{ label: 'Open course', href: `/learning/courses/${encodeURIComponent(course.id)}` }]
    : [{ label: 'Open My learning', href: '/learning' }];
  switch (kind) {
    case 'assigned': {
      const lead = canOpen
        ? `You've been assigned “${course.title}”`
        : 'You have a new course to take';
      const due =
        days === undefined ? '' : `, ${days < 0 ? 'which was due' : 'due'} ${relativeDay(days)}`;
      return { title: 'New course assigned', text: `${lead}${due}.`, buttons };
    }
    case 'due_soon': {
      const when = days === undefined ? 'soon' : relativeDay(days);
      return { title: `Course due ${when}`, text: `${name} is due ${when}.`, buttons };
    }
    case 'overdue': {
      const text =
        days === undefined ? `${name} is overdue.` : `${name} was due ${relativeDay(days)}.`;
      return { title: 'Course overdue', text, buttons };
    }
  }
}
