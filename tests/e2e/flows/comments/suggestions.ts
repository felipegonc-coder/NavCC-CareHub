import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { Comments } from './threads.js';

/**
 * Suggested edits on the open page (Comments and mentions, section 3.2): the Mode menu in the top
 * bar, the marks in the text (added text underlined, removed text struck through), and each
 * suggestion's thread, "Suggested by <name>", with Accept and Reject.
 */
export class Suggestions {
  readonly screen: PageScreen;
  readonly comments: Comments;
  /** The Mode menu in the top bar: it shows the mode, Editing or Suggesting. */
  readonly mode: Locator;
  /** Every suggestion mark in the page content. */
  readonly marks: Locator;

  constructor(readonly page: Page) {
    this.screen = new PageScreen(page);
    this.comments = new Comments(page);
    const topBar = this.screen.topBar;
    this.mode = topBar
      .getByRole('button', { name: /^(mode\b|editing|suggesting)/i })
      .or(topBar.getByRole('combobox', { name: /mode/i }))
      .first();
    const content = this.screen.content;
    this.marks = content
      .getByLabel(/^suggested (insertion|deletion)/i)
      .or(content.locator('ins, del'));
  }

  /** Picks Editing or Suggesting in the Mode menu. */
  async switchTo(mode: 'Editing' | 'Suggesting') {
    await this.mode.click();
    const named = { name: new RegExp(`^${mode}`) };
    await this.page
      .getByRole('menuitemradio', named)
      .or(this.page.getByRole('menuitem', named))
      .or(this.page.getByRole('option', named))
      .first()
      .click();
    await expect(this.mode).toContainText(mode);
  }

  /** Added text; screen readers hear "Suggested insertion by <name>: <text>" (section 6). */
  insertion(by: string, text: string): Locator {
    return this.mark('insertion', by, text);
  }

  /** Removed text, still shown until someone accepts the suggestion. */
  deletion(by: string, text: string): Locator {
    return this.mark('deletion', by, text);
  }

  private mark(kind: 'insertion' | 'deletion', by: string, text: string): Locator {
    const content = this.screen.content;
    return content
      .getByLabel(new RegExp(`^suggested ${kind} by ${literally(by).source}`, 'i'))
      .or(content.locator(kind === 'insertion' ? 'ins' : 'del'))
      .filter({ hasText: text });
  }

  /** The thread of the suggestion that touches `text`, in the comments panel (open). */
  thread(text: string): Locator {
    const panel = this.comments.panel;
    return panel
      .getByRole('article')
      .or(panel.getByRole('listitem'))
      .filter({ hasText: /suggested by/i })
      .filter({ hasText: text })
      .first();
  }

  /** Accept or Reject on one suggestion's thread. */
  async decide(text: string, decision: 'Accept' | 'Reject') {
    await this.thread(text)
      .getByRole('button', { name: new RegExp(`^${decision}`) })
      .first()
      .click();
  }

  /** The panel's Suggestions filter, which has Accept all and Reject all. */
  async showSuggestions() {
    await this.comments.openPanel();
    const panel = this.comments.panel;
    const acceptAll = panel.getByRole('button', { name: 'Accept all' });
    // Picking the filter again could turn it off.
    if (await acceptAll.isVisible()) return;
    const named = { name: 'Suggestions', exact: true };
    const filter = panel
      .getByRole('radio', named)
      .or(panel.getByRole('button', named))
      .or(panel.getByRole('tab', named))
      .first();
    if (await filter.isVisible()) await filter.click();
    else {
      // A drop-down: open it, then pick Suggestions.
      await panel.getByRole('combobox').first().click();
      await this.page.getByRole('option', named).click();
    }
    await expect(acceptAll).toBeVisible();
  }
}
