import type { Id, IsoDate, IsoDateTime } from '../format/index';
import {
  overdueList,
  toCsv,
  type CsvColumn,
  type EnrollmentRow,
  type TeamViewEntry,
} from '../reports/index';

/** One person's line in the team view. */
export type TeamMember = {
  id: Id;
  name: string;
  groupIds: readonly Id[];
  /** Their enrollments (rows counted, one per course). */
  courses: number;
  /** Courses completed or passed. */
  finished: number;
  /** Unfinished courses past their due date. */
  overdue: number;
  /** Their latest start, activity or completion in any course. */
  lastActivityAt: IsoDateTime | null;
};

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * The team view's people: one line per learner in `rows`, with their groups, courses, finished
 * courses, overdue courses on `today` and latest activity, by name (then id).
 */
export function teamMembers(rows: readonly EnrollmentRow[], today: IsoDate): TeamMember[] {
  const late = new Map<Id, number>();
  for (const row of overdueList(rows, today)) {
    late.set(row.learnerId, (late.get(row.learnerId) ?? 0) + 1);
  }
  const people = new Map<Id, TeamMember & { groups: Set<Id> }>();
  for (const row of rows) {
    const person = people.get(row.learnerId) ?? {
      id: row.learnerId,
      name: row.learnerName,
      groupIds: [],
      groups: new Set<Id>(),
      courses: 0,
      finished: 0,
      overdue: late.get(row.learnerId) ?? 0,
      lastActivityAt: null,
    };
    people.set(row.learnerId, person);
    for (const groupId of row.groupIds) person.groups.add(groupId);
    person.courses += 1;
    if (row.status === 'completed' || row.status === 'passed') person.finished += 1;
    for (const at of [row.startedAt, row.lastActivityAt, row.completedAt]) {
      const latest = person.lastActivityAt;
      if (at !== undefined && (latest === null || Date.parse(at) > Date.parse(latest))) {
        person.lastActivityAt = at;
      }
    }
  }
  return [...people.values()]
    .map(({ groups, ...person }) => ({ ...person, groupIds: [...groups] }))
    .sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The team view as CSV, one line per group in the order given: Group, Learners, Enrollments (rows
 * counted, one per learner and course), Not started, In progress, Completed, Passed, Failed,
 * Overdue, Completion %, Average score and Average time spent (minutes, finished rows only). The
 * two averages are empty when there is nothing to average.
 */
export function teamViewCsv(
  entries: readonly TeamViewEntry[],
  options: { bom?: boolean } = {},
): string {
  const minutes = (seconds: number | null) => (seconds === null ? null : Math.round(seconds / 60));
  const columns: CsvColumn<TeamViewEntry>[] = [
    { header: 'Group', value: (entry) => entry.groupName },
    { header: 'Learners', value: (entry) => entry.learners },
    { header: 'Enrollments', value: (entry) => entry.total },
    { header: 'Not started', value: (entry) => entry.notStarted },
    { header: 'In progress', value: (entry) => entry.inProgress },
    { header: 'Completed', value: (entry) => entry.completed },
    { header: 'Passed', value: (entry) => entry.passed },
    { header: 'Failed', value: (entry) => entry.failed },
    { header: 'Overdue', value: (entry) => entry.overdue },
    { header: 'Completion %', value: (entry) => entry.completionPercent },
    { header: 'Average score', value: (entry) => entry.averageScore },
    { header: 'Average time spent (minutes)', value: (e) => minutes(e.averageActiveSeconds) },
  ];
  return toCsv(columns, entries, options.bom ? { bom: true } : {});
}
