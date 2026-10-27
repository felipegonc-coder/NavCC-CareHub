import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';
import { clickAndConfirm } from '../settings/account-page.js';
import { openSettings } from '../settings/settings-page.js';
import { choice } from './share-dialog.js';

// Settings → Members and Settings → Roles (Roles and permissions, section 2; Settings and members,
// section 3.4), as the Admin signed in on the page, the Security log (section 3.5), Settings →
// Site → Accounts for site admins (section 3.6), and the No access screen's Request access
// (Roles and permissions, section 3, Access requests). Every guess about these screens is in this
// file.

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

/** A member row's role dropdown: a native select, or a button named for the role. */
function roleField(row: Locator): Locator {
  return row
    .getByRole('combobox')
    .or(row.getByRole('button', { name: /^(admin|editor|commenter|viewer|role)\b/i }))
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

  /** Picks a role in a member's row dropdown, without waiting for it to be saved (or refused). */
  async pickRole(name: string, role: string) {
    await pick(this.page, roleField(await this.row(name)), role);
  }

  /** The role a member's row shows: its dropdown's current choice. */
  async roleOf(name: string): Promise<string> {
    const field = roleField(await this.row(name));
    return field.evaluate((element) =>
      (element instanceof HTMLSelectElement
        ? (element.selectedOptions[0]?.text ?? '')
        : (element.textContent ?? '')
      ).trim(),
    );
  }

  /** Changes a member's role with their row's dropdown; Care Hub says "Riley Chen is now a Viewer". */
  async changeRole(name: string, role: string) {
    await this.pickRole(name, role);
    const saved = new RegExp(`${literally(name).source} is now an? ${literally(role).source}`);
    await expect(this.page.getByText(saved)).toBeVisible();
  }

  /**
   * A member's row menu (Change role, Groups, Reset password, Turn off 2-step verification, Remove
   * from workspace). Assumed: a button in the row named "More", "Actions", "Options" or "…".
   */
  async rowMenu(name: string): Promise<Locator> {
    const row = await this.row(name);
    await row.getByRole('button', { name: /^(…|(more|actions|options)\b)/i }).click();
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }
}

/** A person as GET /api/workspace/members lists them (decision 0007; guests included). */
export type Member = {
  id: string;
  name: string;
  email: string;
  roleName: string;
  isGuest: boolean;
};

/** Everyone in the workspace, as the signed-in person's Members list has them. */
export async function listMembers(page: Page): Promise<Member[]> {
  const reply = await (
    await apiFor(page)
  ).get<Member[] | { members: Member[] }>('/api/workspace/members');
  return Array.isArray(reply) ? reply : reply.members;
}

/** The names of the workspace's Admins: its members whose role is Admin. */
export async function adminNames(page: Page): Promise<string[]> {
  const members = await listMembers(page);
  return members.filter((each) => !each.isGuest && each.roleName === 'Admin').map((m) => m.name);
}

/** The name of the signed-in person's workspace (GET /api/auth/me, decision 0007, section 3.1). */
export async function workspaceName(page: Page): Promise<string> {
  type Me = { workspace?: { name?: string } | null };
  const me = await (await apiFor(page)).get<Me>('/api/auth/me');
  const name = me.workspace?.name;
  if (!name) {
    throw new Error(`GET /api/auth/me answered without a workspace: ${JSON.stringify(me)}`);
  }
  return name;
}

const MAKE_ADMIN = /^make admin\b/i;

/**
 * Settings → Site → Accounts, for site admins: every account on the server, with name, email,
 * workspaces, site admin or not, created, last active and locked. Assumed: one table row per
 * account; the person's name in it opens their account (in a dialog, a panel or the screen), which
 * lists their workspaces, each with Make Admin where they're a member.
 */
export class SiteAccounts {
  constructor(readonly page: Page) {}

  async open() {
    await openSettings(this.page, 'Accounts');
  }

  /** An account's row, by email, after searching for it if the screen has a search box. */
  async row(email: string): Promise<Locator> {
    const search = searchBox(this.page);
    if (await search.isVisible()) await search.fill(email);
    const row = this.page.getByRole('row').filter({ hasText: email });
    await expect(row).toHaveCount(1);
    return row;
  }

  /** Opens a person's account from their row; returns where it shows. */
  async openPerson(person: { email: string; name: string }): Promise<Locator> {
    const row = await this.row(person.email);
    await row
      .getByRole('link')
      .or(row.getByRole('button', { name: literally(person.name) }))
      .or(row.getByText(person.name, { exact: true }))
      .first()
      .click();
    return this.page
      .getByRole('dialog')
      .or(this.page.getByRole('main'))
      .filter({ hasText: person.email })
      .last();
  }

  /**
   * The person's workspaces → Make Admin in one of them, confirmed if Care Hub asks. Saved when it
   * says "<name> is now an Admin", or Make Admin is no longer offered for that workspace.
   */
  async makeAdmin(person: { email: string; name: string }, workspace: string) {
    const account = await this.openPerson(person);
    const entry = account
      .getByRole('row')
      .or(account.getByRole('listitem'))
      .filter({ hasText: workspace })
      .filter({ has: this.page.getByRole('button', { name: MAKE_ADMIN }) })
      .last();
    const button = entry.getByRole('button', { name: MAKE_ADMIN });
    await clickAndConfirm(this.page, button, /^(make admin|confirm|continue|yes)\b/i);
    const saved = this.page.getByText(
      new RegExp(`${literally(person.name).source} is now an Admin`),
    );
    await expect
      .poll(async () => (await saved.count()) > 0 || (await button.count()) === 0)
      .toBe(true);
  }
}

/**
 * Settings → Security → Security log, for Admins: who, what, details, device and when for each
 * event, such as role changes. Assumed: "Security log" is a link, tab or button in Security (or a
 * part of it under that heading), and each entry is a table row or a list item.
 */
export class SecurityLog {
  constructor(readonly page: Page) {}

  async open() {
    await openSettings(this.page, 'Security');
    const named = { name: /^security log\b/i };
    const opener = this.page
      .getByRole('link', named)
      .or(this.page.getByRole('tab', named))
      .or(this.page.getByRole('button', named))
      .first();
    if ((await opener.count()) > 0) await opener.click();
    await expect(
      this.page.getByRole('heading', named).or(this.page.getByRole('tabpanel', named)).first(),
    ).toBeVisible();
  }

  /** The entries that show every one of `texts` (who, whom, what). */
  entries(...texts: (string | RegExp)[]): Locator {
    let found = this.page.getByRole('row').or(this.page.getByRole('listitem'));
    for (const text of texts) found = found.filter({ hasText: text });
    return found;
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
