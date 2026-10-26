/**
 * CSV text into a table (spec 3.7): comma, semicolon or tab separators; quoted values may hold
 * separators, doubled quotes and line breaks; CRLF or LF line endings; plus the file limits.
 */
import { LIMITS } from '../types';
import { decodeCsvBytes } from './decode';

export const CSV_SEPARATORS = [',', ';', '\t'] as const;
export type CsvSeparator = (typeof CSV_SEPARATORS)[number];

export interface ParseCsvOptions {
  /** Stop after this many records plus one, so a file that's too long is recognized without reading all of it. */
  maxRows?: number;
  /** Keep at most this many values plus one per record (the rest of the record is read but dropped). */
  maxColumns?: number;
}

const QUOTE = 34;
const LF = 10;
const CR = 13;
const BOM = 0xfeff;

/** Index of the next separator or line break at or after `from` (the text's length if none). */
function fieldEnd(text: string, from: number, sep: number): number {
  let j = from;
  for (; j < text.length; j++) {
    const c = text.charCodeAt(j);
    if (c === sep || c === LF || c === CR) break;
  }
  return j;
}

const isBlankLine = (row: readonly string[]): boolean => row.length === 1 && row[0] === '';

/**
 * Splits CSV text into records of values, exactly as written (nothing is trimmed). A value that
 * starts with a double quote runs to the closing quote: separators and line breaks inside it are
 * kept (line breaks as "\n"), and "" stands for one quote. Lines end with CRLF, LF or CR.
 * A leading byte order mark and empty lines at the end are ignored; an empty line elsewhere is a
 * record with one empty value, so record numbers stay those of the file.
 */
export function parseCsv(
  text: string,
  separator: CsvSeparator,
  opts: ParseCsvOptions = {},
): string[][] {
  const maxRows = opts.maxRows ?? Infinity;
  const maxColumns = opts.maxColumns ?? Infinity;
  const sep = separator.charCodeAt(0);
  const n = text.length;
  const rows: string[][] = [];
  let i = text.charCodeAt(0) === BOM ? 1 : 0;
  while (i < n) {
    if (rows.length > maxRows) return rows;
    const row: string[] = [];
    for (;;) {
      let value: string;
      if (text.charCodeAt(i) === QUOTE) {
        value = '';
        let start = i + 1;
        for (;;) {
          const q = text.indexOf('"', start);
          if (q === -1) {
            // No closing quote: the value runs to the end of the file.
            value += text.slice(start);
            i = n;
            break;
          }
          value += text.slice(start, q);
          if (text.charCodeAt(q + 1) === QUOTE) {
            value += '"';
            start = q + 2;
            continue;
          }
          i = q + 1;
          break;
        }
        // Anything between the closing quote and the next separator is kept as written.
        const end = fieldEnd(text, i, sep);
        value += text.slice(i, end);
        i = end;
        if (value.includes('\r')) value = value.replace(/\r\n?/g, '\n');
      } else {
        const end = fieldEnd(text, i, sep);
        value = text.slice(i, end);
        i = end;
      }
      if (row.length <= maxColumns) row.push(value);
      if (text.charCodeAt(i) !== sep) break;
      i++;
    }
    if (text.charCodeAt(i) === CR) i++;
    if (text.charCodeAt(i) === LF) i++;
    rows.push(row);
  }
  while (rows.length > 0 && isBlankLine(rows[rows.length - 1] ?? [])) rows.pop();
  return rows;
}

/**
 * The separator a file most likely uses, from its first 50 records: the one that splits the most
 * records into the same number of values (at least 2). Ties go to tab, then comma, then semicolon;
 * a file with a single column gives a comma.
 */
export function detectSeparator(text: string): CsvSeparator {
  let best: CsvSeparator = ',';
  let bestShare = 0;
  let bestWidth = 1;
  for (const sep of ['\t', ',', ';'] as const) {
    const rows = parseCsv(text, sep, { maxRows: 49 }).filter((r) => r.some((v) => v.trim()));
    const widths = new Map<number, number>();
    for (const r of rows) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
    let width = 1;
    let count = 0;
    for (const [w, c] of widths) {
      if (c > count || (c === count && w > width)) {
        width = w;
        count = c;
      }
    }
    if (width < 2) continue;
    const share = count / rows.length;
    if (share > bestShare || (share === bestShare && width > bestWidth)) {
      best = sep;
      bestShare = share;
      bestWidth = width;
    }
  }
  return best;
}

const grouped = new Intl.NumberFormat('en-US');

/** "This file is larger than 10 MB." when the file is over the limit, else null. Check it before reading the file. */
export function checkCsvSize(byteLength: number): string | null {
  return byteLength > LIMITS.csvBytes
    ? `This file is larger than ${LIMITS.csvBytes / (1024 * 1024)} MB.`
    : null;
}

/**
 * The first limit a file breaks (10 MB, 20,000 rows not counting the header row, 200 columns),
 * as the message to show, or null if it fits.
 */
export function checkCsvLimits(
  table: readonly (readonly string[])[],
  byteLength: number,
  firstRowIsHeaders = true,
): string | null {
  const size = checkCsvSize(byteLength);
  if (size) return size;
  const dataRows = Math.max(0, table.length - (firstRowIsHeaders ? 1 : 0));
  if (dataRows > LIMITS.csvRows) {
    return `This file has more than ${grouped.format(LIMITS.csvRows)} rows.`;
  }
  if (table.some((r) => r.length > LIMITS.csvColumns)) {
    return `This file has more than ${grouped.format(LIMITS.csvColumns)} columns.`;
  }
  return null;
}

export type CsvFile =
  { ok: true; separator: CsvSeparator; table: string[][] } | { ok: false; error: string };

/**
 * An uploaded file, start to finish: size check, decoding, the separator (detected unless given),
 * parsing with the row and column caps, then the limits. Used by the import preview and the job.
 */
export function readCsvFile(
  bytes: Uint8Array,
  opts: { separator?: CsvSeparator; firstRowIsHeaders?: boolean } = {},
): CsvFile {
  const tooBig = checkCsvSize(bytes.length);
  if (tooBig) return { ok: false, error: tooBig };
  const text = decodeCsvBytes(bytes);
  const separator = opts.separator ?? detectSeparator(text);
  const table = parseCsv(text, separator, {
    maxRows: LIMITS.csvRows + 1,
    maxColumns: LIMITS.csvColumns,
  });
  const error = checkCsvLimits(table, bytes.length, opts.firstRowIsHeaders ?? true);
  return error ? { ok: false, error } : { ok: true, separator, table };
}
