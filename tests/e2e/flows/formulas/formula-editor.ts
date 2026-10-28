import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import type { DatabaseScreen } from '../databases/database-page.js';

/**
 * The formula editor (Formulas spec section 2), opened by clicking a formula cell: a code box, the
 * live result with its type under it ("Number · 42"), or a plain message about the problem, and
 * Done and Cancel. Done stays off while the formula has a problem.
 */
export class FormulaEditor {
  readonly page: Page;
  readonly dialog: Locator;
  readonly code: Locator;
  readonly done: Locator;

  private constructor(page: Page) {
    this.page = page;
    this.dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Done', exact: true }) });
    this.code = this.dialog
      .getByRole('textbox', { name: /formula/i })
      .or(this.dialog.locator('[contenteditable="true"]'))
      .first();
    this.done = this.dialog.getByRole('button', { name: 'Done', exact: true });
  }

  /** Clicks a formula cell, as someone who may change the formula, and waits for the editor. */
  static async fromCell(
    screen: DatabaseScreen,
    rowId: string,
    propertyId: string,
  ): Promise<FormulaEditor> {
    await screen.cell(rowId, propertyId).click();
    const editor = new FormulaEditor(screen.page);
    await expect(editor.code).toBeVisible();
    return editor;
  }

  /**
   * Replaces the whole formula. It's inserted in one go, as a paste would be, so the code box
   * doesn't add closing brackets or quotes of its own.
   */
  async write(text: string): Promise<void> {
    await this.code.fill(text);
  }

  /** Text in the editor, such as the result line or a problem's message. */
  says(text: string | RegExp): Locator {
    return this.dialog.getByText(text);
  }
}
