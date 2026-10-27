import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import type { DatabaseScreen } from '../databases/database-page.js';

/** ⚡ in a database's toolbar (Admins only), by its symbol or its name. */
const LIGHTNING = /^(⚡|Automations)/;

/**
 * The automation editor (Automations spec section 2), an ordinary form: Name, Trigger and its
 * settings, actions in order (Add action), Save, Try it now, Delete and Run history, under a
 * sentence that reads the automation back in plain words. Fields are found by their labels; a
 * choice may be a native select, radio buttons or a list of options that the field opens.
 */
export class AutomationEditor {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** ⚡ in a database's toolbar → New automation: the editor, with the database filled in. */
  static async newFor(screen: DatabaseScreen): Promise<AutomationEditor> {
    await AutomationEditor.fromToolbar(screen, 'New automation');
    const editor = new AutomationEditor(screen.page);
    await expect(editor.name()).toBeVisible();
    return editor;
  }

  /** ⚡ in a database's toolbar → one of the automations that use the database. */
  static async openFor(screen: DatabaseScreen, name: string): Promise<AutomationEditor> {
    await AutomationEditor.fromToolbar(screen, name);
    const editor = new AutomationEditor(screen.page);
    await expect(editor.name()).toHaveValue(name);
    return editor;
  }

  private static async fromToolbar(screen: DatabaseScreen, item: string): Promise<void> {
    await screen.root.getByRole('button', { name: LIGHTNING }).click();
    const named = { name: item, exact: true };
    await screen.page
      .getByRole('menuitem', named)
      .or(screen.page.getByRole('link', named))
      .or(screen.page.getByRole('button', named))
      .first()
      .click();
  }

  /** The automation's name. */
  name(): Locator {
    return this.page.getByRole('textbox', { name: 'Name', exact: true });
  }

  /** The sentence at the top that reads the automation back, such as "When Status changes…". */
  readback(): Locator {
    return this.page.getByText(/^When\b/).first();
  }

  /** Picks an option in a field, by its label: the last such field, as new actions come last. */
  async pick(label: string, option: string): Promise<void> {
    const field = this.page.getByLabel(label, { exact: true }).last();
    const radio = field.getByRole('radio', { name: option, exact: true });
    if ((await field.evaluate((element) => element.tagName)) === 'SELECT') {
      await field.selectOption({ label: option });
    } else if ((await radio.count()) > 0) {
      await radio.check();
    } else {
      await field.click();
      await this.page.getByRole('option', { name: option, exact: true }).click();
    }
  }

  /** Add action → an action, such as "Edit the row". */
  async addAction(action: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Add action', exact: true }).click();
    await this.page.getByRole('menuitem', { name: action, exact: true }).click();
  }

  /** Presses Save and waits for the server to take the automation. */
  async save(): Promise<void> {
    const saved = this.page.waitForResponse(
      (response) => response.url().includes('/api/') && response.request().method() !== 'GET',
    );
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok()).toBe(true);
  }

  /** Opens Run history, a tab or a button of the editor. */
  async runHistory(): Promise<void> {
    const named = { name: 'Run history', exact: true };
    await this.page
      .getByRole('tab', named)
      .or(this.page.getByRole('button', named))
      .first()
      .click();
  }
}
