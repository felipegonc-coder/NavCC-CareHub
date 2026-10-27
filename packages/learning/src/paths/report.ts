import type { CourseStatus, Id, IsoDateTime, LearningPath } from '../format/index';
import { toCsv, type CsvColumn, type EnrollmentRow, type ReportOptions } from '../reports/index';
import { isoDateInTimeZone } from '../util/index';
import { pathProgress, type PathStatus } from './progress';

/** What the path report reads from each enrollment row; an `EnrollmentRow` fits. */
export type PathEnrollment = Pick<
  EnrollmentRow,
  'learnerId' | 'learnerName' | 'groupIds' | 'courseId' | 'status'
> &
  Partial<Pick<EnrollmentRow, 'startedAt' | 'lastActivityAt' | 'completedAt'>>;

/** One person's line in a path report. */
export type PathReportRow = {
  learnerId: Id;
  learnerName: string;
  groupIds: Id[];
  status: PathStatus;
  completed: number;
  total: number;
  /** completed / total × 100, rounded down. */
  percent: number;
  nextCourseId: Id | null;
  nextCourseTitle: string | null;
  /** Their latest activity in any course of the path. */
  lastActivityAt: IsoDateTime | null;
  /** When they finished the last of the path's courses, once they have finished them all. */
  completedAt: IsoDateTime | null;
};

/** The path report: headline numbers and one row per learner, by name. */
export type PathReport = {
  learners: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  /** Learners who finished every course, out of all learners, whole percent; 0 without learners. */
  completionPercent: number;
  rows: PathReportRow[];
};

type Person = {
  name: string;
  groupIds: Set<Id>;
  statuses: Map<Id, CourseStatus>;
  finishedAt: Map<Id, IsoDateTime>;
  lastActivityAt: IsoDateTime | null;
};

// When one person has two rows for a course, the further one counts.
const RANK: Record<CourseStatus, number> = {
  not_started: 0,
  in_progress: 1,
  failed: 2,
  completed: 3,
  passed: 3,
};
const isFinished = (status: CourseStatus) => status === 'completed' || status === 'passed';
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byText = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const later = (a: IsoDateTime | null, b: IsoDateTime | undefined): IsoDateTime | null =>
  b !== undefined && (a === null || Date.parse(b) > Date.parse(a)) ? b : a;

/**
 * The path report (GET /reports/paths/:id): one row per learner with their progress through the
 * path's courses, in path order (`courses` gives their titles; path courses not in it are left
 * out). Learners come from `rows`, their enrollments in the path's courses (rows for other courses
 * are ignored), and from `learners`, people on the path who may not have started yet. Rows are
 * sorted by name.
 */
export function pathReport(
  path: Pick<LearningPath, 'courseIds' | 'order'>,
  courses: readonly { id: Id; title: string }[],
  rows: readonly PathEnrollment[],
  learners: readonly { id: Id; name: string; groupIds?: readonly Id[] }[] = [],
): PathReport {
  const titles = new Map(courses.map((course) => [course.id, course.title] as const));
  const courseIds = [...new Set(path.courseIds)].filter((id) => titles.has(id));
  const people = new Map<Id, Person>();
  const personFor = (id: Id, name: string): Person => {
    const known = people.get(id);
    if (known) return known;
    const person: Person = {
      name,
      groupIds: new Set(),
      statuses: new Map(),
      finishedAt: new Map(),
      lastActivityAt: null,
    };
    people.set(id, person);
    return person;
  };
  for (const learner of learners) {
    const person = personFor(learner.id, learner.name);
    for (const groupId of learner.groupIds ?? []) person.groupIds.add(groupId);
  }
  for (const row of rows) {
    if (!courseIds.includes(row.courseId)) continue;
    const person = personFor(row.learnerId, row.learnerName);
    for (const groupId of row.groupIds) person.groupIds.add(groupId);
    const before = person.statuses.get(row.courseId);
    if (before === undefined || RANK[row.status] > RANK[before]) {
      person.statuses.set(row.courseId, row.status);
      if (isFinished(row.status) && row.completedAt !== undefined) {
        person.finishedAt.set(row.courseId, row.completedAt);
      }
    }
    for (const at of [row.startedAt, row.lastActivityAt, row.completedAt]) {
      person.lastActivityAt = later(person.lastActivityAt, at);
    }
  }

  const reportRows = [...people].map(([learnerId, person]): PathReportRow => {
    const progress = pathProgress({ courseIds, order: path.order }, person.statuses);
    const finishedAt = courseIds.map((id) => person.finishedAt.get(id));
    const completedAt =
      progress.status === 'completed' && finishedAt.every((at) => at !== undefined)
        ? finishedAt.reduce<IsoDateTime | null>(later, null)
        : null;
    return {
      learnerId,
      learnerName: person.name,
      groupIds: [...person.groupIds],
      status: progress.status,
      completed: progress.completed,
      total: progress.total,
      percent: progress.percent,
      nextCourseId: progress.nextCourseId,
      nextCourseTitle:
        progress.nextCourseId === null ? null : (titles.get(progress.nextCourseId) ?? null),
      lastActivityAt: person.lastActivityAt,
      completedAt,
    };
  });
  reportRows.sort(
    (a, b) => byText(a.learnerName, b.learnerName) || byText(a.learnerId, b.learnerId),
  );
  const count = (status: PathStatus) => reportRows.filter((row) => row.status === status).length;
  const completed = count('completed');
  return {
    learners: reportRows.length,
    notStarted: count('not_started'),
    inProgress: count('in_progress'),
    completed,
    completionPercent:
      reportRows.length === 0 ? 0 : Math.round((completed * 100) / reportRows.length),
    rows: reportRows,
  };
}

const STATUS_LABELS: Record<PathStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

/**
 * The path report as CSV, one line per learner in report order: Name, Status, Courses finished,
 * Courses, Percent, Next course, Last activity and Completed. The two dates are calendar days in
 * `options.timeZone` (default UTC).
 */
export function pathReportCsv(
  report: Pick<PathReport, 'rows'>,
  options: ReportOptions & { bom?: boolean } = {},
): string {
  const day = (at: IsoDateTime | null) =>
    at === null ? null : isoDateInTimeZone(at, options.timeZone ?? 'UTC');
  const columns: CsvColumn<PathReportRow>[] = [
    { header: 'Name', value: (row) => row.learnerName },
    { header: 'Status', value: (row) => STATUS_LABELS[row.status] },
    { header: 'Courses finished', value: (row) => row.completed },
    { header: 'Courses', value: (row) => row.total },
    { header: 'Percent', value: (row) => row.percent },
    { header: 'Next course', value: (row) => row.nextCourseTitle },
    { header: 'Last activity', value: (row) => day(row.lastActivityAt) },
    { header: 'Completed', value: (row) => day(row.completedAt) },
  ];
  return toCsv(columns, report.rows, options.bom ? { bom: true } : {});
}
