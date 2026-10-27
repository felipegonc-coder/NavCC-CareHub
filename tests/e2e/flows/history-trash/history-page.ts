import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { Sidebar } from '../sidebar/sidebar-page.js';

/** The signed-in person's name, as notes and version entries show it (GET /api/auth/me). */
export async function whoIs(page: Page): Promise<string> {
  const me = await (await apiFor(page)).get<{ user: { name: string } }>('/api/auth/me');
  return me.user.name;
}

/** A confirm dialog by what it asks. */
export function confirmDialog(page: Page, asks: string | RegExp): Locator {
  return page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: asks });
}

/**
 * Version history of the open page (Page history and Trash, section 2): the preview on the left
 * and the versions on the right, newest first, each "Today, 3:12 PM · Avery Lin, Sam Ortiz".
 */
export class VersionHistory {
  readonly dialog: Locator;
  /** The versions in the list, newest first (↑ and ↓ move between them, section 6). */
  readonly versions: Locator;
  /** What the list says before the first version. */
  readonly empty: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /version history/i });
    this.versions = this.dialog.getByRole('option');
    this.empty = this.dialog.getByText('Versions appear here after the first edits.');
  }

  /** Page menu → Version history. */
  async open() {
    const menu = await new PageScreen(this.page).openPageMenu();
    await menu.getByRole('menuitem', { name: /^version history/i }).click();
    await expect(this.dialog).toBeVisible();
  }

  /** Esc closes it. */
  async close() {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).toBeHidden();
  }

  /**
   * Opens Version history until it lists `count` versions, closing it in between: automatic
   * versions are saved on the server after 2 minutes without edits (section 3.1).
   */
  async waitForVersions(count: number, timeout: number) {
    await expect(async () => {
      await this.open();
      try {
        await expect(this.versions).toHaveCount(count, { timeout: 2_000 });
      } finally {
        await this.close();
      }
    }).toPass({ timeout, intervals: [3_000] });
  }

  /**
   * Picks a version, presses Restore this version and confirms. Returns when the version is from,
   * as the confirm names it ("Oct 20, 3:00 PM"), for the note everyone sees.
   */
  async restore(version: Locator): Promise<string> {
    await version.click();
    await this.dialog.getByRole('button', { name: 'Restore this version', exact: true }).click();
    const confirm = confirmDialog(this.page, 'Replace the current page with the version from');
    await expect(confirm).toContainText(
      /Replace the current page with the version from .+\? The current page is saved as a version first\./,
    );
    const from = /the version from (.+?)\? The current page/.exec(await confirm.innerText())?.[1];
    if (!from) throw new Error("The restore confirm doesn't say which version it restores");
    await confirm.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(confirm).toBeHidden();
    // Whether the window stays open after a restore isn't specified; close it so the page shows.
    if (await this.dialog.isVisible()) await this.close();
    return from;
  }
}

/** The note people on the page see after a restore (section 3.2). */
export function restoredNote(page: Page, who: string, from: string): Locator {
  return page.getByText(literally(`${who} restored a version from ${from}.`));
}

/**
 * The Trash window (section 2), opened from the bottom of the sidebar: a search box that has the
 * focus, and the items the person can restore, each with Restore and Delete forever.
 */
export class TrashWindow {
  readonly dialog: Locator;
  readonly search: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /trash/i });
    this.search = this.dialog.getByRole('searchbox').or(this.dialog.getByRole('textbox')).first();
  }

  async open() {
    await new Sidebar(this.page).trash.click();
    await expect(this.dialog).toBeVisible();
    await expect(this.search).toBeFocused();
  }

  /** Searches Trash for some words. */
  async find(text: string) {
    await this.search.fill(text);
  }

  /** An item by its title: a list item, a row or an option, whichever the window uses. */
  item(title: string): Locator {
    return this.dialog
      .getByRole('listitem')
      .or(this.dialog.getByRole('row'))
      .or(this.dialog.getByRole('option'))
      .filter({ hasText: title });
  }

  /** What the window says when the search finds nothing. */
  get nothingMatches(): Locator {
    return this.dialog.getByText('Nothing in Trash matches.');
  }

  /** Restore on an item. */
  async restore(title: string) {
    await this.item(title)
      .first()
      .getByRole('button', { name: /^restore/i })
      .click();
  }
}

/** "Moved to Trash · Undo", shown for 8 seconds after moving something to Trash (section 3.4). */
export function movedToTrash(page: Page): { message: Locator; undo: Locator } {
  return {
    message: page.getByText(/^Moved to Trash/).first(),
    undo: page.getByRole('button', { name: 'Undo', exact: true }),
  };
}
