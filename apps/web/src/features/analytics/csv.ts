// Export CSV for every Analytics table (Analytics spec, section 2).

export type CsvCell = string | number;

/** Text that spreadsheet apps would run as a formula starts with one of these (CSV injection). */
const FORMULA_START = /^[=+@\t\r-]/;

function csvCell(value: CsvCell): string {
  let text = String(value);
  // A leading apostrophe makes spreadsheet apps show the text as it is.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180: a header row, then one line per row, each ending in CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows].map((row) => `${row.map(csvCell).join(',')}\r\n`).join('');
}

/** Saves the CSV as a file. The byte order mark makes spreadsheet apps read it as UTF-8. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download after click() returns, so the file stays a little longer.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
