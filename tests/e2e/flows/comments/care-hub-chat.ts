import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** A button or a link with this name, such as a notice's Open and Reply, or its page card. */
export function control(root: Page | Locator, name: string | RegExp): Locator {
  const options = typeof name === 'string' ? { name, exact: true } : { name };
  return root.getByRole('button', options).or(root.getByRole('link', options));
}

/**
 * The signed-in person's 🔔 Care Hub chat in Messages, where notices arrive (Messages, section 3;
 * Comments and mentions, section 3.4). It's first in the chat list and has no composer.
 */
export class CareHubChat {
  readonly main: Locator;
  /** What the chat shows instead of a composer (Messages, section 2). */
  readonly intro: Locator;
  /** The open chat's messages, a live region: screen readers hear new ones (Messages, section 6). */
  readonly feed: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.intro = this.main.getByText('Care Hub sends reminders, automations and alerts here.');
    this.feed = this.main.getByRole('log');
  }

  /** Opens Messages and then, unless it's open already, the 🔔 Care Hub chat at the top of the list. */
  async open() {
    await this.page.goto('/messages');
    const chat = control(this.main, /Care Hub/).first();
    await expect(this.intro.or(chat).first()).toBeVisible();
    if (!(await this.intro.isVisible())) await chat.click();
    await expect(this.intro).toBeVisible();
  }

  /** Where `text` shows in the open chat: once for each notice that holds it. */
  shown(text: string): Locator {
    return this.feed.getByText(text);
  }

  /**
   * The notice that shows each of `texts` and has the button or link `name` (Open, Reply, or its
   * page card). Notice rows have no accessible name, so Team tools gives them a data-testid that
   * starts with "notices-" or "messages-" (docs/team/testing.md); the innermost such row is the one.
   */
  notice(name: string | RegExp, ...texts: string[]): Locator {
    let rows = this.feed
      .getByTestId(/^(notices|messages)-/)
      .filter({ has: control(this.page, name) });
    for (const text of texts) rows = rows.filter({ hasText: text });
    return rows.last();
  }
}
