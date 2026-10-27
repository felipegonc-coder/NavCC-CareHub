// Spreadsheet text (CSV) reading for the question import. Not exported from the package.

/** Cell separators the import understands: comma, semicolon (spreadsheets in many European locales) and tab. */
export type CsvSeparator = ',' | ';' | '\t';

export const CSV_SEPARATORS: readonly CsvSeparator[] = [',', ';', '\t'];

/** Rows of cells. `unclosedQuoteRow` is set when a quoted cell never ends (that row and the rest are left out). */
export type CsvTable = { rows: string[][]; unclosedQuoteRow?: number };

/**
 * Reads CSV text (RFC 4180, leniently): cells in double quotes may hold separators, line breaks and doubled
 * quotes (""); quotes elsewhere are kept as typed. Rows end at CRLF, LF or CR. A leading byte order mark is
 * skipped. Row n of the result is row n + 1 of the spreadsheet. Reads at most `maxRows` rows.
 */
export function readCsv(
  text: string,
  separator: CsvSeparator,
  maxRows = Number.POSITIVE_INFINITY,
): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let canOpenQuote = true; // nothing but spaces in the cell so far
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = '';
    canOpenQuote = true;
  };
  while (i < text.length && rows.length < maxRows) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && canOpenQuote) {
      quoted = true;
      canOpenQuote = false;
      cell = '';
    } else if (ch === separator) {
      row.push(cell);
      cell = '';
      canOpenQuote = true;
    } else if (ch === '\n' || ch === '\r') {
      endRow();
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      cell += ch;
      if (ch !== ' ') canOpenQuote = false;
    }
    i++;
  }
  if (quoted) return { rows, unclosedQuoteRow: rows.length + 1 };
  if (rows.length < maxRows && (cell !== '' || row.length > 0)) endRow();
  return { rows };
}

/** The separator whose first row has the most cells `isKnown` accepts (ties: more cells, then comma). */
export function detectSeparator(text: string, isKnown: (cell: string) => boolean): CsvSeparator {
  let best: CsvSeparator = ',';
  let bestScore = [-1, -1];
  for (const separator of CSV_SEPARATORS) {
    const cells = readCsv(text, separator, 1).rows[0] ?? [];
    const score = [cells.filter((cell) => isKnown(cell)).length, cells.length];
    if (
      (score[0] as number) > (bestScore[0] as number) ||
      (score[0] === bestScore[0] && (score[1] as number) > (bestScore[1] as number))
    ) {
      best = separator;
      bestScore = score;
    }
  }
  return best;
}

/** A cell as the import reads it: trimmed, without the apostrophe that marks a formula-like cell as text. */
export function cellText(cell: string | undefined): string {
  const text = (cell ?? '').trim();
  return /^'[=+\-@\t\r]/.test(text) ? text.slice(1).trim() : text;
}
