import type { APIResponse, Locator, Page } from '@playwright/test';
import { apiFor } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';
import { choice } from '../sharing/share-dialog.js';

/**
 * The page's own comments under the title (Comments and mentions, section 2): "Add a comment…" and
 * the page's threads. In the composer, "@" opens the mention menu and Enter sends.
 */
export class PageComments {
  readonly main: Locator;
  /** "Add a comment…", the composer for a new page comment. */
  readonly box: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.box = this.main
      .getByRole('textbox', { name: /add a comment/i })
      .or(this.main.getByPlaceholder(/add a comment/i))
      .first();
  }

  /** A comment on the page, found by its text. */
  comment(text: string): Locator {
    return this.main
      .getByRole('article')
      .or(this.main.getByRole('listitem'))
      .filter({ hasText: text })
      .first();
  }

  /** Writes "@<name> <text>" as a new page comment, picking the person in the "@" menu, and sends it. */
  async addMentioning(name: string, text: string) {
    await this.box.click();
    await this.page.keyboard.type(`@${name.split(' ')[0] ?? name}`);
    await choice(this.page, literally(name)).click();
    await this.page.keyboard.type(` ${text}`);
    await this.page.keyboard.press('Enter');
  }
}

/**
 * Sends a page comment straight to the server, to check that it's refused. Assumes the route is
 * POST /api/comments with { pageId, text }: features answer under /api/<feature> (docs/decisions/0007).
 */
export async function sendPageComment(
  page: Page,
  pageId: string,
  text: string,
): Promise<APIResponse> {
  return (await apiFor(page)).send('POST', '/api/comments', { pageId, text });
}
