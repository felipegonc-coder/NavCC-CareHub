import { readFile } from 'node:fs/promises';
import type { Download, Locator } from '@playwright/test';
import { DEFAULT_TIME_ZONE, expect } from '../_support/index.js';
import type { DatabaseScreen } from './database-page.js';

// CSV in and out of a database through "…" in its toolbar (Databases spec 3.7 and 3.8). The two
// dialogs have no test hooks in decision 0200, so they are found by the spec's words: an Export
// dialog with "This view" and "Everything", and an Import dialog with a file box and a preview.

/** Today as an export's file name has it, such as 2026-10-26, in the seeded people's time zone. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** "…" → Export CSV → "This view" or "Everything" → Export; resolves with the downloaded file. */
export async function exportCsv(
  screen: DatabaseScreen,
  scope: 'This view' | 'Everything',
): Promise<Download> {
  await screen.more('Export CSV');
  const dialog = screen.page.getByRole('dialog', { name: /Export/ });
  await dialog.getByRole('radio', { name: scope }).check();
  const [download] = await Promise.all([
    screen.page.waitForEvent('download', { timeout: 30_000 }),
    dialog
      .getByRole('button', { name: /^Export/ })
      .last()
      .click(),
  ]);
  return download;
}

/** The bytes of a downloaded file. */
export async function fileBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error(`${download.suggestedFilename()} didn't finish downloading.`);
  return readFile(path);
}

/** The button that starts an import, such as "Import" or "Import 50 rows". */
export function importButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: /^Import\b/ }).last();
}

/** "…" → Import CSV → a file the test made; resolves with the dialog once its preview is ready. */
export async function importCsv(
  screen: DatabaseScreen,
  fileName: string,
  contents: string | Buffer,
): Promise<Locator> {
  await screen.more('Import CSV');
  const dialog = screen.page.getByRole('dialog', { name: /Import/ });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/csv',
    buffer: typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents,
  });
  await expect(importButton(dialog)).toBeEnabled({ timeout: 15_000 });
  return dialog;
}

/** A cell as CSV writes it: quoted when it holds a comma, a quote or a line break. */
function quoted(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** CSV text for rows of cells, each line ending in CRLF. */
export function toCsv(rows: string[][]): string {
  return rows.map((cells) => `${cells.map(quoted).join(',')}\r\n`).join('');
}

/** Rows of cells from CSV text (quotes, doubled quotes, CRLF or LF), without a leading BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i);
    if (inQuotes && char === '"' && input.charAt(i + 1) === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes || (char !== ',' && char !== '\r' && char !== '\n')) {
      cell += char;
    } else {
      cells.push(cell);
      cell = '';
      if (char !== ',') {
        rows.push(cells);
        cells = [];
        if (char === '\r' && input.charAt(i + 1) === '\n') i++;
      }
    }
  }
  if (cell !== '' || cells.length > 0) rows.push([...cells, cell]);
  return rows;
}
