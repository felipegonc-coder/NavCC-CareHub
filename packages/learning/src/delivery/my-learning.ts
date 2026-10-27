import type { CourseStatus, Id, IsoDate, IsoDateTime } from '../format/index';
import type { LearnerAssignment } from './assignments';
import type { CatalogCourse } from './catalog';
import { dueStatus, type DueStatus } from './due';
import { byText, earliestFirst, isFinished, newestFirst } from './internal';

/** One learner's progress in one course, as My learning needs it. */
export type LearnerEnrollment = {
  courseId: Id;
  status: CourseStatus;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  lastActivityAt?: IsoDateTime;
};

/** A course card on My learning. */
export type MyLearningItem<
  C extends CatalogCourse = CatalogCourse,
  E extends LearnerEnrollment = LearnerEnrollment,
> = {
  course: C;
  status: CourseStatus;
  enrollment?: E;
  assignment?: LearnerAssignment;
  dueStatus: DueStatus;
};

/** The sections of one learner's My learning page. */
export type MyLearning<
  C extends CatalogCourse = CatalogCourse,
  E extends LearnerEnrollment = LearnerEnrollment,
> = {
  continue: MyLearningItem<C, E>[];
  assigned: MyLearningItem<C, E>[];
  overdue: MyLearningItem<C, E>[];
  finished: MyLearningItem<C, E>[];
  catalog: { course: C; enrolled: boolean }[];
};

/**
 * Sorts one learner's courses into My learning. Each course lands in one section:
 * - continue: in progress, most recent activity first;
 * - assigned: assigned and not started, by due date (undated last);
 * - overdue: past the due date and not completed, passed or failed, most late first;
 * - finished: completed, passed or failed, newest first.
 *
 * `catalog` lists the listed courses, each flagged `enrolled` when it is in one of those sections.
 * Pass every published course the learner may open (listed or not) as `catalog`: courses missing
 * from it are skipped. Enrollments that haven't started and aren't assigned are ignored.
 */
export function myLearning<C extends CatalogCourse, E extends LearnerEnrollment>(
  enrollments: readonly E[],
  assignments: readonly LearnerAssignment[],
  catalog: readonly C[],
  today: IsoDate,
  options: { timeZone?: string } = {},
): MyLearning<C, E> {
  const courses = new Map(catalog.map((course) => [course.id, course] as const));
  const enrollmentFor = new Map(
    enrollments.map((enrollment) => [enrollment.courseId, enrollment] as const),
  );
  const assignmentFor = new Map(
    assignments.map((assignment) => [assignment.courseId, assignment] as const),
  );
  const courseIds = new Set([
    ...assignmentFor.keys(),
    ...enrollments
      .filter((enrollment) => enrollment.status !== 'not_started')
      .map((enrollment) => enrollment.courseId),
  ]);

  const result: MyLearning<C, E> = {
    continue: [],
    assigned: [],
    overdue: [],
    finished: [],
    catalog: [],
  };
  const shown = new Set<Id>();
  for (const courseId of courseIds) {
    const course = courses.get(courseId);
    if (!course) continue;
    shown.add(courseId);
    const enrollment = enrollmentFor.get(courseId);
    const assignment = assignmentFor.get(courseId);
    const status = enrollment?.status ?? 'not_started';
    const completedAt = isFinished(status) ? enrollment?.completedAt : undefined;
    const item: MyLearningItem<C, E> = {
      course,
      status,
      ...(enrollment && { enrollment }),
      ...(assignment && { assignment }),
      dueStatus: dueStatus(assignment?.dueDate, completedAt, today, 3, options.timeZone),
    };
    if (isFinished(status) || status === 'failed') result.finished.push(item);
    else if (item.dueStatus === 'overdue') result.overdue.push(item);
    else if (status === 'in_progress') result.continue.push(item);
    else result.assigned.push(item);
  }

  const byTitle = (a: MyLearningItem<C, E>, b: MyLearningItem<C, E>) =>
    byText(a.course.title, b.course.title) || byText(a.course.id, b.course.id);
  const byDueDate = (a: MyLearningItem<C, E>, b: MyLearningItem<C, E>) =>
    earliestFirst(a.assignment?.dueDate, b.assignment?.dueDate) || byTitle(a, b);
  const lastActive = (item: MyLearningItem<C, E>) =>
    item.enrollment?.lastActivityAt ?? item.enrollment?.startedAt;
  const finishedAt = (item: MyLearningItem<C, E>) =>
    item.enrollment?.completedAt ?? lastActive(item);
  result.continue.sort((a, b) => newestFirst(lastActive(a), lastActive(b)) || byTitle(a, b));
  result.assigned.sort(byDueDate);
  result.overdue.sort(byDueDate);
  result.finished.sort((a, b) => newestFirst(finishedAt(a), finishedAt(b)) || byTitle(a, b));
  result.catalog = catalog
    .filter((course) => course.settings.catalog.listed)
    .map((course) => ({ course, enrolled: shown.has(course.id) }));
  return result;
}
