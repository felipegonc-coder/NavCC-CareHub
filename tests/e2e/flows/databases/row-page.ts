import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/**
 * A row page, by the Databases spec (section 2, Row page) and the test hooks of decision 0200: the
 * side panel is a dialog named after the row's title, with Open as full page, Previous and Next;
 * the full page is the row's own address, /p/<rowId>.
 */
export class RowPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The side panel of the row with this title. */
  panel(title: string): Locator {
    return this.page.getByRole('dialog', { name: title });
  }

  /** A control of the panel, such as "Next", "Previous" or "Open as full page". */
  control(title: string, name: string): Locator {
    const panel = this.panel(title);
    return panel.getByRole('button', { name }).or(panel.getByRole('link', { name })).first();
  }

  /** Presses Next or Previous and waits for the panel of the row it leads to. */
  async go(from: string, control: 'Next' | 'Previous', to: string): Promise<void> {
    await this.control(from, control).click();
    await expect(this.panel(to)).toBeVisible();
    await expect(this.panel(from)).toHaveCount(0);
  }

  /** Open as full page: the row's own address, with the page view as the main region. */
  async openFullPage(title: string, rowId: string): Promise<Locator> {
    await this.control(title, 'Open as full page').click();
    await expect(this.page).toHaveURL(new RegExp(`/p/${rowId}([?#].*)?$`));
    const main = this.page.getByRole('main');
    await expect(main).toBeVisible();
    return main;
  }
}
