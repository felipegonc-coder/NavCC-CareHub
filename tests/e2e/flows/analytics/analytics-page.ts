import { readFile } from 'node:fs/promises';
import type { Browser, Locator, Page } from '@playwright/test';
import {
  DEFAULT_TIME_ZONE,
  expect,
  shownTime,
  signInAs,
  type PersonKey,
} from '../_support/index.js';
import { parseCsv } from './analytics-data.js';

/** Signs `who` in, in a window of their own (separate cookies). */
export async function windowFor(browser: Browser, who: PersonKey): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

// ---- Days in the viewer's time zone (Avery's is the default, America/Denver) ----

/** Today's date in the time zone, as "2026-10-27". */
export function today(timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date());
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A day as a chart's table may show it: "Oct 27", "October 27", "2026-10-27" or "10/27". */
export function dayLabel(date: string): RegExp {
  const noon = new Date(`${date}T12:00:00Z`);
  const month = (style: 'short' | 'long') =>
    new Intl.DateTimeFormat('en-US', { month: style, timeZone: 'UTC' }).format(noon);
  const [day, number] = [noon.getUTCDate(), noon.getUTCMonth() + 1];
  return new RegExp(
    `\\b(${month('short')}|${month('long')}) ${day}\\b|${date}|\\b${number}/${day}\\b`,
  );
}

// ---- The Analytics screen (spec, section 2) ----

/** /analytics, for Admins (docs/team/testing.md). */
export async function openAnalytics(page: Page): Promise<void> {
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' }).first()).toBeVisible();
}

/** Overview, Pages, People or Search. */
export async function openTab(page: Page, name: 'Overview' | 'Pages' | 'People' | 'Search') {
  const exact = { name, exact: true };
  const main = page.getByRole('main');
  await main.getByRole('tab', exact).or(main.getByRole('link', exact)).first().click();
}

/** The date range: the last 7 days (the default), 30 days or 90 days. */
export async function chooseRange(page: Page, days: 7 | 30 | 90): Promise<void> {
  const main = page.getByRole('main');
  const name = new RegExp(`^(last )?${days} days$`, 'i');
  const direct = main
    .getByRole('radio', { name })
    .or(main.getByRole('tab', { name }))
    .or(main.getByRole('button', { name }))
    .first();
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await main
    .getByRole('combobox', { name: /range|days/i })
    .or(main.getByRole('combobox').filter({ hasText: /days/i }))
    .first()
    .click();
  await page.getByRole('option', { name }).click();
}

/** Types into the tab's search box. */
export async function search(page: Page, text: string): Promise<void> {
  const main = page.getByRole('main');
  await main
    .getByRole('searchbox')
    .or(main.getByRole('textbox', { name: /search/i }))
    .or(main.getByPlaceholder(/search/i))
    .first()
    .fill(text);
}

/** A table (or grid) on the screen with a column whose header matches `header`. */
export function tableWith(page: Page, header: RegExp): Locator {
  return page
    .getByRole('table')
    .or(page.getByRole('grid'))
    .filter({ has: page.getByRole('columnheader', { name: header }) });
}

/** A table's text, row by row; the first row is its headers. */
export function readTable(table: Locator): Promise<string[][]> {
  return table.evaluate((element) => {
    const cells =
      ':scope > th, :scope > td, :scope > [role="cell"], :scope > [role="gridcell"], :scope > [role="columnheader"], :scope > [role="rowheader"]';
    return [...element.querySelectorAll('tr, [role="row"]')].map((row) =>
      [...row.querySelectorAll<HTMLElement>(cells)].map((cell) =>
        cell.innerText.replace(/\s+/g, ' ').trim(),
      ),
    );
  });
}

/** The index of the column whose header matches `header`; throws if there's none. */
export function column(rows: string[][], header: RegExp): number {
  const index = (rows[0] ?? []).findIndex((name) => header.test(name));
  if (index < 0) throw new Error(`No column ${header} in ${JSON.stringify(rows[0])}`);
  return index;
}

/** A number as the screen shows it ("1,204"). */
export const toNumber = (text: string | undefined) => Number((text ?? '').replace(/[^\d.-]/g, ''));

// ---- Overview ----

export type Totals = { activePeople: number; views: number; edits: number; created: number };

const totalLabels: Record<keyof Totals, string> = {
  activePeople: 'active people',
  views: 'page views',
  edits: 'edits',
  created: 'pages created',
};

/**
 * Overview's four numbers. Each is read next to its label ("Page views"), outside the tables,
 * where the same words can be column headers.
 */
