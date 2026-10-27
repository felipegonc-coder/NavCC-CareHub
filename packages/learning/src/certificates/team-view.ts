import { toCsv, type CsvColumn, type TeamViewEntry } from '../reports/index';

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
