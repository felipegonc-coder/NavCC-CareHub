import type { Locator, Page } from '@playwright/test';
import { DEFAULT_TIME_ZONE, apiFor, expect, shownDate } from '../_support/index.js';
import { getDatabase, propertyNamed } from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { choice } from '../sharing/share-dialog.js';

// Knowledge base, sections 2 and 3: turning a page into one, its home and views, and the strip,
// banners and verify menu of its pages. A knowledge base is a wiki database at the page's address
// (decision 0400), so its views are DatabaseScreen's. docs/extras/testing.md has no knowledge base
// hooks yet: everything else is found by role and by the spec's words, and every guess about the
// screens is in this file.

/** A confirm dialog by what it asks. */
export function confirmDialog(page: Page, asks: string | RegExp): Locator {
  return page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: asks });
}

/** A page with sub-pages, made through the API by the signed-in person in the team space. */
export async function makeHandbook(page: Page, title: string, subTitles: string[]) {
  const id = await makePage(page, title);
  const subIds = new Map<string, string>();
  for (const subTitle of subTitles) {
    subIds.set(subTitle, await makePage(page, subTitle, { parentId: id }));
  }
  return { id, subIds };
}

/** The sub-page ID of a handbook, by its title. */
export function idOf(subIds: Map<string, string>, title: string): string {
  const id = subIds.get(title);
  if (!id) throw new Error(`No sub-page "${title}"`);
  return id;
}

/**
 * Page menu → Turn into knowledge base, then the confirm, which counts the sub-pages ("Its 24
 * sub-pages become knowledge base pages…"). Waits for the knowledge base at the same address.
 */
