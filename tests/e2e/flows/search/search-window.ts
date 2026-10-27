import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';

/**
 * A made-up word that is unique to this run, letters only ("qakfhbmeap"). Put it in the titles a
 * test makes and in what it searches for, so the results are this test's pages and no others.
 */
export function uniqueWord(): string {
  const letters = randomUUID().replace(/-/g, '').slice(0, 8);
  return `qa${[...letters].map((hex) => String.fromCharCode(97 + parseInt(hex, 16))).join('')}`;
}

/** The two shortcuts that open search from anywhere (Search, section 6). */
export type SearchKeys = 'ControlOrMeta+K' | 'ControlOrMeta+P';

/**
 * The search window (Search, section 2): a centered dialog with a search box, filter chips under
 * it and results below; before typing it shows Recent and Recent searches.
 */
export class SearchWindow {
  readonly dialog: Locator;
  /** The search box; typing starts there as soon as the window opens. */
  readonly box: Locator;
  /** Every result row; a screen reader hears each as "Refund steps, page in Support › …". */
  readonly results: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /search/i });
    this.box = this.dialog
      .getByRole('combobox', { name: /search/i })
      .or(this.dialog.getByRole('searchbox'))
      .first();
    this.results = this.dialog.getByRole('option');
  }

  /** The result row of a page, by its title. */
  result(title: string): Locator {
    return this.dialog.getByRole('option', { name: literally(title) });
  }

  /** A list shown before typing: "Recent" (pages) or "Recent searches". */
  section(name: 'Recent' | 'Recent searches'): Locator {
    return this.dialog.getByRole('group', { name, exact: true });
  }

  /** Opens the window with a shortcut and waits for the search box to have the focus. */
  async openWith(keys: SearchKeys = 'ControlOrMeta+K') {
    await this.page.keyboard.press(keys);
    await expect(this.dialog).toBeVisible();
    await expect(this.box).toBeFocused();
  }

  /** Types into the box key by key, as a person does, without pressing Enter. */
  async type(text: string) {
    await this.box.pressSequentially(text);
  }

  /** Replaces the text in the box. */
  async searchFor(text: string) {
    await this.box.fill(text);
  }

  /**
   * Searches until the page shows up: new pages are found within 2 seconds (section 3.3), so a
   * test that has just made its pages waits for them here once, then checks what it's about.
   */
  async waitUntilFound(text: string, title: string) {
    await expect(async () => {
      await this.box.fill('');
      await this.box.fill(text);
      await expect(this.result(title)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }

  /** Esc closes the window. */
  async close() {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).toBeHidden();
  }
}

/** The link editor that Ctrl+K opens on selected text (Pages and blocks, section 3.5, Links). */
export function linkEditor(page: Page): Locator {
  return page
    .getByRole('dialog', { name: /link/i })
    .or(page.getByRole('textbox', { name: /link/i }))
    .first();
}
