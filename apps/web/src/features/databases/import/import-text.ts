/** Words people read in the Import CSV dialog (spec 3.7). */
import type { CsvSeparator } from '@carehub/databases/csv';

const grouped = new Intl.NumberFormat('en-US');
const n = (count: number) => grouped.format(count);

export const IMPORT_TEXT = {
  intro: 'Imports only add rows; they never change existing ones.',
  file: 'CSV or Excel file',
  fileHint: '.csv, .tsv or .xlsx, up to 10 MB, 20,000 rows and 200 columns.',
  fileType: 'Choose a .csv, .tsv or .xlsx file.',
  empty: 'This file is empty.',
  unreadable: "This file couldn't be read.",
  reading: 'Reading the file…',
  updating: 'Updating the preview…',
  firstRowIsHeaders: 'First row is headers',
  separator: 'Separator',
  separators: { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab' } satisfies Record<
    CsvSeparator,
    string
  >,
  sheet: 'Sheet',
  hiddenSheet: (name: string) => `${name} (hidden)`,
  columns: 'Columns',
  newProperty: 'New property',
  skip: 'Skip',
  newName: (header: string) => `Name of the new property for ${header}`,
  newType: (header: string) => `Type of the new property for ${header}`,
  nothingToImport: 'Choose a property or New property for at least one column.',
  preview: 'Preview',
  row: 'Row',
  rowCount: (count: number) => `${n(count)} ${count === 1 ? 'row' : 'rows'} to import.`,
  firstRows: (shown: number) => `The first ${n(shown)} are shown.`,
  problems: 'Problems',
  problemColumns: ['Row', 'Column', 'Value', 'Reason'] as const,
  couldntRead: (count: number) =>
    `${n(count)} ${count === 1 ? 'value' : 'values'} couldn't be read.`,
  import: 'Import',
  cancel: 'Cancel',
  queued: 'Waiting to start…',
  importing: (fileName: string) => `Importing ${fileName}…`,
  progress: 'Import progress',
  progressCount: (done: number, total: number) => `${n(done)} of ${n(total)} rows`,
  keepWorking: 'You can close this and keep working. Open Import CSV again to see how it went.',
  stillRunning:
    'This import is taking a while. It keeps going: open Import CSV again later to see how it went.',
  failed: "The import didn't finish.",
  cancelled: 'The import was stopped.',
  noRowsAdded: 'No rows were added.',
  back: 'Back',
  close: 'Close',
  done: 'Done',
  downloadProblems: 'Download list of problems',
  undo: 'Undo import',
  /** The shell's words for rows moved to Trash. */
  undone: (count: number) => (count === 1 ? 'Moved to Trash.' : `Moved ${n(count)} rows to Trash.`),
} as const;
