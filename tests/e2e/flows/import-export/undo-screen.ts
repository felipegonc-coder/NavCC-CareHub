import type { Locator, Page, Request } from '@playwright/test';
import { expect } from '../_support/index.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { escaped } from './import-screen.js';

// What IE-11 needs beyond import-screen.ts: Cancel in the progress panel and Undo import in the
// summary (Import and export spec, sections 2 and 3.1), and the Trash window (Page history and
// Trash spec, section 2).

/**
 * The progress panel: "Importing <file> · 312 of 1,204 pages" with Cancel, once at least one page
 * is in. The spec doesn't give the panel a role, so this is the smallest box holding both.
 */
export function progressPanel(page: Page, fileName: string): Locator {
  const line = page.getByText(
    new RegExp(`Importing ${escaped(fileName)} · [1-9][\\d,]* of [\\d,]+ pages`),
  );
  return page
    .locator('*')
    .filter({ has: line })
    .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
    .last();
}

/** Undo import in the summary, and the dialog that asks first. */
export class UndoImport {
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /undo import/i });
  }

  /** Presses Undo import in the summary. */
  async open() {
    await this.page.getByRole('button', { name: 'Undo import', exact: true }).click();
    await expect(this.dialog).toBeVisible();
  }

  /** The pages listed in the dialog; pages changed since the import come first. */
  listed(): Locator {
    return this.dialog.getByRole('listitem');
  }

  /** "Remove them too": the pages changed since go to Trash as well. */
  removeThemToo(): Locator {
    return this.dialog.getByRole('checkbox', { name: 'Remove them too' });
  }

  /** The request Undo import sends once confirmed. Call it before `confirm()`. */
  request(): Promise<Request> {
    const sent = this.page.waitForRequest(
      (request) => request.method() !== 'GET' && request.url().includes('/api/import-export/'),
    );
    sent.catch(() => undefined);
    return sent;
  }

  /** Confirms the undo; the dialog closes. */
  async confirm() {
    await this.dialog.getByRole('button', { name: /^(Undo import|Move to Trash)$/ }).click();
    await expect(this.dialog).toBeHidden();
  }
}

/** The Trash window (sidebar bottom): a search box and the items the person can restore. */
export class TrashWindow {
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Trash' });
  }

  /** Opens Trash from the sidebar and types `text` in its search box, which has the focus. */
  async search(text: string) {
    await new Sidebar(this.page).trash.click();
    await expect(this.dialog).toBeVisible();
    await this.dialog
      .getByRole('searchbox')
      .or(this.dialog.getByRole('textbox'))
      .first()
      .fill(text);
  }

  /** The items shown that hold `text`; each item has Restore and Delete forever. */
  items(text: string): Locator {
    return this.dialog
      .getByRole('listitem')
      .or(this.dialog.getByRole('option'))
      .or(this.dialog.getByRole('row'))
      .filter({ hasText: text })
      .filter({ has: this.page.getByRole('button', { name: 'Restore', exact: true }) });
  }
}

/** What a page in Trash shows when opened by its link. */
export const IN_TRASH = 'This page is in Trash.';
