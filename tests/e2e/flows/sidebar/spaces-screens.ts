import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { spaceIdOf } from '../pages/page-data.js';
import { TEAM_SPACE } from '../pages/page-screen.js';
import { choice } from '../sharing/share-dialog.js';
import { Sidebar } from './sidebar-page.js';

/** The kinds of space (Sidebar, spaces and nested pages, section 3.3). */
export type SpaceKind = 'Open' | 'Closed' | 'Private';

/** A button or link next to the Spaces heading; it may only show while the pointer is on it. */
async function spacesControl(sidebar: Sidebar, name: RegExp): Promise<Locator> {
  const control = sidebar.nav
    .getByRole('button', { name })
    .or(sidebar.nav.getByRole('link', { name }))
    .first();
  await expect(sidebar.section(TEAM_SPACE)).toBeVisible();
  if (!(await control.isVisible())) {
    await sidebar.nav.getByText('Spaces', { exact: true }).first().hover();
  }
  return control;
}

/**
 * "+" next to Spaces, then Create space, as the person signed in on `page`, who becomes its owner
 * (section 3.3): a name, a description and a kind; the icon and the default access for members
 * keep their defaults (Can edit). Returns the new space's ID.
 */
export async function createSpace(
  page: Page,
  name: string,
  kind: SpaceKind,
  description: string,
): Promise<string> {
  const sidebar = new Sidebar(page);
  await (await spacesControl(sidebar, /^(create|new|add)( a)? space$/i)).click();
  const dialog = page.getByRole('dialog', { name: /space/i });
  await dialog.getByLabel(/^name/i).first().fill(name);
  await dialog
    .getByLabel(/^description/i)
    .first()
    .fill(description);
  const kindName = new RegExp(`^${kind}\\b`);
  const radio = dialog.getByRole('radio', { name: kindName });
  if (await radio.count()) {
    await radio.check();
  } else {
    const field = dialog.getByLabel(/^kind/i).first();
    if (await field.evaluate((element) => element instanceof HTMLSelectElement)) {
      await field.selectOption({ label: kind });
    } else {
      await field.click();
      await choice(page, kindName).click();
    }
  }
  await dialog.getByRole('button', { name: /^create/i }).click();
  await expect(dialog).toBeHidden();
  await expect(sidebar.section(name)).toBeVisible();
  return spaceIdOf(page, name);
}

/**
 * Browse spaces (section 2, Other screens): every Open and Closed space in the workspace, with its
 * description, members count and Join or Request to join. It may be a dialog or a screen.
 */
export async function browseSpaces(page: Page): Promise<Locator> {
  await (await spacesControl(new Sidebar(page), /^browse spaces$/i)).click();
  const name = /^browse spaces$/i;
  const screen = page
    .getByRole('dialog', { name })
    .or(page.getByRole('main').filter({ has: page.getByRole('heading', { name }) }));
  await expect(screen).toBeVisible();
  return screen;
}

/** A space in Browse spaces: the innermost list item, row or card that has its name. */
export function spaceCard(screen: Locator, name: string): Locator {
  return screen
    .getByRole('listitem')
    .or(screen.getByRole('row'))
    .or(screen.getByRole('article'))
    .filter({ hasText: name })
    .last();
}
