/**
 * One worksheet as the table of cell text CSV parsing gives (spec 3.7), so the CSV import plan
 * does the rest (matching columns, types, preview, problems). Shared and inline strings, numbers,
 * TRUE and FALSE, errors as their text (#N/A), formulas as their saved results, dates as ISO
 * text, and "" for empty cells. Cells keep their columns (A and C give ["a", "", "c"]) and rows
 * keep their numbers, so problem rows match Excel's. Empty cells after a row's last value and
 * empty rows after the last one are left out, like the end of a CSV file.
 */
import { checkCsvLimits } from '../csv/parse';
import { LIMITS } from '../types';
import { numberText, serialText, type DateStyle } from './numfmt';
import {
  cleanCellText,
  failureMessage,
  listSheets,
  noSuchSheet,
  openXlsx,
  readPart,
  RichText,
  type XlsxFile,
  type XlsxSheet,
} from './workbook';
import { xmlTokens } from './xml';
import type { InflateRaw } from './zip';

/** Rows kept: one more than a file with a header row may have, so checkCsvLimits sees too many either way. */
const MAX_ROWS = LIMITS.csvRows + 2;
/** Columns kept: one more than allowed, so checkCsvLimits sees too many. */
const MAX_COLUMNS = LIMITS.csvColumns + 1;
const EXCEL_ROWS = 1_048_576;
const EXCEL_COLUMNS = 16_384;

/** The 0-based column of a cell reference ("A1" is 0, "AB7" is 27), or null if it has no column letters. */
export function columnIndex(ref: string): number | null {
  const letters = /^[A-Z]{1,3}(?=\d|$)/i.exec(ref)?.[0];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n <= EXCEL_COLUMNS ? n - 1 : null;
}

interface Cell {
  /** The t attribute: n (number, the default), s, inlineStr, str (formula text), b, e or d (ISO date). */
  type: string;
  style: DateStyle | null;
  /** Text of <v>, null when there's none (a formula that was never calculated, an empty cell). */
  value: string | null;
  inline: RichText | null;
}

/** A t="d" value ("2026-10-26T14:30:00Z", as some programs save dates) as import text; the zone is dropped. */
function isoText(v: string, style: DateStyle | null): string {
  const r = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!r?.[1]) return v;
  const time = r[2] ? `${r[2]}${r[3] && r[3] !== '00' ? `:${r[3]}` : ''}` : '00:00';
  if (style === 'time' || style === 'duration') return time;
  return style === 'datetime' || (style !== 'date' && time !== '00:00') ? `${r[1]} ${time}` : r[1];
}

function cellText(cell: Cell, file: XlsxFile): string {
  const v = cell.value?.trim() ?? '';
  switch (cell.type) {
    case 's':
      return v ? (file.strings[Number(v)] ?? '') : '';
    case 'inlineStr':
      return cell.inline?.done() ?? cleanCellText(cell.value ?? '');
    case 'str':
      return cleanCellText(cell.value ?? '');
    case 'b':
      return v ? (v === '1' || v.toLowerCase() === 'true' ? 'TRUE' : 'FALSE') : '';
    case 'e':
      return v;
    case 'd':
      return v ? isoText(v, cell.style) : '';
    default:
      if (!v) return '';
      return (cell.style && serialText(Number(v), cell.style, file.date1904)) ?? numberText(v);
  }
}

