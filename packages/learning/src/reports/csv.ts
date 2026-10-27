import type { CourseStatus, IsoDate, IsoDateTime } from '../format/index';
import { byText, dayOf } from '../delivery/internal';
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
