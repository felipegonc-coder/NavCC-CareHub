import type { CourseStatus, Id, IsoDate } from '../format/index';
import { addDays } from '../util/index';
import { byText, dayOf, instant, isFinished } from '../delivery/internal';
import {
  daysOverdue,
  percentOf,
  roundedMean,
  type EnrollmentRow,
  type ReportOptions,
} from './rows';

/** Headline numbers for a set of rows (usually one course). */
export type CourseReport = {
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  passed: number;
  failed: number;
  overdue: number;
  /** Finished (completed or passed) out of total, whole percent; 0 without rows. */
  completionPercent: number;
  /**
   * Mean score of the rows that have one (graded quizzes only, see `EnrollmentRow.score`); null if
   * none do.
   */
  averageScore: number | null;
  /** Mean active time of finished rows, whole seconds; null if none are finished. */
  averageActiveSeconds: number | null;
};

/** One group's line in the team view. */
export type TeamViewEntry = CourseReport & { groupId: Id; groupName: string; learners: number };

/** A row that is past its due date and not finished. */
export type OverdueEntry<R extends EnrollmentRow = EnrollmentRow> = R & {
  dueDate: IsoDate;
  daysOverdue: number;
};

/** Headline numbers for the reports overview. */
export type ReportsOverview = {
  learners: number;
  /** Learners with any activity in the 7 days up to and including today. */
  activeLearners: number;
  completions: number;
  completionsThisWeek: number;
  /** Passed out of passed + failed, whole percent; null without results. */
  passRate: number | null;
  overdue: number;
};

/**
 * The course report on `today`: counts per status, overdue (not finished and past the due date),
 * completion percent (finished = completed or passed), average score and average active time of
 * finished learners.
 */
export function courseReport(rows: readonly EnrollmentRow[], today: IsoDate): CourseReport {
  const count = (status: CourseStatus) => rows.filter((row) => row.status === status).length;
  const finished = rows.filter((row) => isFinished(row.status));
  return {
    total: rows.length,
    notStarted: count('not_started'),
    inProgress: count('in_progress'),
    completed: count('completed'),
    passed: count('passed'),
    failed: count('failed'),
    overdue: rows.filter((row) => daysOverdue(row, today) !== null).length,
    completionPercent: percentOf(finished.length, rows.length),
    averageScore: roundedMean(rows.flatMap((row) => (row.score === null ? [] : [row.score]))),
    averageActiveSeconds: roundedMean(finished.map((row) => row.activeSeconds)),
  };
}

/**
 * One person's courses, newest first by their latest date; courses not started yet come last, by
 * title.
 */
export function personTranscript<R extends EnrollmentRow>(rows: readonly R[]): R[] {
  const latest = (row: R) =>
    Math.max(
      ...[row.startedAt, row.lastActivityAt, row.completedAt].map((at) =>
        at ? instant(at) : -Infinity,
      ),
    );
  return [...rows].sort((a, b) => {
    const [x, y] = [latest(a), latest(b)];
    return (
      (x === y ? 0 : x > y ? -1 : 1) ||
      byText(a.courseTitle, b.courseTitle) ||
      byText(a.courseId, b.courseId)
    );
  });
}

/**
 * The course-report numbers per group, in the order of `groups`, plus how many learners each has.
 * Membership comes from each row's `groupIds`, so a learner in several groups counts in each.
 */
export function teamView(
  rows: readonly EnrollmentRow[],
  groups: readonly { id: Id; name: string }[],
  today: IsoDate,
): TeamViewEntry[] {
  return groups.map((group) => {
    const members = rows.filter((row) => row.groupIds.includes(group.id));
    const learners = new Set(members.map((row) => row.learnerId)).size;
    return { groupId: group.id, groupName: group.name, learners, ...courseReport(members, today) };
  });
}

/** Who is late on which course and by how many days, most late first. */
export function overdueList<R extends EnrollmentRow>(
  rows: readonly R[],
  today: IsoDate,
): OverdueEntry<R>[] {
  const late = rows.flatMap((row) => {
    const days = daysOverdue(row, today);
    return days === null || row.dueDate === undefined
      ? []
      : [{ ...row, dueDate: row.dueDate, daysOverdue: days }];
  });
  return late.sort(
    (a, b) =>
      b.daysOverdue - a.daysOverdue ||
      byText(a.learnerName, b.learnerName) ||
      byText(a.courseTitle, b.courseTitle),
  );
}

/**
 * Headline numbers across all rows: learners, active learners and completions in the 7 days up to
 * and including `today` (date-times read in `options.timeZone`), all completions, pass rate and
 * overdue rows.
 */
export function reportsOverview(
  rows: readonly EnrollmentRow[],
  today: IsoDate,
  options: ReportOptions = {},
): ReportsOverview {
  const weekStart = addDays(today, -6);
  const inWeek = (at: string | undefined) => {
    if (at === undefined) return false;
    const day = dayOf(at, options.timeZone);
    return day >= weekStart && day <= today;
  };
  const finished = rows.filter((row) => isFinished(row.status));
  const passed = rows.filter((row) => row.status === 'passed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const active = rows.filter((row) =>
    [row.startedAt, row.lastActivityAt, row.completedAt].some(inWeek),
  );
  return {
    learners: new Set(rows.map((row) => row.learnerId)).size,
    activeLearners: new Set(active.map((row) => row.learnerId)).size,
    completions: finished.length,
    completionsThisWeek: finished.filter((row) => inWeek(row.completedAt)).length,
    passRate: passed + failed === 0 ? null : percentOf(passed, passed + failed),
    overdue: rows.filter((row) => daysOverdue(row, today) !== null).length,
  };
}
