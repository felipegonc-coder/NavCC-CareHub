import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** A button or a link with this name, such as a notice's Open and Reply, or its page card. */
export function control(root: Page | Locator, name: string | RegExp): Locator {
  const options = typeof name === 'string' ? { name, exact: true } : { name };
  return root.getByRole('button', options).or(root.getByRole('link', options));
}

/** The filter chips at the top of the 🔔 chat (Comments and mentions, section 3.4). */
export type Chip =
  'All' | 'Mentions and replies' | 'Following' | 'Reminders' | 'Requests' | 'Unread';

/**
 * The signed-in person's 🔔 Care Hub chat in Messages, where notices arrive (Messages, section 3;
 * Comments and mentions, section 3.4). It's first in the chat list and has no composer. In All,
 * notices count as read once the newest one is on screen; the other chips leave them unread.
 */
export class CareHubChat {
  readonly main: Locator;
  /** What the chat shows instead of a composer (Messages, section 2). */
  readonly intro: Locator;
  /** The chat's notices: each is an article named by who sent it and its title. */
  readonly notices: Locator;
  /** Next to the chips; it's off while nothing is unread. */
  readonly markAllAsRead: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.intro = this.main.getByText('Care Hub sends reminders, automations and alerts here.');
    this.notices = this.main.getByRole('article');
    this.markAllAsRead = this.main.getByRole('button', { name: 'Mark all as read', exact: true });
  }

  /** Opens Messages and then, unless it's open already, the 🔔 Care Hub chat at the top of the list. */
  async open() {
    await this.page.goto('/messages');
    const chat = control(this.main, /Care Hub/).first();
    await expect(this.intro.or(chat).first()).toBeVisible();
    if (!(await this.intro.isVisible())) await chat.click();
    await expect(this.intro).toBeVisible();
  }

  /** The notices that show `text`. */
  shown(text: string): Locator {
    return this.notices.filter({ hasText: text });
  }

  /** The newest notice that shows each of `texts` and has the button or link `name` (Open, Reply, its page card). */
  notice(name: string | RegExp, ...texts: string[]): Locator {
    let rows = this.notices.filter({ has: control(this.page, name) });
    for (const text of texts) rows = rows.filter({ hasText: text });
    return rows.last();
  }

  chip(name: Chip): Locator {
    return this.main
      .getByRole('group', { name: 'Filter notices' })
      .getByRole('button', { name, exact: true });
  }

  /** Picks a chip, then waits for its notices or for "No notices here.". */
  async filterBy(name: Chip) {
    await this.chip(name).click();
    await expect(this.chip(name)).toHaveAttribute('aria-pressed', 'true');
    await expect(
      this.notices.first().or(this.main.getByText(/^No notices (yet|here)\.$/)),
    ).toBeVisible();
  }

  /** An unread notice's dot, which screen readers hear as "Unread". */
  unread(notice: Locator): Locator {
    return notice.getByText('Unread', { exact: true });
  }
}