export async function totals(page: Page): Promise<Totals> {
  const read = (label: string) =>
    page.getByRole('main').evaluate((root, wanted) => {
      const leaves = [...root.querySelectorAll<HTMLElement>('*')].filter(
        (element) =>
          element.children.length === 0 &&
          element.innerText.trim().toLowerCase() === wanted &&
          !element.closest('table, [role="table"], [role="grid"]'),
      );
      for (const leaf of leaves) {
        let box = leaf.parentElement;
        for (let up = 0; box && up < 3; up += 1, box = box.parentElement) {
          const found = /\d[\d,]*/.exec(box.innerText.replace(leaf.innerText, ' '));
          if (found) return Number(found[0].replace(/,/g, ''));
        }
      }
      return null;
    }, label);
  const numbers = {} as Totals;
  for (const [key, label] of Object.entries(totalLabels) as [keyof Totals, string][]) {
    const value = await read(label);
    if (value === null) throw new Error(`Overview shows no number for "${label}"`);
    numbers[key] = value;
  }
  return numbers;
}

/** The per-day charts' tables: active people per day, and views and edits per day. */
export function dayTables(page: Page) {
  const perDay = tableWith(page, /^(day|date)$/i);
  return {
    activity: perDay.filter({ has: page.getByRole('columnheader', { name: /active/i }) }).first(),
    viewsAndEdits: perDay
      .filter({ has: page.getByRole('columnheader', { name: /^(page )?views$/i }) })
      .filter({ has: page.getByRole('columnheader', { name: /^edits$/i }) })
      .first(),
  };
}

/** "View as table" on every chart that still shows as a chart (spec, section 2). */
export async function showChartsAsTables(page: Page): Promise<void> {
  const tables = dayTables(page);
  if ((await tables.activity.isVisible()) && (await tables.viewsAndEdits.isVisible())) return;
  const main = page.getByRole('main');
  const name = { name: 'View as table', exact: true };
  const toggles = main.getByRole('button', name).or(main.getByRole('switch', name));
  const count = await toggles.count();
  expect(count, 'every chart has "View as table"').toBeGreaterThanOrEqual(2);
  for (let index = 0; index < count; index += 1) {
    // A button may turn into "View as chart" once clicked; then the next one is first.
    const left = await toggles.count();
    await (left < count ? toggles.first() : toggles.nth(index)).click();
  }
  await expect(tables.activity).toBeVisible();
  await expect(tables.viewsAndEdits).toBeVisible();
}

// ---- Pages ----

/** The Pages tab's row for `title`, after searching for it. */
export async function pagesRow(page: Page, title: string): Promise<Record<string, string>> {
  await openTab(page, 'Pages');
  await search(page, title);
  const table = tableWith(page, /^views$/i).first();
  await expect(table.getByRole('row').filter({ hasText: title })).toHaveCount(1);
  const rows = await readTable(table);
  const row = rows.find((cells) => cells.some((cell) => cell.includes(title))) ?? [];
  return Object.fromEntries((rows[0] ?? []).map((header, index) => [header, row[index] ?? '']));
}

/** The Pages tab's numbers for `title`: Views and People who viewed. */
export async function pageNumbers(page: Page, title: string) {
  const row = await pagesRow(page, title);
  const value = (header: RegExp) =>
    toNumber(Object.entries(row).find(([name]) => header.test(name))?.[1]);
  return { views: value(/^views$/i), viewers: value(/^(people who viewed|viewers|people)$/i) };
}

/** Opens `title`'s detail from the Pages tab; returns its list of visits and edits. */
export async function openPageDetail(page: Page, title: string): Promise<Locator> {
  await openTab(page, 'Pages');
  await search(page, title);
  const row = page.getByRole('main').getByRole('row').filter({ hasText: title }).first();
  await row
    .getByRole('link', { name: title })
    .or(row.getByRole('button', { name: title }))
    .or(row.getByText(title))
    .first()
    .click();
  const visits = tableWith(page, /^(person|who|people|name)$/i).last();
  await expect(visits).toBeVisible();
  return visits;
}

/** Clicks the Export CSV that goes with `table` and returns the downloaded file's rows. */
export async function exportCsv(page: Page, table: Locator): Promise<string[][]> {
  const button = table
    .locator(
      'xpath=ancestor::*[.//*[self::button or @role="button"][contains(normalize-space(.), "Export CSV") or @aria-label="Export CSV"]][1]',
    )
    .getByRole('button', { name: 'Export CSV' })
    .first();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return parseCsv(await readFile(await download.path(), 'utf8'));
}

/**
 * Whether a CSV cell says the same as the table's: the same text, or (for times) a timestamp that
 * the table shows as its time of day in the viewer's time zone.
 */
export function sameValue(shown: string, saved: string): boolean {
  if (shown.trim() === saved.trim()) return true;
  const moment = Date.parse(saved);
  return Number.isFinite(moment) && shown.includes(shownTime(new Date(moment)));
}
