import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { AutomationEditor } from './automation-editor.js';

/**
 * Automations (Admins only): at /automations as docs/team/testing.md plans it, and Settings →
 * Automations in the spec. One entry per automation, a table row or a list item, with its name,
 * trigger ("Weekdays at 9:00 AM"), next run, last result, owner and an on/off switch.
 */
export class AutomationList {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens the list and waits for New automation. */
  async open(): Promise<void> {
    await this.page.goto('/automations');
    await expect(this.newButton()).toBeVisible();
  }

  /** New automation, a button or a link. */
  newButton(): Locator {
    const named = { name: 'New automation', exact: true };
    return this.page.getByRole('button', named).or(this.page.getByRole('link', named)).first();
  }

  /** Opens the list → New automation: an empty editor. */
  async newAutomation(): Promise<AutomationEditor> {
    await this.open();
    await this.newButton().click();
    const editor = new AutomationEditor(this.page);
    await expect(editor.name()).toBeVisible();
    return editor;
  }

  /** An automation's entry, by its name. */
  entry(name: string): Locator {
    const main = this.page.getByRole('main');
    return main.getByRole('row').or(main.getByRole('listitem')).filter({ hasText: name });
  }

  /** The on/off switch of an automation's entry. */
  switchOf(name: string): Locator {
    const entry = this.entry(name);
    return entry.getByRole('switch').or(entry.getByRole('checkbox')).first();
  }
}
