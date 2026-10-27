import type { Browser, Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expect, uniqueName } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';
import { ShareDialog, choice, type Level } from './share-dialog.js';

// Assumptions about screens that aren't on main yet live here, so a test changes in one place.
// Roles and permissions, section 3 (Sharing, Guests, Groups, Share links), and Settings and
// members, section 3.4.

/** What screens show instead of something the person can't open (specs README, shared rules). */
export const NO_ACCESS = "You don't have access to this.";

const LEVEL = /full access|can edit|can comment|can view/i;

/** A choice whose name starts with `text`: a level, or a role rather than a person named so. */
const startingWith = (text: string) => new RegExp(`^${literally(text).source}\\b`);

/**
 * The first address shown in `where`, as text or in a read-only field, as a path on the server
 * under test. The page's own address (/p/<id>) is skipped, as the dialog may show it too.
 */
export async function shownLink(where: Locator): Promise<string> {
  const fields = await where
    .locator('input, textarea')
    .evaluateAll((all: HTMLInputElement[]) => all.map((field) => field.value));
  const shown = [await where.innerText(), ...fields].join('\n');
  for (const link of shown.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
    const { pathname, search, hash } = new URL(link);
    if (/^\/p\/[^/]+$/.test(pathname) && !search && !hash) continue;
    return `${pathname}${search}${hash}`;
  }
  throw new Error(`No link is shown: ${shown}`);
}

/**
 * The share dialog with what RP-16 to RP-21 need: each entry's level menu, the question a sub-page
 * asks before it gets its own access, Restore inherited access, guests and the Share link tab.
 */
export class AccessDialog extends ShareDialog {
  /** "Give this page its own access? It will stop following <parent>." Opens over the dialog. */
  readonly ownAccess: Locator;
  readonly restoreInherited: Locator;

  constructor(page: Page) {
    super(page);
    this.ownAccess = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog'))
      .filter({ hasText: 'Give this page its own access?' })
      .last();
    this.restoreInherited = this.dialog.getByRole('button', { name: 'Restore inherited access' });
  }

  /** A role's entry: one part says just the role ("Commenter" or "Commenter role"). */
  roleEntry(role: string): Locator {
    const named = new RegExp(`^${literally(role).source}( role)?$`, 'i');
    return this.dialog.getByRole('listitem').filter({ has: this.page.getByText(named) });
  }

  /** The level menu of an entry under People with access (Remove is in it too). */
  levelMenu(entry: Locator): Locator {
    return entry
      .getByRole('button', { name: LEVEL })
      .or(entry.getByRole('combobox', { name: LEVEL }))
      .first();
  }

  /** Picks another level in an entry's menu. */
  async changeLevel(entry: Locator, level: Level) {
    await this.levelMenu(entry).click();
    await choice(this.page, startingWith(level)).click();
  }

  /** Everyone with a role: the role's own choice in the invite box, whose name starts with it. */
  async inviteRole(role: string, level: Level) {
    await this.inviteBox.fill(role);
    await choice(this.page, startingWith(role)).click();
    await this.pickLevelAndInvite(level);
    await expect(this.roleEntry(role)).toContainText(level);
  }

  /**
   * Invites someone who isn't a member as a guest: their email in the invite box, then the choice
   * that offers it. Care Hub sends no email, so the inviter gets a one-time setup link, shown once
   * with Copy in the dialog or one on top of it (section 3, Guests); this returns its path.
   */
  async inviteGuest(email: string, level: Exclude<Level, 'Full access'>): Promise<string> {
    await this.inviteBox.fill(email);
    await choice(this.page, literally(email)).click();
    await this.pickLevelAndInvite(level);
    const shown = this.page
      .getByRole('dialog')
      .filter({ hasText: /setup link/i })
      .last();
    await expect(shown.getByRole('button', { name: /^copy/i })).toBeVisible();
    return shownLink(shown);
  }

  private async pickLevelAndInvite(level: Level) {
    await this.inviteLevel.click();
    await choice(this.page, startingWith(level)).click();
    await this.dialog.getByRole('button', { name: 'Invite', exact: true }).click();
  }
}

/**
 * The Share link tab of the share dialog (section 3, Share links): one view-only link per page,
 * with Include sub-pages (off by default), expiry and downloads, then Turn off and Change link.
 */
export class ShareLinkTab {
  readonly tab: Locator;
  readonly panel: Locator;
  readonly subPages: Locator;
  readonly turnOff: Locator;

  constructor(readonly share: ShareDialog) {
    this.tab = share.dialog.getByRole('tab', { name: /share link/i });
    this.panel = share.dialog.getByRole('tabpanel');
    const subPages = { name: /sub-pages/i };
    this.subPages = this.panel
      .getByRole('switch', subPages)
      .or(this.panel.getByRole('checkbox', subPages));
    this.turnOff = this.panel.getByRole('button', { name: /^turn off/i });
  }

  /** Makes the page's share link with the options as they are, and returns its path. */
  async make(): Promise<string> {
    await this.tab.click();
    await this.panel.getByRole('button', { name: /^(make|create|turn on)\b.*link/i }).click();
    await expect(this.turnOff).toBeVisible();
    return shownLink(this.panel);
  }
}

/** A fictional sign-in name for a guest made in this run. */
export const guestEmail = () => `guest.${randomUUID().slice(0, 8)}@example.test`;

/** A guest who set up their account in this test, and their own browser. */
export type Guest = { name: string; page: Page; close: () => Promise<void> };

/**
 * Opens a guest's setup link in a new browser, signed out, and sets up the account: a fictional
 * name and a password made up for this run. The sign-in name is the email they were invited with,
 * filled in only if the screen leaves it empty (section 3, Guests).
 */
export async function setUpGuest(
  browser: Browser,
  link: string,
  email: string,
  label = 'Fictional QA Guest Casey',
): Promise<Guest> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = uniqueName(label);
  const password = `QA-${randomUUID()}`;
  await page.goto(link);
  await page.getByLabel(/^(your |full )?name$/i).fill(name);
  const signInName = page.getByLabel(/email|sign-in name/i);
  if ((await signInName.count()) && (await signInName.isEditable())) {
    if (!(await signInName.inputValue())) await signInName.fill(email);
  }
  await page
    .getByLabel(/^password\b/i)
    .first()
    .fill(password);
  const again = page.getByLabel(/^(confirm|repeat).*password|password again/i);
  if (await again.count()) await again.fill(password);
  await page.getByRole('button', { name: /^(set up|create account|continue|save)/i }).click();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  return { name, page, close: () => context.close() };
}

/**
 * Settings → Members → Groups → New group, as the Admin signed in on `page` (Settings and
 * members, section 3.4): a name, then members picked by name. It then shows in the Groups tab.
 */
export async function makeGroup(page: Page, name: string, members: string[]) {
  await page.goto('/settings/members');
  await page.getByRole('tab', { name: 'Groups' }).click();
  await page.getByRole('button', { name: /^(new|create) group/i }).click();
  // Settings may itself be a dialog; the new group one opens last, on top of it.
  const dialog = page.getByRole('dialog').last();
  await dialog.getByLabel(/^name$/i).fill(name);
  const picker = dialog.getByRole('combobox', { name: /members|people/i });
  for (const member of members) {
    await picker.fill(member);
    await choice(page, literally(member)).click();
  }
  await dialog.getByRole('button', { name: /^(create|save)/i }).click();
  await expect(page.getByRole('tabpanel').getByText(name, { exact: true })).toBeVisible();
}
