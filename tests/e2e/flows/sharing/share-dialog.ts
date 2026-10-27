import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';

/** The levels the share dialog offers on a page (Roles and permissions, section 3, Words). */
export type Level = 'Full access' | 'Can edit' | 'Can comment' | 'Can view';

const ANY_LEVEL = /full access|can edit|can comment|can view/i;

/**
 * The name of the person signed in on `page` (GET /api/auth/me), to find them in the invite box,
 * the "@" menu and notices without depending on what the seed calls them.
 */
export async function nameOf(page: Page): Promise<string> {
  type Me = { user?: { name?: string; displayName?: string } };
  const me = await (await apiFor(page)).get<Me>('/api/auth/me');
  const name = me.user?.name ?? me.user?.displayName;
  if (!name) throw new Error(`GET /api/auth/me answered without a name: ${JSON.stringify(me)}`);
  return name;
}

/** A choice in the open list or menu: a person in the invite box or the "@" menu, or a level. */
export function choice(page: Page, name: string | RegExp): Locator {
  return page
    .getByRole('option', { name })
    .or(page.getByRole('menuitemradio', { name }))
    .or(page.getByRole('menuitem', { name }))
    .first();
}

/**
 * The share dialog (Roles and permissions, section 3, Sharing): the invite box at the top, then
 * People with access, each with its level menu. Esc closes it and returns focus to Share (section 6).
 */
export class ShareDialog {
  /** Share at the top right of the page. */
  readonly opener: Locator;
  readonly dialog: Locator;
  /** Searches members, groups, roles and guests by name as you type. */
  readonly inviteBox: Locator;
  /** The level for the people being invited: the first level menu, as the invite box is on top. */
  readonly inviteLevel: Locator;

  constructor(readonly page: Page) {
    this.opener = page.getByRole('banner').getByRole('button', { name: 'Share', exact: true });
    this.dialog = page.getByRole('dialog', { name: /share/i });
    this.inviteBox = this.dialog
      .getByRole('combobox')
      .or(this.dialog.getByRole('searchbox'))
      .or(this.dialog.getByRole('textbox'))
      .first();
    this.inviteLevel = this.dialog
      .getByRole('button', { name: ANY_LEVEL })
      .or(this.dialog.getByRole('combobox', { name: ANY_LEVEL }))
      .first();
  }

  async open() {
    await this.opener.click();
    await expect(this.dialog).toBeVisible();
  }

  /** A person, group or role under People with access, with its level. */
  entry(name: string): Locator {
    return this.dialog.getByRole('listitem').filter({ hasText: name });
  }

  /** Invites one person: types their name, picks them, picks the level, then Invite. */
  async invite(name: string, level: Level) {
    await this.inviteBox.fill(name);
    await choice(this.page, literally(name)).click();
    await this.inviteLevel.click();
    await choice(this.page, new RegExp(`^${level}`)).click();
    await this.dialog.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(this.entry(name)).toContainText(level);
  }

  /** Esc closes the dialog and gives focus back to Share. */
  async closeWithEscape() {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).toBeHidden();
    await expect(this.opener).toBeFocused();
  }
}
