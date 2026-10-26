/**
 * Writing CSV exports (spec 3.8): UTF-8 with a byte order mark, commas, CRLF line endings, a header
 * row of property names, and a leading apostrophe on text a spreadsheet would run as a formula.
 */
import { computedKind } from '../computed';
import { parseNumberText } from '../parse-text';
import type { CalendarDate, Property, Row, View } from '../types';

/** Separators of every kind, quotes, line breaks and spaces at either end are quoted (import reads them back unchanged). */
const NEEDS_QUOTES = /[",;\t\r\n]|^\s|\s$/;

function quoteCell(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A CSV file's text: byte order mark first, values separated by commas, every line ending with CRLF. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return '\uFEFF' + rows.map((row) => `${row.map(quoteCell).join(',')}\r\n`).join('');
}

/** Starts a spreadsheet would treat as a formula, also after apostrophes already there (so unprotectCell is exact). */
const FORMULA_START = /^'*[=+@\t\r-]/;
const PROTECTED = /^'+[=+@\t\r-]/;

/**
 * Puts an apostrophe before text that starts with =, +, - or @ (and tab or carriage return) so
 * spreadsheets don't run it as a formula: "=SUM(1)" → "'=SUM(1)". In a number column
 * (`numberColumn`), numbers such as "-12" or "-$1,234.50" stay as they are.
 */
export function protectCell(text: string, numberColumn = false): string {
  if (!FORMULA_START.test(text)) return text;
  if (numberColumn && parseNumberText(text) !== null) return text;
  return `'${text}`;
}

/** Undoes protectCell when importing: "'=SUM(1)" → "=SUM(1)"; other apostrophes stay. */
export function unprotectCell(text: string): string {
  return PROTECTED.test(text) ? text.slice(1) : text;
}

const FILE_NAME_BYTES = 100;

/** One part of a file name: characters file systems refuse become spaces, cut to 100 bytes of UTF-8. */
function fileNamePart(s: string): string {
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const safe = cp < 0x20 || cp === 0x7f || '\\/:*?"<>|'.includes(ch) ? ' ' : ch;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > FILE_NAME_BYTES) break;
    out += safe;
    bytes += size;
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .trim();
}

/**
 * "QA reviews – Open – 2026-10-26.csv" for This view, "QA reviews – 2026-10-26.csv" for
 * Everything (view null). `date` is the exporter's today.
 */
export function exportFileName(
  database: { title: string },
  view: { name: string } | null,
  date: CalendarDate,
): string {
  const parts = [fileNamePart(database.title) || 'Untitled'];
  const viewName = view ? fileNamePart(view.name) : '';
  if (viewName) parts.push(viewName);
  parts.push(date);
  return `${parts.join(' – ')}.csv`;
}

/**
 * The columns of an export, Name first. This view (`view` given): its visible properties in view
 * order. Everything (null): every property in database order. Buttons hold no values and are left out.
 */
export function exportColumns(
  properties: readonly Property[],
  view: Pick<View, 'properties'> | null,
): Property[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const chosen = view
    ? view.properties.filter((s) => s.visible).map((s) => byId.get(s.propertyId))
    : properties;
  const out = properties.filter((p) => p.config.type === 'title');
  for (const p of chosen) {
    if (!p || p.config.type === 'title' || p.config.type === 'button' || out.includes(p)) continue;
    out.push(p);
  }
  return out;
}

/** Number properties and formulas or rollups with a number result keep plain negative numbers. */
function isNumberColumn(prop: Property): boolean {
  return prop.config.type === 'number' || computedKind(prop) === 'number';
}

/**
 * The table for writeCsv: a header row of property names, then one line per row with
 * `cellText(row, property)` (the value as shown, for example values.ts formatValue with
 * forExport), every cell protected from running as a formula.
 */
export function exportTable(
  columns: readonly Property[],
  rows: readonly Row[],
  cellText: (row: Row, prop: Property) => string,
): string[][] {
  const numeric = columns.map(isNumberColumn);
  return [
    columns.map((p) => protectCell(p.name)),
    ...rows.map((row) => columns.map((p, i) => protectCell(cellText(row, p), numeric[i] === true))),
  ];
}
