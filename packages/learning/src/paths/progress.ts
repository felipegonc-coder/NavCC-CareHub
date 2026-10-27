import type { CourseStatus, Id, LearningPath } from '../format/index';

/** Overall state of a learner on a learning path. */
export type PathStatus = 'not_started' | 'in_progress' | 'completed';

/** A learner's progress through one learning path. */
export type PathProgress = {
  /** Courses completed or passed. */
  completed: number;
  total: number;
  /** completed / total × 100, rounded down. */
  percent: number;
  /** The first course in path order that isn't completed or passed; null when all are. */
  nextCourseId: Id | null;
  status: PathStatus;
  /** Sequential paths: every course after the first unfinished one. Free paths: none. */
  lockedCourseIds: Id[];
};

/** A course's status by course id, as a Map or a plain record. Missing courses count as not started. */
export type StatusByCourse = ReadonlyMap<Id, CourseStatus> | Readonly<Record<Id, CourseStatus>>;

const isFinished = (status: CourseStatus): boolean => status === 'completed' || status === 'passed';

function statusOf(statusByCourse: StatusByCourse, courseId: Id): CourseStatus {
  if (statusByCourse instanceof Map) return statusByCourse.get(courseId) ?? 'not_started';
  const record = statusByCourse as Readonly<Record<Id, CourseStatus>>;
  return Object.hasOwn(record, courseId) ? (record[courseId] ?? 'not_started') : 'not_started';
}

/**
 * Progress through a learning path from each course's status. Completed and passed courses count
 * as done; a failed course is the next course until it is finished.
 */
export function pathProgress(
  path: Pick<LearningPath, 'courseIds' | 'order'>,
  statusByCourse: StatusByCourse,
): PathProgress {
  const courseIds = [...new Set(path.courseIds)];
  const statuses = courseIds.map((id) => statusOf(statusByCourse, id));
  const completed = statuses.filter(isFinished).length;
  const total = courseIds.length;
  const firstUnfinished = statuses.findIndex((status) => !isFinished(status));
  const started = statuses.some((status) => status !== 'not_started');
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.floor((completed * 100) / total),
    nextCourseId: firstUnfinished < 0 ? null : (courseIds[firstUnfinished] ?? null),
    status:
      total > 0 && completed === total ? 'completed' : started ? 'in_progress' : 'not_started',
    lockedCourseIds:
      path.order === 'sequential' && firstUnfinished >= 0
        ? courseIds.slice(firstUnfinished + 1)
        : [],
  };
}
