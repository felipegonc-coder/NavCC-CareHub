import type { Browser, Locator, Page } from '@playwright/test';
import { expect, signInAs, type PersonKey } from '../_support/index.js';
import type { NewPerson } from './settings-data.js';

/** Signs `who` in, in a window of their own (separate cookies). */
export async function windowFor(browser: Browser, who: PersonKey): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

/** A RegExp that matches `text` literally. */
export const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

// ---- Settings (spec, section 2) ----

/** A Settings section in the list on the left: My account, Members, Security… */
export function sectionLink(page: Page, name: string): Locator {
  const exact = { name, exact: true };
  return page
    .getByRole('link', exact)
    .or(page.getByRole('tab', exact))
    .or(page.getByRole('option', exact))
    .first();
}

/** Opens Settings with Ctrl+, over Home, then one of its sections. */
export async function openSettings(page: Page, section: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  const link = sectionLink(page, section);
  // Each section also has its own address; /settings shows the list if the shortcut didn't.
  if (
    !(await link.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    ))
  ) {
    await page.goto('/settings');
  }
  await link.click();
  await expect(page.getByRole('heading', { name: section }).first()).toBeVisible();
}

/** "Saved", shown next to a field for 2 seconds after a change is saved (section 2). */
export const saved = (page: Page) => page.getByText('Saved', { exact: true }).first();

/** Types a new value into a field and saves it (Enter, or the Save button if there is one). */
export async function change(page: Page, field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Enter');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  if (await save.isVisible()) await save.click();
}

/** Picks a picture file in My account; confirms the crop if Care Hub asks. */
export async function choosePicture(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles({
    name,
    mimeType: 'image/png',
    buffer,
  });
  const confirm = page
    .getByRole('dialog')
    .getByRole('button', { name: /^(save|apply|done|crop|use (this )?picture|set picture)$/i });
  if (
    await confirm.waitFor({ timeout: 3_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await confirm.click();
  }
}

// ---- Members (section 3.4) ----

/** The Members tab's row for a person, found by email. */
export function memberRow(page: Page, email: string): Locator {
  return page.getByRole('row').or(page.getByRole('listitem')).filter({ hasText: email }).first();
}

/** The picture in a person's row: its address, or null while it shows initials. */
export async function pictureIn(row: Locator): Promise<string | null> {
  const image = row.locator('img').first();
  return (await image.count()) ? image.getAttribute('src') : null;
}

/** A tab of Members: Members, Guests, Groups or Invite links. */
export async function membersTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
}

/**
 * Invite links → Create invite link with a role and a number of uses; returns the link's path
 * (the full link shows once). The expiry stays at its default.
 */
export async function createInviteLink(
  page: Page,
  options: { role: string; uses: number },
): Promise<string> {
  await openSettings(page, 'Members');
  await membersTab(page, 'Invite links');
  await page.getByRole('button', { name: 'Create invite link', exact: true }).click();
  const dialog = page.getByRole('dialog').last();
  const role = dialog.getByLabel(/^role$/i);
  if ((await role.evaluate((element) => element.tagName)) === 'SELECT') {
    await role.selectOption({ label: options.role });
  } else {
    await role.click();
    await page.getByRole('option', { name: options.role, exact: true }).click();
  }
  await dialog.getByLabel(/uses/i).fill(String(options.uses));
  await dialog.getByRole('button', { name: /^create( (invite )?link)?$/i }).click();
  await expect(dialog.getByRole('button', { name: /^copy/i })).toBeVisible();
  const shown = [
    await dialog.innerText(),
    ...(await Promise.all(
      (await dialog.getByRole('textbox').all()).map((box) => box.inputValue()),
    )),
  ].join(' ');
  const link = /https?:\/\/[^\s"'<>]+/.exec(shown)?.[0];
  if (!link) throw new Error(`No invite link in the dialog: ${shown}`);
  await page.keyboard.press('Escape');
  const { pathname, search, hash } = new URL(link);
  return `${pathname}${search}${hash}`;
}

/** Opens an invite link signed out, in a window of its own. */
export async function openInvite(browser: Browser, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  return page;
}

/** Someone without an account joins with an invite link: name, email and password (3.4). */
export async function join(browser: Browser, path: string, person: NewPerson): Promise<Page> {
  const page = await openInvite(browser, path);
  await page.getByLabel(/^name$/i).fill(person.name);
  await page
    .getByLabel(/email|sign-in name/i)
    .first()
    .fill(person.email);
  // Fields only: a "Show password" button has the word in its name too.
  const passwords = page.getByLabel(/password/i).and(page.locator('input'));
  for (const box of await passwords.all()) await box.fill(person.password);
  await page
    .getByRole('button', { name: /^(join|join workspace|join care hub|create account|continue)$/i })
    .click();
  await page.waitForURL((url) => url.pathname !== new URL(path, url).pathname);
  await expect(page.getByRole('main')).toBeVisible();
  return page;
}

/** Members row menu → Remove from workspace, confirmed (section 3.4). */
export async function removeMember(page: Page, email: string): Promise<void> {
  await openSettings(page, 'Members');
  const row = memberRow(page, email);
  await row
    .getByRole('button', { name: /more|actions|options|…|⋯/i })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Remove from workspace', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .last()
    .getByRole('button', { name: /^remove/i })
    .click();
}
