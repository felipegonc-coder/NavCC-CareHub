import type { Browser, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expect, uniqueName } from '../_support/index.js';
import { choice } from '../sharing/share-dialog.js';

/** Someone who joined the workspace with an invite link in this test, and their own browser. */
export type NewMember = { name: string; email: string; page: Page; close: () => Promise<void> };

/**
 * Settings → Members → Invite links → Create invite link with a role, as the Admin signed in on
 * `page` (Settings and members, section 3.4); the other choices keep their defaults. The full link
 * shows once, as text or in a read-only field; this returns its path, so it opens on the server
 * under test.
 */
export async function makeInviteLink(page: Page, role = 'Editor'): Promise<string> {
  await page.goto('/settings/members');
  await page.getByRole('tab', { name: 'Invite links' }).click();
  await page.getByRole('button', { name: 'Create invite link' }).click();
  // Settings may itself be a dialog; the invite link one opens last, on top of it.
  const dialog = page.getByRole('dialog').last();
  const roleField = dialog.getByLabel(/^role$/i);
  if (await roleField.evaluate((field) => field instanceof HTMLSelectElement)) {
    await roleField.selectOption({ label: role });
  } else {
    await roleField.click();
    await choice(page, new RegExp(`^${role}\\b`)).click();
  }
  await dialog.getByRole('button', { name: /^create/i }).click();
  await expect(dialog.getByRole('button', { name: /^copy/i })).toBeVisible();
  const fields = await dialog
    .locator('input, textarea')
    .evaluateAll((all: HTMLInputElement[]) => all.map((field) => field.value));
  const shown = [await dialog.innerText(), ...fields].join('\n');
  const link = shown.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  if (!link) throw new Error(`The new invite link isn't shown: ${shown}`);
  const { pathname, search, hash } = new URL(link);
  await page.keyboard.press('Escape');
  return `${pathname}${search}${hash}`;
}

/**
 * Opens an invite link in a new browser, signed out, and joins as a new person: a fictional name,
 * an @example.test sign-in name and a password made up for this run (section 3.4).
 */
export async function joinWithLink(
  browser: Browser,
  link: string,
  label = 'Fictional QA Riley Chen',
): Promise<NewMember> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = uniqueName(label);
  const email = `riley.${randomUUID().slice(0, 8)}@example.test`;
  const password = `QA-${randomUUID()}`;
  await page.goto(link);
  await page.getByLabel(/^(your |full )?name$/i).fill(name);
  await page.getByLabel(/email|sign-in name/i).fill(email);
  await page
    .getByLabel(/^password\b/i)
    .first()
    .fill(password);
  const again = page.getByLabel(/^(confirm|repeat).*password|password again/i);
  if (await again.count()) await again.fill(password);
  await page.getByRole('button', { name: /^(join|create account)/i }).click();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  return { name, email, page, close: () => context.close() };
}
