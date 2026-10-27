import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/**
 * Learning → Reports (routes in docs/learning/PLAN.md): the course report with Download CSV and
 * Reset, and a person's transcript. Button names from the Learning Phase 1 test checklist.
 */
export class ReportsPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
  }

  /** Learning → Reports → the course, the way the checklist goes. */
  async openCourse(title: string) {
    await this.page.goto('/learning');
    await this.page.getByRole('link', { name: 'Reports' }).click();
    await this.main.getByRole('link', { name: title }).click();
    await expect(this.page).toHaveURL(/\/learning\/reports\/courses\/[\w-]+$/);
  }

  /** A learner's row in a course report, or a course's row in a transcript. */
  row(text: string): Locator {
    return this.main.getByRole('row').filter({ hasText: text });
  }

  /** Reloads until the row shows `text`, for up to a minute (the checklist allows a reload). */
  async expectRowSoon(name: string, text: string | RegExp) {
    await expect(async () => {
      await this.page.reload();
      await expect(this.row(name)).toContainText(text, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
  }

  /** Download CSV: the file's lines split into cells (test names and statuses have no commas). */
  async downloadCsv(): Promise<string[][]> {
    const name = /download csv/i;
    const downloading = this.page.waitForEvent('download');
    await this.main.getByRole('button', { name }).or(this.main.getByRole('link', { name })).click();
    const text = await readFile(await (await downloading).path(), 'utf8');
    return text
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(','));
  }

  /** Reset next to the learner, confirmed if the screen asks; the row then says Not started. */
  async reset(name: string) {
    await this.row(name)
      .getByRole('button', { name: /^reset/i })
      .click();
    const dialog = this.page.getByRole('dialog');
    const notStarted = this.row(name).getByText(/not started/i);
    await expect(dialog.or(notStarted)).toBeVisible();
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: /^reset/i }).click();
    await expect(notStarted).toBeVisible();
  }
}
