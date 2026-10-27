import type { CourseStatus, Id, IsoDate, IsoDateTime } from '../format/index';
import { isFinished } from '../delivery/internal';
import { daysBetween } from '../util/index';

/** One learner in one course: the plain row every report is computed from. */
export type EnrollmentRow = {
  learnerId: Id;
  learnerName: string;
  groupIds: readonly Id[];
  courseId: Id;
  courseTitle: string;
  status: CourseStatus;
  /**
   * Best graded-quiz percent (mean if several quizzes; survey-mode quizzes never count), or null
   * without one.
   */
  score: number | null;
  activeSeconds: number;
  attempts: number;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  /** The learner's latest activity in the course; counts towards active learners. */
  lastActivityAt?: IsoDateTime;
  dueDate?: IsoDate;
  lastLessonId?: Id;
  required: boolean;
};

/**
 * For reports that read date-times as calendar days: the workspace time zone (IANA name, default
 * UTC).
 */
export type ReportOptions = { timeZone?: string };

/** Days past the due date for a row that isn't finished, else null. */
export function daysOverdue(
  row: Pick<EnrollmentRow, 'status' | 'dueDate'>,
  today: IsoDate,
): number | null {
  if (isFinished(row.status) || row.dueDate === undefined) return null;
  const days = daysBetween(row.dueDate, today);
  return days > 0 ? days : null;
}

/** Whole percent; 0 when `whole` is 0. */
export function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part * 100) / whole);
}

/** Rounded mean, or null when there is nothing to average. */
export function roundedMean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
