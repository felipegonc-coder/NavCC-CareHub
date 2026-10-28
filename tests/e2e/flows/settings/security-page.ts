import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { choice } from '../sharing/share-dialog.js';
import { clickAndConfirm } from './account-page.js';
import { memberRow, membersTab, openSettings } from './settings-page.js';

// Settings → Security (Settings and members, section 3.5): the workspace's switches and who can
// create spaces or add custom emoji. Every change here is workspace-wide, so the checks that make
// one put it back in `finally`.

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The Security switches, by the start of their names, with their defaults (section 3.5). */
export const switches = {
  guests: { name: 'Allow guests', on: true },
  shareLinks: { name: 'Allow share links', on: true },
  export: { name: 'Members can export', on: true },
  moveOut: { name: 'Allow moving or copying pages to other workspaces', on: true },
  requireTwoStep: { name: 'Require 2-step verification', on: false },
} as const;
export type SwitchKey = keyof typeof switches;

/** A switch (or checkbox) in Security, by the start of its name. */
function control(page: Page, name: string): Locator {
  const named = { name: new RegExp(`^${escape(name)}`, 'i') };
  return page.getByRole('switch', named).or(page.getByRole('checkbox', named)).first();
}

/** Settings → Security: turns a switch on or off, confirming if Care Hub asks. */
export async function setSwitch(page: Page, key: SwitchKey, on: boolean): Promise<void> {
  await openSettings(page, 'Security');
  const toggle = control(page, switches[key].name);
  if ((await toggle.isChecked()) !== on) {
    await clickAndConfirm(page, toggle, /^(turn (on|off)|confirm|continue|yes|save)/i);
  }
  await expect(toggle).toBeChecked({ checked: on });
}

/** Who can create spaces, and who can add custom emoji: everyone (the default) or Admins only. */
export const whoCan = {
  spaces: /^who can create spaces/i,
  emoji: /^who can add custom emoji/i,
} as const;

/** Settings → Security: sets a "Who can…" choice (radio buttons, a select or a menu). */
export async function setWhoCan(
  page: Page,
  key: keyof typeof whoCan,
  option: 'Everyone' | 'Admins only',
): Promise<void> {
  await openSettings(page, 'Security');
  const wanted = new RegExp(`^${option}`, 'i');
  const group = page.getByRole('radiogroup', { name: whoCan[key] });
  if (await group.count()) {
    await group.getByRole('radio', { name: wanted }).check();
    return;
  }
  const box = page.getByLabel(whoCan[key]).first();
  if ((await box.evaluate((element) => element.tagName)) === 'SELECT') {
    const label = (await box.locator('option').allInnerTexts()).find((text) => wanted.test(text));
    if (!label) throw new Error(`No "${option}" in ${whoCan[key]}`);
    await box.selectOption({ label });
  } else {
    await box.click();
    await choice(page, wanted).click();
  }
  await expect(box).toContainText(wanted);
}

/** Settings → Members → Guests: removes a guest by email (a button or the row's menu). */
export async function removeGuest(page: Page, email: string): Promise<void> {
  await openSettings(page, 'Members');
  await membersTab(page, 'Guests');
  const row = memberRow(page, email);
  if (!(await row.count())) return;
  const remove = row.getByRole('button', { name: /^remove/i });
  if (await remove.count()) {
    await clickAndConfirm(page, remove.first(), /^remove/i);
  } else {
    await row
      .getByRole('button', { name: /more|actions|options|…|⋯/i })
      .first()
      .click();
    await clickAndConfirm(page, page.getByRole('menuitem', { name: /^remove/i }), /^remove/i);
  }
  await expect(row).toHaveCount(0);
}

/** The first web address shown in a dialog (its text or its text boxes), as a path. */
export async function linkPathIn(dialog: Locator): Promise<string> {
  const shown = [
    await dialog.innerText(),
    ...(await Promise.all(
      (await dialog.getByRole('textbox').all()).map((box) => box.inputValue()),
    )),
  ].join(' ');
  const found = /https?:\/\/[^\s"'<>]+/.exec(shown)?.[0];
  if (!found) throw new Error(`No link in the dialog: ${shown}`);
  const link = new URL(found);
  return `${link.pathname}${link.search}${link.hash}`;
}
