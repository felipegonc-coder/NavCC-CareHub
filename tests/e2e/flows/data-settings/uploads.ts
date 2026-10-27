import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../_support/index.js';
import { addProperty, addRow, type Database } from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';

/** A megabyte as the upload limits count it. */
export const MB = 1024 * 1024;

/** Files property settings (Databases spec, property types). */
export const filesConfig = () => ({ type: 'files' });

/** A fictional text file of exactly `bytes` bytes in the test's output folder; gives its path. */
export async function textFile(name: string, bytes: number): Promise<string> {
  const path = test.info().outputPath(name);
  await writeFile(path, Buffer.alloc(bytes, 'Fictional QA call notes, nothing real.\n'));
  return path;
}

/** Uploads a file into a Files cell: the cell → Upload → the file chooser. */
export async function uploadInto(
  screen: DatabaseScreen,
  rowId: string,
  propertyId: string,
  path: string,
): Promise<void> {
  await screen.cell(rowId, propertyId).click();
  const chooser = screen.page.waitForEvent('filechooser');
  await screen.page
    .getByRole('button', { name: /^(Upload|Upload a file|Add a file|Choose a file)$/ })
    .first()
    .click();
  await (await chooser).setFiles(path);
}

/**
 * A Files property and a row in `database`, and a file uploaded into the row through the
 * screens; the row is named after the database.
 */
export async function uploadIn(page: Page, database: Database, path: string) {
  const files = await addProperty(page, database.id, 'Attachments', filesConfig());
  const row = await addRow(page, database.id, `${database.title} row`);
  const screen = new DatabaseScreen(page, database.id);
  await screen.open();
  await uploadInto(screen, row.id, files.id, path);
  await expect(screen.cell(row.id, files.id)).toContainText(basename(path), { timeout: 60_000 });
  return { database, row };
}
