import type { CourseStatus, Id, IsoDate } from '../format/index';
import { compareDays } from '../util/index';
import type { LearnerAssignment } from './assignments';
import { byText, isFinished } from './internal';

/**
 * A learning due date for the Care Hub calendar, as `listLearningDueDates` returns it to Team
 * tools.
 */
export type LearningDueDate = {
  assignmentId: Id;
  courseId: Id;
  title: string;
  dueDate: IsoDate;
  href: string;
};

/**
 * One learner's due dates as calendar items: one per dated assignment, with the course title and a
 * link to the course. Courses the learner has finished (completed or passed, per `statusByCourse`)
 * and courses missing from `courses` are left out; `from` and `to` (inclusive) limit the days.
 * Sorted by date, then title.
 */
export function dueDateCalendarItems(
  assignments: readonly Pick<LearnerAssignment, 'assignmentId' | 'courseId' | 'dueDate'>[],
  courses: readonly { id: Id; title: string }[],
  options: {
    statusByCourse?: Readonly<Record<Id, CourseStatus>>;
    from?: IsoDate;
    to?: IsoDate;
  } = {},
): LearningDueDate[] {
  const titles = new Map(courses.map((course) => [course.id, course.title] as const));
  const { statusByCourse, from, to } = options;
  const items: LearningDueDate[] = [];
  for (const { assignmentId, courseId, dueDate } of assignments) {
    const title = titles.get(courseId);
    const status = statusByCourse?.[courseId];
    if (
      dueDate === undefined ||
      title === undefined ||
      (status !== undefined && isFinished(status))
    )
      continue;
    if (
      (from !== undefined && compareDays(dueDate, from) < 0) ||
      (to !== undefined && compareDays(dueDate, to) > 0)
    ) {
      continue;
    }
    items.push({
      assignmentId,
      courseId,
      title,
      dueDate,
      href: `/learning/courses/${encodeURIComponent(courseId)}`,
    });
  }
  return items.sort((a, b) => compareDays(a.dueDate, b.dueDate) || byText(a.title, b.title));
}
