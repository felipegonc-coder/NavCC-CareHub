import { expect } from '../_support/index.js';
import type { PageScreen } from '../pages/page-screen.js';
import type { Comments } from './threads.js';

// Comments and mentions, section 3.4: following a page, and muting one of its threads.

/** Follow in the page menu; the menu then offers Unfollow (or shows Follow ticked). */
export async function follow(screen: PageScreen) {
  const named = { name: /^follow/i };
  const menu = await screen.openPageMenu();
  await menu.getByRole('menuitem', named).or(menu.getByRole('menuitemcheckbox', named)).click();
  const again = await screen.openPageMenu();
  await expect(
    again
      .getByRole('menuitem', { name: /^unfollow/i })
      .or(again.getByRole('menuitemcheckbox', { ...named, checked: true })),
  ).toBeVisible();
  await screen.page.keyboard.press('Escape');
}

/** "Mute this thread" on a thread in the comments panel (open), found by one of its comments. */
export async function mute(comments: Comments, thread: string) {
  const name = /^mute this thread/i;
  const button = comments.thread(thread).getByRole('button', { name });
  await comments.thread(thread).hover();
  if (await button.isVisible()) await button.click();
  else await (await comments.menuOf(thread)).getByRole('menuitem', { name }).click();
}