function sheetTable(xml: string, file: XlsxFile): string[][] {
  const table: string[][] = [];
  let row: string[] = [];
  let rowIndex = -1;
  let col = -1;
  let cell: Cell | null = null;
  let inValue = false;
  let inData = false;
  /** Puts the finished row in place; false once a row is past MAX_ROWS (the table is then padded to it). */
  const endRow = (): boolean => {
    if (row.length) {
      if (rowIndex >= MAX_ROWS) {
        while (table.length < MAX_ROWS) table.push([]);
        return false;
      }
      while (table.length < rowIndex) table.push([]);
      table[rowIndex] = row;
    }
    row = [];
    return true;
  };
  const endCell = (c: Cell): void => {
    const text = cellText(c, file);
    if (!text) return;
    const at = Math.min(col, MAX_COLUMNS - 1);
    while (row.length < at) row.push('');
    row[at] = text;
  };
  for (const tok of xmlTokens(xml)) {
    if (tok.kind === 'text') {
      if (inValue && cell) cell.value = (cell.value ?? '') + tok.text;
      else cell?.inline?.take(tok);
    } else if (!inData) {
      inData = tok.kind === 'open' && tok.name === 'sheetData' && !tok.selfClosing;
    } else if (tok.kind === 'close') {
      if (tok.name === 'v') inValue = false;
      else if (tok.name === 'c' && cell) {
        endCell(cell);
        cell = null;
      } else if (tok.name === 'row' && !endRow()) return table;
      else if (tok.name === 'sheetData') break;
      else cell?.inline?.take(tok);
    } else if (tok.name === 'row') {
      const r = Number(tok.attrs.get('r'));
      rowIndex = Number.isInteger(r) && r >= 1 && r <= EXCEL_ROWS ? r - 1 : rowIndex + 1;
      col = -1;
      if (tok.selfClosing && !endRow()) return table;
    } else if (tok.name === 'c') {
      col = columnIndex(tok.attrs.get('r') ?? '') ?? col + 1;
      const style = file.styles[Number(tok.attrs.get('s') ?? 0)] ?? null;
      cell = { type: tok.attrs.get('t') ?? 'n', style, value: null, inline: null };
      if (tok.selfClosing) {
        endCell(cell);
        cell = null;
      }
    } else if (tok.name === 'v' && cell) {
      inValue = !tok.selfClosing;
      cell.value ??= '';
    } else if (tok.name === 'is' && cell) {
      cell.inline = new RichText();
    } else {
      cell?.inline?.take(tok);
    }
  }
  endRow();
  return table;
}

export type XlsxTable = { ok: true; table: string[][] } | { ok: false; error: string };

/**
 * One worksheet of an opened workbook as rows of cell text, with the CSV limits and messages
 * (20,000 rows not counting the header row, 200 columns). The sheet is picked by its exact name.
 */
export function readSheet(
  file: XlsxFile,
  sheetName: string,
  opts: { firstRowIsHeaders?: boolean | undefined } = {},
): XlsxTable {
  const entry = file.parts.get(sheetName);
  if (!entry) return { ok: false, error: noSuchSheet(sheetName) };
  try {
    const table = sheetTable(readPart(file, entry), file);
    const error = checkCsvLimits(table, file.byteLength, opts.firstRowIsHeaders ?? true);
    return error ? { ok: false, error } : { ok: true, table };
  } catch (e) {
    return { ok: false, error: failureMessage(e) };
  }
}

/** The sheet picked by default: the first that isn't hidden (the first of all if every one is). */
export function firstVisibleSheet(sheets: readonly XlsxSheet[]): string {
  return (sheets.find((s) => !s.hidden) ?? sheets[0])?.name ?? '';
}

export interface ReadXlsxOptions {
  /** The server's inflater (see InflateRaw). */
  inflateRaw: InflateRaw;
  /** The sheet to read; default: firstVisibleSheet. */
  sheet?: string | undefined;
  /** "First row is headers" (on by default), for the row limit. */
  firstRowIsHeaders?: boolean | undefined;
}

export type XlsxRead =
  | { ok: true; sheets: XlsxSheet[]; sheet: string; table: string[][] }
  /** `sheets` is there when the workbook itself opened, so another sheet can be picked. */
  | { ok: false; error: string; sheets?: XlsxSheet[] };

/**
 * An uploaded .xlsx file, start to finish, like readCsvFile: the 10 MB limit, unzipping, the sheet
 * list, then the chosen sheet as a table for the CSV import plan. Used by the preview and the job.
 */
export function readXlsxFile(bytes: Uint8Array, opts: ReadXlsxOptions): XlsxRead {
  const opened = openXlsx(bytes, opts.inflateRaw);
  if (!opened.ok) return opened;
  const sheets = listSheets(opened.file);
  const sheet = opts.sheet ?? firstVisibleSheet(sheets);
  const read = readSheet(opened.file, sheet, { firstRowIsHeaders: opts.firstRowIsHeaders });
  return read.ok
    ? { ok: true, sheets, sheet, table: read.table }
    : { ok: false, error: read.error, sheets };
}
