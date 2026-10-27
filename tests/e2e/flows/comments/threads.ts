import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { PageScreen } from '../pages/page-screen.js';

/** A thread as GET /api/comments?pageId= lists it (packages/shared/src/comments.ts). */
export type ThreadView = {
  id: string;
  quote: string | null;
  resolvedAt: string | null;
  comments: { id: string; text: string }[];
};

/** The page's threads, open and resolved, as the person signed in on `page` may read them. */
export async function threadsOn(page: Page, pageId: string): Promise<ThreadView[]> {
  const api = await apiFor(page);
  return (await api.get<{ threads: ThreadView[] }>(`/api/comments?pageId=${pageId}&status=all`))
    .threads;
}

/** Selects part of a block's text, as dragging over it would (the editor must have the focus). */
export async function selectPart(block: Locator, part: string) {
  await block.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return;
    }
    throw new Error(`"${wanted}" isn't in the block`);
  }, part);
}

/**
 * Comments on the open page (Comments and mentions, sections 2 and 6): text comments in the page
 * content, and the comments panel (Comments in the top bar, tabs Open and Resolved), where each
 * thread shows its quote, its comments and a reply box. The panel sits beside the page; it isn't a
 * modal dialog.
 */
export class Comments {
  readonly screen: PageScreen;
  readonly panel: Locator;

  constructor(readonly page: Page) {
    this.screen = new PageScreen(page);
    const name = /^comments/i;
    this.panel = page
      .getByRole('complementary', { name })
      .or(page.getByRole('region', { name }))
      .or(page.getByRole('dialog', { name }))
      .first();
  }

  /** A block of the page by its whole text. */
  block(text: string): Locator {
    return this.screen.content.getByText(text, { exact: true });
  }

  /** Highlighted text that has a thread: screen readers hear "Commented text, 2 comments". */
  highlight(text: string): Locator {
    const content = this.screen.content;
    return content
      .getByLabel(/^commented text/i)
      .or(content.locator('mark'))
      .filter({ hasText: text });
  }

  /** Selects all of a block's text and comments on it: Ctrl+Shift+M, the comment, Enter. */
  async commentOn(text: string, comment: string) {
    await this.block(text).click();
    await this.page.keyboard.press('End');
    await this.page.keyboard.press('Shift+Home');
    await this.page.keyboard.press('ControlOrMeta+Shift+M');
    // The new thread's box takes the focus (section 6).
    await expect(this.screen.content).not.toBeFocused();
    await this.page.keyboard.type(comment);
    await this.page.keyboard.press('Enter');
    await expect(this.highlight(text)).toBeVisible();
  }

  /** Opens the comments panel, unless it's open, on one of its tabs. */
  async openPanel(tab: 'Open' | 'Resolved' = 'Open') {
    if (!(await this.panel.isVisible())) {
      await this.screen.topBar.getByRole('button', { name: /^comments/i }).click();
    }
    await this.panel.getByRole('tab', { name: tab }).click();
    await expect(this.panel.getByRole('tab', { name: tab, selected: true })).toBeVisible();
  }

  /** A thread in the panel, by its quote or one of its comments. */
  thread(text: string): Locator {
    const panel = this.panel;
    return panel
      .getByRole('article')
      .or(panel.getByRole('listitem'))
      .filter({ hasText: text })
      .first();
  }

  /** One comment in the panel, by its text: the innermost entry that holds it. */
  comment(text: string): Locator {
    const panel = this.panel;
    return panel
      .getByRole('article')
      .or(panel.getByRole('listitem'))
      .filter({ hasText: text })
      .last();
  }

  /** Writes in a thread's reply box; Enter sends. */
  async reply(thread: string, text: string) {
    await this.thread(thread).getByRole('textbox', { name: /reply/i }).click();
    await this.page.keyboard.type(text);
    await this.page.keyboard.press('Enter');
  }

  /** Resolve on a thread in the panel. */
  async resolve(thread: string) {
    await this.thread(thread).hover();
    await this.thread(thread)
      .getByRole('button', { name: /^resolve/i })
      .click();
  }

  /** The "…" menu of one comment, with Edit, Delete and Copy link to comment. */
  async menuOf(text: string): Promise<Locator> {
    const comment = this.comment(text);
    await comment.hover();
    await comment.getByRole('button', { name: /more|actions|options/i }).click();
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }

  /** Edit in a comment's menu: the box takes the focus with the text in it; Enter saves. */
  async edit(text: string, newText: string) {
    await (await this.menuOf(text)).getByRole('menuitem', { name: /^edit/i }).click();
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.type(newText);
    await this.page.keyboard.press('Enter');
    await expect(this.comment(newText)).toContainText('edited');
  }

  /** Delete in a comment's menu, then Delete in the confirm. */
  async remove(text: string) {
    await (await this.menuOf(text)).getByRole('menuitem', { name: /^delete/i }).click();
    const confirm = this.page
      .getByRole('alertdialog')
      .or(this.page.getByRole('dialog'))
      .filter({ hasText: /delete/i })
      .last();
    await confirm.getByRole('button', { name: /^delete/i }).click();
  }
}
