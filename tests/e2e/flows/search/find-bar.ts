import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/**
 * Find in page (Search, sections 2 and 3.5): Ctrl+F on a page opens a small bar with a search box,
 * "3 of 12", ↑ and ↓, Match case, and for editors Replace (Ctrl+H) with Replace and Replace all.
 */
export class FindBar {
  readonly bar: Locator;
  readonly box: Locator;
  /** "3 of 12"; with no match there's no such count ("0 of 0" isn't counted as one). */
  readonly count: Locator;
  readonly replaceBox: Locator;
  readonly replaceAll: Locator;

  constructor(readonly page: Page) {
    const name = /find/i;
    this.bar = page
      .getByRole('search', { name })
      .or(page.getByRole('dialog', { name }))
      .or(page.getByRole('region', { name }))
      .first();
    this.box = this.bar.getByRole('textbox', { name }).or(this.bar.getByRole('searchbox')).first();
    this.count = this.bar.getByText(/^[1-9]\d* of \d+$/);
    this.replaceBox = this.bar.getByRole('textbox', { name: /replace/i });
    this.replaceAll = this.bar.getByRole('button', { name: 'Replace all', exact: true });
  }

  /** Ctrl+F, with the focus somewhere on the page. */
  async open() {
    await this.page.keyboard.press('ControlOrMeta+F');
    await expect(this.bar).toBeVisible();
    await expect(this.box).toBeFocused();
  }

  /** Esc closes it, with the cursor at the current match. */
  async close() {
    await this.page.keyboard.press('Escape');
    await expect(this.bar).toBeHidden();
  }
}
