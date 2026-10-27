import type { Browser, Locator, Page } from '@playwright/test';
import { expect, signInAs, type PersonKey } from '../_support/index.js';

/**
 * The team space every seeded person is in. Assumed to be the workspace's default space "General"
 * (Sidebar, section 3.3); change it here if the seed names it otherwise.
 */
export const TEAM_SPACE = 'General';

/** The body of a refused request (docs/decisions/0007, errors): no title, no content. */
export const FORBIDDEN = {
  error: { code: 'forbidden', message: "You don't have access to this." },
};

/** A RegExp that matches `text` literally, for a title inside a longer name. */
export const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** The ID in the address of the open page, /p/<pageId>. */
export function pageIdOf(page: Page): string {
  const id = /\/p\/([^/?#]+)/.exec(page.url())?.[1];
  if (!id) throw new Error(`No page is open: ${page.url()}`);
  return id;
}

/** Another seeded person in a browser of their own, signed in. Call `close()` at the end. */
export async function openAs(browser: Browser, who: PersonKey) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, who);
  return { page, close: () => context.close() };
}

/** The page screen (Pages and blocks, section 2): top bar, header (icon, cover, title) and body. */
export class PageScreen {
  readonly main: Locator;
  readonly topBar: Locator;
  /** The title: plain text, "Untitled" while empty. */
  readonly title: Locator;
  /** The block editor, a labelled text area (section 6). */
  readonly content: Locator;
  /** The chip people with Can view or Can comment see in the top bar (section 2, States). */
  readonly viewOnly: Locator;
  readonly breadcrumbs: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.topBar = page.getByRole('banner');
    this.title = this.main.getByRole('textbox', { name: /title|untitled/i });
    this.content = this.main.getByRole('textbox', { name: 'Page content' });
    this.viewOnly = this.topBar.getByText('View only', { exact: true });
    this.breadcrumbs = this.topBar.getByRole('navigation', { name: /breadcrumb/i });
  }

  /** A button on the page screen, such as "Share", "Add icon" or "Add cover". */
  button(name: string | RegExp): Locator {
    return this.page.getByRole('button', { name });
  }

  /** ☆ in the top bar (its name says Favorite, whether starred or not). */
  get favorite(): Locator {
    return this.topBar.getByRole('button', { name: /favorite/i });
  }

  async goto(id: string) {
    await this.page.goto(`/p/${id}`);
    await expect(this.title).toBeVisible();
  }

  /** The same page in a new tab of this browser: what's shown there was saved. */
  async openAgain(): Promise<PageScreen> {
    const again = new PageScreen(await this.page.context().newPage());
    await again.goto(pageIdOf(this.page));
    return again;
  }

  /** The title as typed: the value of a text field, or the text of an editable heading. */
  titleText(): Promise<string> {
    return this.title.evaluate((field) =>
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? field.value
        : (field.textContent ?? ''),
    );
  }

  async expectTitle(text: string) {
    await expect.poll(() => this.titleText()).toBe(text);
  }

  /** Types at the end of the page's content, as someone who clicked into it would. */
  async typeAtEnd(text: string) {
    await this.content.click();
    await this.page.keyboard.press('ControlOrMeta+End');
    await this.page.keyboard.type(text);
  }

  /** The page menu ("…" in the top bar, section 3.2). */
  async openPageMenu(): Promise<Locator> {
    await this.topBar.getByRole('button', { name: /page menu|more/i }).click();
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }
}
