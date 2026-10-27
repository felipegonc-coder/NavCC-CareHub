import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/**
 * The signed-in person's 🔔 Care Hub chat in Messages (/messages), first in the chat list, where
 * automations' messages arrive from "Automation:" and the automation's name (Automations spec,
 * Message). Its messages are a live region (role log), so new ones show without a reload.
 */
export class CareHubChat {
  readonly page: Page;
  readonly main: Locator;
  readonly feed: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
    this.feed = this.main.getByRole('log');
  }

  /** Opens Messages, then the 🔔 Care Hub chat. */
  async open(): Promise<void> {
    await this.page.goto('/messages');
    const named = { name: /Care Hub/ };
    await this.main
      .getByRole('link', named)
      .or(this.main.getByRole('button', named))
      .first()
      .click();
    await expect(this.feed).toBeVisible();
  }

  /** Where this text shows in the chat: once for each message that holds it. */
  shown(text: string): Locator {
    return this.feed.getByText(text);
  }

  /** The sender line of the messages an automation sent. */
  from(automation: string): Locator {
    const name = automation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.feed.getByText(new RegExp(`Automation:\\s*${name}`));
  }
}
