import type { ImportCounts } from './api';
import type { ImportProblem } from './plan';

// The words of the progress panel and the summary (Import and export spec, sections 2 and 6).

const number = (count: number) => count.toLocaleString('en-US');

const counted = (count: number, one: string, many: string) =>
  `${number(count)} ${count === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
function listOf(parts: string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The parts of a count that aren't zero (pages always). */
function countParts(counts: ImportCounts): string[] {
  const parts = [counted(counts.pages, 'page', 'pages')];
  if (counts.databases > 0) parts.push(counted(counts.databases, 'database', 'databases'));
  if (counts.rows > 0) parts.push(counted(counts.rows, 'row', 'rows'));
  if (counts.files > 0) parts.push(counted(counts.files, 'file', 'files'));
  return parts;
}

/** "Imported 1,204 pages, 6 databases, 4,310 rows and 890 files into Support." */
export function importSummary(counts: ImportCounts, into: string): string {
  return `Imported ${listOf(countParts(counts))} into ${into}.`;
}

/** "Importing notion-export.zip · 312 of 1,204 pages" */
export function progressLine(fileName: string, done: number, total: number): string {
  return `Importing ${fileName} · ${number(done)} of ${counted(total, 'page', 'pages')}`;
}

/** "3 problems" */
export const problemsLabel = (count: number) => counted(count, 'problem', 'problems');

/** What a screen reader hears at the end: "Import finished. 1,204 pages, 3 problems." */
export function finishedAnnouncement(counts: ImportCounts, problemCount: number): string {
  const parts = countParts(counts);
  if (problemCount > 0) parts.push(problemsLabel(problemCount));
  return `Import finished. ${parts.join(', ')}.`;
}

/** Progress is announced every 25%: the quarter `done` of `total` has reached (0 to 4). */
export function progressQuarter(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(4, Math.floor((done / total) * 4));
}

/** A CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The problem list as CSV, for "Download as CSV". */
export function problemsCsv(problems: readonly ImportProblem[]): string {
  const lines = [['File', 'What happened', 'Why'].join(',')];
  for (const problem of problems) {
    lines.push([problem.file, problem.what, problem.why].map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
