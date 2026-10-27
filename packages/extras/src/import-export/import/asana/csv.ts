// A CSV reader for Asana's export (RFC 4180): cells between commas, quoted when they hold commas,
// quotes or line breaks, with "" for a quote, and records on lines that end in CRLF, LF or CR. A
// byte order mark at the start is dropped, and blank lines are skipped. It stops at once past its
// limits, so a file can't make more than an import keeps. Stray quotes inside a cell are kept as
// typed, as spreadsheet apps do.
import { ImportFileError } from '../plan';

export interface CsvLimits {
  /** Most records, the header included. */
  records: number;
  /** Most cells in a record. */
  cells: number;
  /** Most characters in a cell. */
  cellChars: number;
}

export const OPEN_QUOTE = 'a quote in the CSV file is never closed';

/** Where the cell starting at `from` ends: at the next comma, line break, or the end. */
function cellEnd(text: string, from: number): number {
  for (let at = from; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 44 || code === 10 || code === 13) return at;
  }
  return text.length;
}

/** The records of a CSV file, each a list of its cells. Throws ImportFileError past `limits`. */
export function readCsv(text: string, limits: CsvLimits): string[][] {
  const tooLong = () =>
    new ImportFileError(
      `CSV cells can have up to ${limits.cellChars.toLocaleString('en-US')} characters`,
    );
  const records: string[][] = [];
  let record: string[] = [];
  let at = text.startsWith('\uFEFF') ? 1 : 0;
  for (;;) {
    let cell = '';
    if (text[at] === '"') {
      at += 1;
      for (;;) {
        const quote = text.indexOf('"', at);
        if (quote < 0) throw new ImportFileError(OPEN_QUOTE);
        cell += text.slice(at, quote);
        if (cell.length > limits.cellChars) throw tooLong();
        at = quote + 1;
        if (text[at] !== '"') break;
        cell += '"';
        at += 1;
      }
    }
    const end = cellEnd(text, at);
    cell += text.slice(at, end);
    if (cell.length > limits.cellChars) throw tooLong();
    at = end;
    record.push(cell);
    if (record.length > limits.cells) {
      throw new ImportFileError(
        `CSV rows can have up to ${limits.cells.toLocaleString('en-US')} cells`,
      );
    }
    if (text[at] === ',') {
      at += 1;
      continue;
    }
    if (record.length > 1 || record[0] !== '') {
      if (records.length >= limits.records) {
        const rows = (limits.records - 1).toLocaleString('en-US');
        throw new ImportFileError(`databases can have up to ${rows} rows`);
      }
      records.push(record);
    }
    record = [];
    if (at >= text.length) return records;
    at += text[at] === '\r' && text[at + 1] === '\n' ? 2 : 1;
    if (at >= text.length) return records;
  }
}
