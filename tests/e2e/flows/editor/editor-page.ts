import type { Locator, Page } from '@playwright/test';
import { expect, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally } from '../pages/page-screen.js';

/** Block types by their names in the "/" menu and in Turn into (Pages and blocks, section 3.4). */
export type BlockType =
  | 'Text'
  | 'Heading 1'
  | 'Heading 2'
  | 'Heading 3'
  | 'Bulleted list'
  | 'Numbered list'
  | 'To-do list'
  | 'Toggle list'
  | 'Toggle heading 1'
  | 'Quote'
  | 'Callout'
  | 'Divider'
  | 'Code'
  | 'Block equation';

/** What a screen reader finds for each block type inside the page content. */
const SHOWN_AS: Record<BlockType, (content: Locator, page: Page) => Locator> = {
  Text: (content) => content.getByRole('paragraph'),
  // The page title is level 1, so Heading 1 to 3 are heard as levels 2 to 4 (section 3.4).
  'Heading 1': (content) => content.getByRole('heading', { level: 2 }),
  'Heading 2': (content) => content.getByRole('heading', { level: 3 }),
  'Heading 3': (content) => content.getByRole('heading', { level: 4 }),
  // Bulleted and numbered lists differ only in their element: <ul> or <ol>.
  'Bulleted list': (content) => content.locator('ul').getByRole('listitem'),
  'Numbered list': (content) => content.locator('ol').getByRole('listitem'),
  'To-do list': (content) => content.getByRole('checkbox'),
  // A toggle's arrow is a real control with its state (section 6).
  'Toggle list': (content) =>
    content
      .getByRole('button', { expanded: true })
      .or(content.getByRole('button', { expanded: false })),
  // A heading that folds what's nested under it; its arrow is the same control as a toggle's.
  'Toggle heading 1': (content) => content.getByRole('heading', { level: 2 }),
  Quote: (content) => content.getByRole('blockquote'),
  // An aside to the text around it, with its icon and background (section 3.4).
  Callout: (content) => content.getByRole('note').or(content.locator('aside')),
  Divider: (content) => content.getByRole('separator'),
  Code: (content) => content.getByRole('code'),
  'Block equation': (content, page) =>
    content.getByRole('math').or(page.getByRole('textbox', { name: /equation/i })),
};

/** The block editor of the open page and its pop-ups (Pages and blocks, sections 3.3 to 3.6). */
export class Editor {
  readonly screen: PageScreen;
  /** The labelled text area that holds the blocks. */
  readonly content: Locator;
  /** The "/" menu: a listbox of block types in groups. */
  readonly slashMenu: Locator;
  /** The block menu (⋮⋮, right-click or Ctrl+/) and its Turn into list. */
  readonly menu: Locator;

  constructor(readonly page: Page) {
    this.screen = new PageScreen(page);
    this.content = this.screen.content;
    this.slashMenu = page.getByRole('listbox', { name: 'Insert a block' });
    this.menu = page.getByRole('menu');
  }

  /**
   * A new page of the signed-in person, open with the cursor in its first, empty block. Tests that
   * need many pages put them inside one page of their own, to keep the team space short.
   */
  static async onNewPage(page: Page, inside?: { parentId: string }): Promise<Editor> {
    const editor = new Editor(page);
    await editor.screen.goto(await makePage(page, uniqueName('Fictional QA blocks'), inside));
    await editor.screen.title.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(editor.content).toBeFocused();
    return editor;
  }

  /** Blocks of this type, as a screen reader finds them. */
  block(type: BlockType): Locator {
    return SHOWN_AS[type](this.content, this.page);
  }

  /** An entry of the "/" menu by its title ("Heading 2"), whatever its description says. */
  option(title: string | RegExp): Locator {
    return this.slashMenu
      .getByRole('option')
      .filter({ has: this.page.getByText(title, { exact: true }) });
  }

  /** Types text blocks, one per line, starting where the cursor is. */
  async typeBlocks(...texts: string[]) {
    for (const [index, text] of texts.entries()) {
      if (index > 0) await this.page.keyboard.press('Enter');
      await this.page.keyboard.type(text);
    }
  }

  /** Waits until the page holds exactly these blocks' texts, in this order. */
  async expectBlocks(...texts: string[]) {
    const blocks = texts.map((text) => literally(text).source).join('\\s*');
    await expect(this.content).toHaveText(new RegExp(`^\\s*${blocks}\\s*$`));
  }

  /** Selects whole blocks: Esc in the first one, then Shift+↓ for each further one. */
  async selectBlocks(first: string, count: number) {
    await this.content.getByText(first, { exact: true }).click();
    await this.page.keyboard.press('Escape');
    for (let more = 1; more < count; more += 1) await this.page.keyboard.press('Shift+ArrowDown');
  }

  /** Opens the block menu of the selected blocks, or of the one the cursor is in, with Ctrl+/. */
  async openBlockMenu(): Promise<Locator> {
    await this.page.keyboard.press('ControlOrMeta+/');
    await expect(this.menu.first()).toBeVisible();
    return this.menu.first();
  }

  /** Block menu → Turn into → a type. */
  async turnInto(type: BlockType | 'Page') {
    const menu = await this.openBlockMenu();
    await menu.getByRole('menuitem', { name: /^turn into/i }).click();
    await this.page.getByRole('menuitem', { name: type, exact: true }).click();
  }

  /** Ctrl+Z in the editor. */
  async undo() {
    await this.content.focus();
    await this.page.keyboard.press('ControlOrMeta+Z');
  }

  /** The lines drawn on the text ("underline", "line-through"), by its element or one around it. */
  decoration(text: Locator): Promise<string> {
    return text.evaluate((element) => {
      const lines = new Set<string>();
      for (let at: Element | null = element; at; at = at.parentElement) {
        for (const line of getComputedStyle(at).textDecorationLine.split(' ')) lines.add(line);
      }
      return [...lines].filter((line) => line !== 'none').join(' ');
    });
  }

  /** How deep a block sits in nested lists: 1 at the top level (section 3.3, Nesting). */
  depthOf(text: string): Promise<number> {
    return this.content.getByText(text, { exact: true }).evaluate((block) => {
      let depth = 0;
      for (let at: Element | null = block; at; at = at.parentElement) {
        if (at.matches('li, [role="listitem"]')) depth += 1;
      }
      return depth;
    });
  }
}
