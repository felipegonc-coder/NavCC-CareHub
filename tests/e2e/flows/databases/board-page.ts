import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import type { DatabaseScreen } from './database-page.js';

/**
 * A Board view inside a database screen, found by the test hooks of decision 0200: columns are
 * "board-column" with their group key (an option id, or "__empty__" for No value) and cards are
 * articles with their row id. Moves follow the Databases spec, section 6: the mouse, the keyboard
 * (Space picks up, arrows move, Space drops, Esc cancels) and the card menu (Shift+F10, Move to…).
 */
export class Board {
  readonly page: Page;
  private readonly root: Locator;

  constructor(screen: DatabaseScreen) {
    this.page = screen.page;
    this.root = screen.root;
  }

  /** One column, by its group key. */
  column(groupKey: string): Locator {
    return this.root.locator(`[data-testid="board-column"][data-group-key="${groupKey}"]`);
  }

  /** The cards a column shows, in order. */
  cards(groupKey: string): Locator {
    return this.column(groupKey).getByRole('article');
  }

  /** One card, by its row id. */
  card(rowId: string): Locator {
    return this.root.getByRole('article').and(this.root.locator(`[data-row-id="${rowId}"]`));
  }

  /** Drags a card with the mouse and drops it near the top of another column. */
  async drag(rowId: string, groupKey: string): Promise<void> {
    const card = this.card(rowId);
    await card.scrollIntoViewIfNeeded();
    const from = await card.boundingBox();
    const to = await this.column(groupKey).boundingBox();
    if (!from || !to) throw new Error('The card or the column is not on the screen.');
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    // A few pixels first, past the distance a drag needs before it starts.
    await this.page.mouse.move(x + 12, y + 12, { steps: 4 });
    await this.page.mouse.move(to.x + to.width / 2, to.y + Math.min(72, to.height / 2), {
      steps: 20,
    });
    await this.page.mouse.up();
  }

  /** Focuses a card and presses Space, so the keys that follow move it. */
  async pickUp(rowId: string): Promise<void> {
    const card = this.card(rowId);
    await card.focus();
    await expect(card, 'A card takes the keyboard focus').toBeFocused();
    await this.page.keyboard.press('Space');
  }

  /** The keyboard move: Space, the arrows, Space. */
  async moveWithKeys(rowId: string, ...arrows: string[]): Promise<void> {
    await this.pickUp(rowId);
    for (const arrow of arrows) await this.page.keyboard.press(arrow);
    await this.page.keyboard.press('Space');
  }

  /** Shift+F10 on a card opens its menu; Move to… lists the columns by name. */
  async moveWithMenu(rowId: string, columnName: string): Promise<void> {
    await this.card(rowId).focus();
    await this.page.keyboard.press('Shift+F10');
    await this.page.getByRole('menuitem', { name: /^Move to/ }).click();
    await this.page
      .getByRole('menuitem', { name: columnName, exact: true })
      .or(this.page.getByRole('menuitemradio', { name: columnName, exact: true }))
      .or(this.page.getByRole('option', { name: columnName, exact: true }))
      .first()
      .click();
  }

  /** What a screen reader hears after a move, such as "Moved 'Call back' to Done". */
  announcement(title: string, columnName: string): Locator {
    return this.page.getByText(`Moved '${title}' to ${columnName}`);
  }
}