export async function turnIntoKnowledgeBase(page: Page, pageId: string, subPages: number) {
  const screen = new PageScreen(page);
  await screen.goto(pageId);
  const menu = await screen.openPageMenu();
  await menu.getByRole('menuitem', { name: /^turn into knowledge base/i }).click();
  const confirm = confirmDialog(page, /into a knowledge base\?/);
  await expect(confirm).toContainText(new RegExp(`Its ${subPages} sub-pages? becomes? knowledge`));
  await confirm.getByRole('button', { name: 'Turn into knowledge base' }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/p/${pageId}`));
  await expect(new DatabaseScreen(page, pageId).root).toBeVisible();
}

/** A knowledge base's home (section 2): the Home section above its views. */
export class KnowledgeBase {
  readonly screen: DatabaseScreen;

  constructor(
    readonly page: Page,
    readonly id: string,
  ) {
    this.screen = new DatabaseScreen(page, id);
  }

  async open() {
    await this.screen.open();
  }

  /** Switches to a view, such as "All pages" (a table: Name, Owner, Status, Verification…). */
  async view(name: string) {
    await this.screen.tab(name).click();
    await expect(this.screen.tab(name)).toHaveAttribute('aria-selected', 'true');
  }

  /** The four built-in properties (section 4), for their columns in All pages. */
  async builtIns() {
    const database = await getDatabase(this.page, this.id);
    const named = (name: string) => propertyNamed(database, name);
    return { owner: named('Owner'), status: named('Status'), verification: named('Verification') };
  }

  /**
   * New in the toolbar, then the title, typed where the cursor starts. A row page that opens is
   * closed with Esc. Returns the new page's ID, from its row in the table.
   */
  async addPage(title: string): Promise<string> {
    const before = await this.screen.rows().count();
    await this.screen.root
      .getByRole('button', { name: /^(\+ )?New( page)?$/ })
      .first()
      .click();
    const rowPage = this.page.getByRole('dialog');
    await expect(rowPage.or(this.screen.rows().nth(before)).first()).toBeVisible();
    await this.page.keyboard.type(title);
    if (!(await rowPage.isVisible())) await this.page.keyboard.press('Enter');
    await expect(async () => {
      if (await rowPage.isVisible()) await this.page.keyboard.press('Escape');
      await expect(rowPage).toBeHidden({ timeout: 1_000 });
    }).toPass();
    const row = this.screen.row(title);
    await expect(row).toBeVisible();
    const id = await row.getAttribute('data-row-id');
    if (!id) throw new Error(`The row of "${title}" has no data-row-id`);
    return id;
  }
}

/** A calendar day counted from today in a time zone: "2026-10-27", "Oct 27, 2026" and "Oct 27". */
export function dayIn(offsetDays: number, timeZone = DEFAULT_TIME_ZONE) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offsetDays, 12));
  const shown = shownDate(date, 'UTC');
  return { iso: date.toISOString().slice(0, 10), shown, short: shown.replace(/, \d{4}$/, '') };
}

/** Minutes since midnight now, in a time zone. */
export function minutesIn(timeZone = DEFAULT_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? 0);
  return part('hour') * 60 + part('minute');
}

/**
 * Test data for KB-05 and FLOW-07: "verified until <day>", through the verify route as Until a
 * date does (POST /api/knowledge/pages/:pageId/verification). The route takes only days after
 * today ("Pick a date after today, up to ten years ahead."), so today and earlier days need a test
 * hook on the server, which isn't there yet (asked). Once that day's 9:00 AM has passed in the
 * first owner's time zone, the expiry task, every minute, turns the page Expired.
 */
export async function setVerifiedUntil(page: Page, pageId: string, until: string) {
  const response = await (
    await apiFor(page)
  ).send('POST', `/api/knowledge/pages/${pageId}/verification`, { period: 'date', until });
  expect(response.status(), `Verified until ${until}: needs the server's test hook`).toBe(200);
}

/** How long the expiry task, which runs every minute, may take to turn a page Expired. */
export const EXPIRY_WAIT = 2 * 60_000;

/** Opens a page again until it shows something the expiry task brings, such as the banner. */
export async function untilExpiryShows(screen: PageScreen, pageId: string, shows: Locator) {
  await expect(async () => {
    await screen.goto(pageId);
    await expect(shows).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: EXPIRY_WAIT, intervals: [5_000] });
}

/** A day as the badge and banners show it, with or without its year ("Oct 1", "Oct 1, 2026"). */
const onDay = (day: { short: string }) => `${day.short}(, \\d{4})?`;

/**
 * A knowledge base page (section 2): the banners above the title and, under it, the strip with
 * the verification badge, owners, status and tags. Assumed: the badge is a button that opens the
 * verify menu, and the status a button ("Published") with Back to draft in its menu.
 */
export class KbPage {
  readonly main: Locator;
  /** The blue banner of a draft, with Publish. */
  readonly draftBanner: Locator;
  readonly notVerified: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.draftBanner = this.main.getByText(/^Draft\. Only editors can see this page\./);
    this.notVerified = this.main.getByText('Not verified', { exact: true }).first();
  }

  /** The green badge: "✓ Verified by Riley Chen until Jan 20, 2027" (no year this year). */
  verifiedBadge(name: string, until: { short: string }): Locator {
    const text = `Verified by ${literally(name).source} until ${onDay(until)}(?!\\d)`;
    return this.main.getByText(new RegExp(text)).first();
  }

  /** The orange badge: "Verification expired Oct 1". */
  expiredBadge(day: { short: string }): Locator {
    return this.main.getByText(new RegExp(`^Verification expired ${onDay(day)}$`)).first();
  }

  /** Readers of an expired page: "Verification expired on Oct 1. This page may be out of date." */
  readerBanner(day: { short: string }): Locator {
    const text = `^Verification expired on ${onDay(day)}\\. This page may be out of date\\.`;
    return this.main.getByText(new RegExp(text));
  }

  /** Owners and editors of an expired page: "Due for review since Oct 1 · Review now". */
  reviewBanner(day: { short: string }): Locator {
    return this.main.getByText(new RegExp(`^Due for review since ${onDay(day)}`));
  }

  /** The status in the strip, "Draft" or "Published". */
  status(name: 'Draft' | 'Published'): Locator {
    return this.main.getByRole('button', { name: new RegExp(`^(Status:? )?${name}`) });
  }

  async publish() {
    await this.main.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(this.draftBanner).toBeHidden();
  }

  /** Back to draft asks first: "Readers won't see this page anymore." */
  async backToDraft() {
    await this.status('Published').click();
    await choice(this.page, /^back to draft/i).click();
    const confirm = confirmDialog(this.page, "Readers won't see this page anymore.");
    await confirm.getByRole('button', { name: /back to draft/i }).click();
    await expect(confirm).toBeHidden();
    await expect(this.draftBanner).toBeVisible();
  }

  /** The review bar, from Review now or a notice: "Still correct? · Verify for 90 days · …". */
  get reviewBar(): Locator {
    return this.main.getByText('Still correct?', { exact: true });
  }

  /** Review now, in the banner of an expired page, opens the review bar. */
  async reviewNow() {
    await this.main
      .getByRole('button', { name: 'Review now' })
      .or(this.main.getByRole('link', { name: 'Review now' }))
      .first()
      .click();
    await expect(this.reviewBar).toBeVisible();
  }

  /** A choice in the review bar: /^Verify for/ (the default period), "Needs changes" or "Archive". */
  async review(option: RegExp | 'Needs changes' | 'Archive') {
    await this.main
      .getByRole('button', { name: option, exact: typeof option === 'string' })
      .click();
    await expect(this.reviewBar).toBeHidden();
  }

  /** The verify menu from the badge: a period such as /90 days/, or Remove verification. */
  async verify(period: RegExp) {
    await this.main
      .getByRole('button', { name: /not verified|verified by|verification expired/i })
      .first()
      .click();
    await choice(this.page, period).click();
  }
}
