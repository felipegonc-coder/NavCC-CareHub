import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { PageScreen, TEAM_SPACE } from '../pages/page-screen.js';

/** Where a dragged entry lands on another one (Sidebar, section 3.2). */
export type DropPlace = 'above' | 'below' | 'onto';

/** The sidebar (Sidebar, spaces and nested pages, section 2) and its page tree. */
export class Sidebar {
  readonly nav: Locator;

  constructor(readonly page: Page) {
    this.nav = page.getByRole('navigation', { name: 'Sidebar' });
  }

  /** Trash at the bottom of the sidebar, also a place to drop entries on. */
  get trash(): Locator {
    const name = { name: 'Trash', exact: true };
    return this.nav.getByRole('button', name).or(this.nav.getByRole('link', name)).first();
  }

  /** A section named by its heading: Favorites, a space, Shared or Private. */
  section(name: string): Locator {
    return this.nav.getByRole('group', { name, exact: true });
  }

  /** A section's heading, such as Shared or Private: a click collapses or expands it (section 3.1). */
  heading(name: string): Locator {
    return this.nav.getByRole('button', { name, exact: true }).first();
  }

  /**
   * How wide the sidebar is, in px: where its right edge is, as it starts at the left of the
   * window. 0 while it's hidden, whether it's taken away or slid off the left edge.
   */
  async width(): Promise<number> {
    if (!(await this.nav.isVisible())) return 0;
    const box = await this.nav.boundingBox();
    return box && box.x + box.width > 1 ? Math.round(box.x + box.width) : 0;
  }

  /** Drags the sidebar's edge `by` px to the right, or to the left when `by` is below 0. */
  async dragEdge(by: number) {
    const { x, y } = await this.edge();
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + by / 2, y, { steps: 5 });
    await this.page.mouse.move(x + by, y, { steps: 5 });
    await this.page.mouse.up();
  }

  /** Double-clicks the sidebar's edge, which sets it back to 240 px (section 3.1). */
  async resetWidth() {
    const { x, y } = await this.edge();
    await this.page.mouse.dblclick(x, y);
  }

  /**
   * The spot on the sidebar's right edge that can be dragged, found by its resize pointer, so it
   * doesn't matter whether the handle sits inside the edge, on it or just outside.
   */
  private async edge(): Promise<{ x: number; y: number }> {
    const box = await this.nav.boundingBox();
    if (!box) throw new Error("The sidebar isn't shown, so its edge can't be dragged");
    const y = box.y + box.height / 2;
    const x = await this.page.evaluate(
      ({ right, at }) => {
        for (let x = Math.floor(right) - 6; x <= right + 8; x += 1) {
          const there = document.elementFromPoint(x, at);
          if (there && /(col|ew)-resize/.test(getComputedStyle(there).cursor)) return x;
        }
        return null;
      },
      { right: box.x + box.width, at: y },
    );
    if (x === null) throw new Error('Nothing on the sidebar’s edge shows a resize pointer');
    return { x, y };
  }

  /** A page's entry in the tree. Titles from uniqueName() are unique, so part of one will do. */
  entry(title: string, within: Locator = this.nav): Locator {
    return within.getByRole('treeitem', { name: title });
  }

  /** The entries inside a page's entry, in their order on screen. */
  subEntries(title: string, within: Locator = this.nav): Locator {
    return this.entry(title, within).getByRole('group').first().getByRole('treeitem');
  }

  /** An entry that is expanded (`true`) or that can be expanded but isn't (`false`). */
  expanded(title: string, expanded: boolean, within: Locator = this.nav): Locator {
    return within.getByRole('treeitem', { name: title, expanded });
  }

  /** "+" next to a space: a new page at its top level, opened with the cursor in the title. */
  async addPage(title: string, space = TEAM_SPACE): Promise<PageScreen> {
    const section = this.section(space);
    await section.hover();
    await section
      .getByRole('button', { name: /^(add a page|new page)/i })
      .first()
      .click();
    return this.nameNewPage(title, section);
  }

  /** "+" on an entry: an untitled sub-page, opened with the cursor in the title (section 3.2). */
  async addSubPage(parent: string, title: string): Promise<PageScreen> {
    const entry = this.entry(parent);
    await entry.hover();
    await entry
      .getByRole('button', { name: /^(add|new) (a )?(sub-?page|page inside)/i })
      .first()
      .click();
    return this.nameNewPage(title, entry);
  }

  private async nameNewPage(title: string, within: Locator): Promise<PageScreen> {
    const screen = new PageScreen(this.page);
    await expect(screen.title).toBeFocused();
    await this.page.keyboard.type(title);
    await expect(this.entry(title, within)).toBeVisible();
    return screen;
  }

  /** Moves the keyboard focus to an entry, as ↑ and ↓ would. */
  async focus(title: string, within: Locator = this.nav) {
    await this.entry(title, within).focus();
    await expect(this.entry(title, within)).toBeFocused();
  }

  /** Expands an entry with → and waits for it to show what's inside. */
  async expand(title: string, within: Locator = this.nav) {
    await this.focus(title, within);
    await this.page.keyboard.press('ArrowRight');
    await expect(this.expanded(title, true, within)).toBeVisible();
  }

  /** The entry menu ("…"), opened by keyboard: focus the entry, then Shift+F10 (section 6). */
  async entryMenu(title: string, within: Locator = this.nav): Promise<Locator> {
    await this.focus(title, within);
    await this.page.keyboard.press('Shift+F10');
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }

  /** Renames an entry inline: F2, the new title, Enter (section 6). */
  async rename(title: string, newTitle: string) {
    await this.focus(title);
    await this.page.keyboard.press('F2');
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.type(newTitle);
    await this.page.keyboard.press('Enter');
    await expect(this.entry(newTitle)).toBeVisible();
  }

  /**
   * Drags an entry with the mouse and drops it above, below or onto `target` (a leaf entry, a
   * section heading or the Trash item), in small steps so the drop line or highlight can follow.
   */
  async drag(title: string, target: Locator, place: DropPlace = 'onto', within = this.nav) {
    const from = await this.entry(title, within).boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error(`Can't drag "${title}": the entry or the target isn't shown`);
    // The entry's own row: an expanded entry's box also holds its sub-pages.
    const [x, y] = [from.x + from.width / 2, from.y + Math.min(from.height / 2, 14)];
    const dropY = { above: to.y + 3, below: to.y + to.height - 3, onto: to.y + to.height / 2 }[
      place
    ];
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x, y + 12, { steps: 4 });
    await this.page.mouse.move(to.x + to.width / 2, dropY, { steps: 12 });
    await this.page.mouse.up();
  }
}
