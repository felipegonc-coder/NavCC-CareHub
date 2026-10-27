import type { Browser, Locator, Page } from '@playwright/test';
import { expect, signInAs, test, type PersonKey } from '../_support/index.js';

/** The "…" button of the database toolbar. */
const MORE = /^(…|More|More options|More actions)$/;

/** A pattern that finds this text anywhere in an element, such as a cell with extra buttons. */
export function containing(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** Another person in a browser context of their own; close it with page.context().close(). */
export async function signedInPage(browser: Browser, who: PersonKey): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await signInAs(page, who);
  return page;
}

/**
 * A database screen at /p/<id>, found by the test hooks of decision 0200: the "database" test id,
 * view tabs, the grid with rows and cells by id, and the "db-totals" footer. Controls without a
 * hook are found by their names in the Databases spec.
 */
export class DatabaseScreen {
  readonly page: Page;
  readonly root: Locator;
  readonly grid: Locator;
  private readonly databaseId: string;

  constructor(page: Page, databaseId: string) {
    this.page = page;
    this.databaseId = databaseId;
    this.root = page.locator(`[data-testid="database"][data-database-id="${databaseId}"]`);
    this.grid = this.root.getByRole('grid');
  }

  /** Opens the database at its own address and waits for it. */
  async open(): Promise<void> {
    await this.page.goto(`/p/${this.databaseId}`);
    await expect(this.root).toBeVisible();
  }

  /** A toolbar or empty-state button by its whole name, such as "Filter" or "New". */
  button(name: string): Locator {
    return this.root.getByRole('button', { name, exact: true });
  }

  /** A view tab, such as "Table". */
  tab(name: string): Locator {
    return this.root.getByRole('tab', { name });
  }

  /** A property's column header. */
  header(name: string): Locator {
    return this.grid.getByRole('columnheader', { name });
  }

  /** The rows the table shows, in order. */
  rows(): Locator {
    return this.grid.locator('[role="row"][data-row-id]');
  }

  /** The row that shows this text, such as its unique title. */
  row(text: string): Locator {
    return this.rows().filter({ hasText: text });
  }

  /** One cell, by row id and property id. */
  cell(rowId: string, propertyId: string): Locator {
    return this.grid.locator(
      `[role="row"][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`,
    );
  }

  /** One property's cells down the table, in row order. */
  column(propertyId: string): Locator {
    return this.rows().locator(`[role="gridcell"][data-property-id="${propertyId}"]`);
  }

  /** Clicks a cell and types into the editor it opens; Enter saves and an empty text clears. */
  async editCell(rowId: string, propertyId: string, text: string): Promise<void> {
    await this.cell(rowId, propertyId).click();
    const editor = this.page.locator(':focus');
    await expect(editor).toBeEditable();
    await editor.fill(text);
    await editor.press('Enter');
  }

  /** Picks an option in a Select cell from the list the cell opens. */
  async pickOption(rowId: string, propertyId: string, option: string): Promise<void> {
    await this.cell(rowId, propertyId).click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
    const list = this.page.getByRole('listbox');
    if (await list.isVisible()) await this.page.keyboard.press('Escape');
  }

  /** Opens "…" in the toolbar and picks an item, such as "Lock structure" or "Export CSV". */
  async more(item: string): Promise<void> {
    await this.root.getByRole('button', { name: MORE }).first().click();
    const menu = this.page.getByRole('menu');
    await menu
      .getByRole('menuitem', { name: item })
      .or(menu.getByRole('menuitemcheckbox', { name: item }))
      .click();
  }

  /** The toolbar's search box, once Search is pressed. */
  searchBox(): Locator {
    return this.root.getByRole('searchbox').or(this.root.getByRole('textbox', { name: 'Search' }));
  }

  /** Presses Search in the toolbar and types. */
  async search(text: string): Promise<void> {
    await this.button('Search').click();
    await this.searchBox().fill(text);
  }

  /** Filter → a property → types in the value box that opens (a text filter: "contains"). */
  async addFilter(property: string, text: string): Promise<void> {
    await this.button('Filter').click();
    await this.page.getByRole('menuitem', { name: property, exact: true }).click();
    const box = this.page.locator(':focus');
    await expect(box).toBeEditable();
    await box.fill(text);
    await this.page.keyboard.press('Escape');
  }

  /** The bar someone sees after changing a view for themselves only. */
  forYouOnly(): Locator {
    return this.root.getByText('Changed for you only');
  }

  /** A column header's menu → "Sort ascending" or "Sort descending". */
  async sort(property: string, direction: 'ascending' | 'descending'): Promise<void> {
    await this.header(property).click();
    await this.page.getByRole('menuitem', { name: `Sort ${direction}` }).click();
  }

  /** A property's totals: one in the table footer, or one per group when grouped. */
  totalsOf(propertyId: string): Locator {
    return this.root.getByTestId('db-totals').locator(`[data-property-id="${propertyId}"]`);
  }

  /** Clicks a property's total in the footer and picks a calculation, such as "Sum". */
  async calculate(propertyId: string, calculation: string | RegExp): Promise<void> {
    await this.totalsOf(propertyId).first().click();
    await this.page.getByRole('menuitem', { name: calculation }).click();
  }

  /** Opens a row page (a dialog named after the row) from the row's Open button or title link. */
  async openRow(rowId: string, title: string): Promise<Locator> {
    const row = this.grid.locator(`[role="row"][data-row-id="${rowId}"]`);
    await row.hover();
    await row
      .getByRole('button', { name: 'Open' })
      .or(row.getByRole('link', { name: title }))
      .first()
      .click();
    const rowPage = this.page.getByRole('dialog', { name: title });
    await expect(rowPage).toBeVisible();
    return rowPage;
  }
}
