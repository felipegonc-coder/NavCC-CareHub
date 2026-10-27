import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import type { SearchWindow } from '../search/search-window.js';

/**
 * The Updates panel (section 2), from the page menu: what happened on the page, grouped per person
 * and hour, newest first. People with Can edit also get Show changes on edits.
 */
export class UpdatesPanel {
  readonly panel: Locator;

  constructor(readonly page: Page) {
    const name = /updates/i;
    this.panel = page
      .getByRole('dialog', { name })
      .or(page.getByRole('complementary', { name }))
      .or(page.getByRole('region', { name }))
      .first();
  }

  /** Page menu → Updates. */
  async open() {
    const menu = await new PageScreen(this.page).openPageMenu();
    await menu.getByRole('menuitem', { name: /^updates/i }).click();
    await expect(this.panel).toBeVisible();
  }

  async close() {
    await this.page.keyboard.press('Escape');
    await expect(this.panel).toBeHidden();
  }

  /**
   * Opens the panel until it shows some text, closing it in between: an edit may be listed only
   * once its automatic version is saved, 2 minutes after the last change (section 3.1).
   */
  async waitFor(text: RegExp, timeout: number) {
    await expect(async () => {
      await this.open();
      try {
        await expect(this.panel).toContainText(text, { timeout: 2_000 });
      } finally {
        await this.close();
      }
    }).toPass({ timeout, intervals: [5_000] });
  }

  /** Show changes on an edit, which opens Version history at that point. */
  get showChanges(): Locator {
    return this.panel.getByRole('button', { name: /show changes/i });
  }
}

/**
 * Archive and Unarchive (section 3.5). An archived page shows the yellow banner "Archived by Sam
 * Ortiz on Oct 20, 2026 · Unarchive" (section 2).
 */
export class Archive {
  /** Unarchive in the banner. */
  readonly unarchiveButton: Locator;

  constructor(readonly page: Page) {
    this.unarchiveButton = page.getByRole('button', { name: 'Unarchive', exact: true });
  }

  /** The banner, by who archived the page and on which day ("Oct 20, 2026"). */
  banner(who: string, on: string): Locator {
    return this.page.getByText(
      new RegExp(`Archived by ${literally(who).source} on ${literally(on).source}`),
    );
  }

  /** Page menu → Archive, on the open page. */
  async archive(subPages: number) {
    const menu = await new PageScreen(this.page).openPageMenu();
    await menu.getByRole('menuitem', { name: /^archive/i }).click();
    await this.saysHowMany(subPages, /^archive/i);
  }

  /** Unarchive in the banner of the open page. */
  async unarchive(subPages: number) {
    await this.unarchiveButton.click();
    await this.saysHowMany(subPages, /^unarchive/i);
  }

  /**
   * For a page with sub-pages, Care Hub "says how many": in a confirm, which this answers, or in
   * the message after it (which one isn't specified).
   */
  private async saysHowMany(subPages: number, answer: RegExp) {
    const count = new RegExp(`\\b${subPages} sub-pages?\\b`);
    await expect(this.page.getByText(count).first()).toBeVisible();
    const asks = this.page
      .getByRole('alertdialog')
      .or(this.page.getByRole('dialog'))
      .filter({ hasText: count });
    if (await asks.isVisible()) await asks.getByRole('button', { name: answer }).click();
    await expect(asks).toBeHidden();
  }
}

/** The Include archived filter chip of the search window (Search, section 2). */
export function includeArchived(search: SearchWindow): Locator {
  const name = /include archived/i;
  return search.dialog
    .getByRole('button', { name })
    .or(search.dialog.getByRole('checkbox', { name }))
    .or(search.dialog.getByRole('switch', { name }))
    .first();
}
