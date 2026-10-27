import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';
import { choice } from './share-dialog.js';

// Settings → Members and Settings → Roles (Roles and permissions, section 2; Settings and members,
// section 3.4), as the Admin signed in on the page, plus the No access screen's Request access
// (section 3, Access requests). Every guess about these screens is in this file.

/** Picks a choice in a field that is a native select or a dropdown with a list of choices. */
async function pick(page: Page, field: Locator, label: string) {
  if (await field.evaluate((element) => element instanceof HTMLSelectElement)) {
    await field.selectOption({ label });
  } else {
    await field.click();
    await choice(page, new RegExp(`^${literally(label).source}\\b`)).click();
  }
}

/** The settings' search box (assumed the first search field on the screen). */
function searchBox(page: Page): Locator {
  return page
    .getByRole('searchbox')
    .or(page.getByRole('textbox', { name: /search/i }))
    .first();
}

/** Settings → Members: name, email, role (a dropdown in each row), groups and joined. */
export class MembersTab {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto('/settings/members');
    await expect(searchBox(this.page)).toBeVisible();
  }

  /** A member's row, after searching for them (the list can be long). */
  async row(name: string): Promise<Locator> {
    await searchBox(this.page).fill(name);
    const row = this.page.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    return row;
  }

  /** Changes a member's role with their row's dropdown; Care Hub says "Riley Chen is now a Viewer". */
  async changeRole(name: string, role: string) {
    const row = await this.row(name);
    const roleField = row
      .getByRole('combobox')
      .or(row.getByRole('button', { name: /^(admin|editor|commenter|viewer|role)\b/i }))
      .first();
    await pick(this.page, roleField, role);
    const saved = new RegExp(`${literally(name).source} is now an? ${literally(role).source}`);
    await expect(this.page.getByText(saved)).toBeVisible();
  }
}

/**
 * Settings → Roles: each role with its number of members, "New role" (a copy of any role, named in
 * a dialog with Name and the role to copy), and a role's page with one switch per permission.
 */
export class RolesSettings {
  readonly newRole: Locator;

  constructor(readonly page: Page) {
    this.newRole = page.getByRole('button', { name: 'New role' });
  }

  async open() {
    await this.page.goto('/settings/roles');
    await expect(this.role('Viewer')).toBeVisible();
  }

  /** A role in the list, by its name. */
  role(name: string): Locator {
    const named = new RegExp(`^${literally(name).source}\\b`);
    return this.page
      .getByRole('link', { name: named })
      .or(this.page.getByRole('row').filter({ hasText: named }))
      .first();
  }

  /**
   * Makes a custom role as a copy of another, unless an earlier run made it: there are at most 20
   * custom roles, so each test keeps one fixed fictional name instead of a new one per run.
   */
  async ensure(name: string, copyOf: string) {
    await this.open();
    if ((await this.role(name).count()) > 0) return;
    await this.newRole.click();
    const dialog = this.page.getByRole('dialog').last();
    await dialog.getByLabel(/^name$/i).fill(name);
    await pick(this.page, dialog.getByLabel(/copy|start from|based on/i).first(), copyOf);
    await dialog.getByRole('button', { name: /^create/i }).click();
    await expect(this.role(name)).toBeVisible();
  }

  /** Turns one of a role's permissions on or off, by its switch's label, then saves if asked. */
  async setPermission(name: string, permission: RegExp, on: boolean) {
    await this.open();
    await this.role(name).click();
    const toggle = this.page
      .getByRole('switch', { name: permission })
      .or(this.page.getByRole('checkbox', { name: permission }))
      .first();
    await toggle.setChecked(on);
    const save = this.page.getByRole('button', { name: /^save/i });
    if (await save.isVisible()) await save.click();
    await expect(toggle).toBeChecked({ checked: on });
  }
}

/**
 * The No access screen's Request access, with the optional note (assumed a text box named for
 * the note). Care Hub then says the request was sent.
 */
export async function requestAccess(page: Page, note: string) {
  await page.getByRole('textbox', { name: /note/i }).fill(note);
  await page.getByRole('button', { name: 'Request access', exact: true }).click();
  await expect(page.getByText(/request (was )?sent|asked for access/i).first()).toBeVisible();
}
