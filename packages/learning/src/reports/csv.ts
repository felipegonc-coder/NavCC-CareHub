import type { CourseStatus, IsoDate, IsoDateTime } from '../format/index';
import { byText, dayOf } from '../delivery/internal';
import type { CourseReport, OverdueEntry } from './course-report';
import { daysOverdue, type EnrollmentRow, type ReportOptions } from './rows';

/** A CSV cell. Numbers are written as they are; null and undefined are empty. */
export type CsvCell = string | number | null | undefined;

/** A CSV column: its header and how to read a row's cell. */
export type CsvColumn<T> = { header: string; value: (row: T) => CsvCell };

const FORMULA_START = /^[=+@\t\r-]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

const STATUS_LABELS: Record<CourseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
};

function field(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * RFC 4180 CSV: a header line, then one line per row, each ending in CRLF. Fields with a comma,
 * quote, CR, LF or leading or trailing space are quoted, with inner quotes doubled. Text starting
 * with =, +, -, @, tab or CR gets a leading ' so spreadsheets don't run it as a formula. `bom` adds
 * a UTF-8 byte order mark (for Excel).
 */
export function toCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
  options: { bom?: boolean } = {},
): string {
  const lines = [columns.map((column) => field(column.header))];
  for (const row of rows) lines.push(columns.map((column) => field(column.value(row))));
  return (options.bom ? '\uFEFF' : '') + lines.map((cells) => `${cells.join(',')}\r\n`).join('');
}

/**
 * The course report as CSV, one line per learner sorted by name, including people who haven't
 * started. Started and Completed are calendar days in `options.timeZone`; Days overdue is empty
 * unless the learner is late.
 */
export function courseReportCsv(
  rows: readonly EnrollmentRow[],
  today: IsoDate,
  options: ReportOptions & { bom?: boolean } = {},
): string {
  const day = (at: IsoDateTime | undefined) =>
    at === undefined ? null : dayOf(at, options.timeZone);
  const columns: CsvColumn<EnrollmentRow>[] = [
    { header: 'Name', value: (row) => row.learnerName },
    { header: 'Status', value: (row) => STATUS_LABELS[row.status] },
    { header: 'Score', value: (row) => (row.score === null ? null : Math.round(row.score)) },
    { header: 'Time spent (minutes)', value: (row) => Math.round(row.activeSeconds / 60) },
    { header: 'Attempts', value: (row) => row.attempts },
    { header: 'Started', value: (row) => day(row.startedAt) },
    { header: 'Completed', value: (row) => day(row.completedAt) },
    { header: 'Due', value: (row) => row.dueDate },
    { header: 'Days overdue', value: (row) => daysOverdue(row, today) },
  ];
  const sorted = [...rows].sort(
    (a, b) => byText(a.learnerName, b.learnerName) || byText(a.learnerId, b.learnerId),
  );
  return toCsv(columns, sorted, options.bom ? { bom: true } : {});
}

const minutes = (seconds: number | null) => (seconds === null ? null : Math.round(seconds / 60));

/** One course's line in the reports overview. */
type OverviewLine = { courseTitle: string; report: CourseReport };

/**
 * The reports overview as CSV, one line per course in the order given: Course, Learners, Not
 * started, In progress, Completed, Passed, Failed, Overdue, Completion %, Average score and Average
 * time spent (minutes, finished learners only). The two averages are empty when there is nothing
 * to average.
 */
export function reportsOverviewCsv(
  courses: readonly OverviewLine[],
  options: { bom?: boolean } = {},
): string {
  const columns: CsvColumn<OverviewLine>[] = [
    { header: 'Course', value: (line) => line.courseTitle },
    { header: 'Learners', value: (line) => line.report.total },
    { header: 'Not started', value: (line) => line.report.notStarted },
    { header: 'In progress', value: (line) => line.report.inProgress },
    { header: 'Completed', value: (line) => line.report.completed },
    { header: 'Passed', value: (line) => line.report.passed },
    { header: 'Failed', value: (line) => line.report.failed },
    { header: 'Overdue', value: (line) => line.report.overdue },
    { header: 'Completion %', value: (line) => line.report.completionPercent },
    { header: 'Average score', value: (line) => line.report.averageScore },
    {
      header: 'Average time spent (minutes)',
      value: (line) => minutes(line.report.averageActiveSeconds),
    },
  ];
  return toCsv(columns, courses, options.bom ? { bom: true } : {});
}

/**
 * The overdue list as CSV, one line per late learner and course in the order given (most late
 * first from `overdueList`): Name, Course, Status, Due and Days overdue.
 */
export function overdueListCsv(
  entries: readonly OverdueEntry[],
  options: { bom?: boolean } = {},
): string {
  const columns: CsvColumn<OverdueEntry>[] = [
    { header: 'Name', value: (entry) => entry.learnerName },
    { header: 'Course', value: (entry) => entry.courseTitle },
    { header: 'Status', value: (entry) => STATUS_LABELS[entry.status] },
    { header: 'Due', value: (entry) => entry.dueDate },
    { header: 'Days overdue', value: (entry) => entry.daysOverdue },
  ];
  return toCsv(columns, entries, options.bom ? { bom: true } : {});
}
