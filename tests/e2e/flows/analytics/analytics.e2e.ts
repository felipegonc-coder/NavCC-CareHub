import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, people, signInAs, test, uniqueName } from '../_support/index.js';
import * as data from './analytics-data.js';
import * as an from './analytics-page.js';

// The Analytics ⭐ checks, from the Analytics spec's Done means and section 7. Avery (the fictional
// admin) looks at Analytics; Eli and Casey open the pages. Each flow makes its own page in the
// team space, with a unique name, because the whole run shares one database and other flows
// open pages at the same time. Days are in Avery's time zone, the default America/Denver.

const { MINUTE } = data;

/** Opens the page `times` times in a row, each time until its title shows. */
async function open(visitor: Page, id: string, title: string, times = 1): Promise<void> {
  for (let time = 0; time < times; time += 1) {
    await visitor.goto(`/p/${id}`);
    await expect(visitor.getByText(title).first()).toBeVisible();
  }
}

/** Pages tab numbers for `title`, waiting up to 30 seconds for them to become `expected`. */
async function expectNumbers(
  page: Page,
  title: string,
  expected: { views: number; viewers: number },
) {
  await expect(async () => {
    await an.openAnalytics(page);
    expect(await an.pageNumbers(page, title)).toEqual(expected);
  }).toPass({ timeout: 30_000 });
}

test.describe('Analytics: counting views', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'analytics');

  test('AN-01 three opens of Refund policy within 30 minutes count as 1 view', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const title = uniqueName('Refund policy');
    const id = await data.makeTeamPage(page, title);
    const eli = await an.windowFor(browser, 'editor');
    try {
      await open(eli, id, title, 3);
      await expectNumbers(page, title, { views: 1, viewers: 1 });
    } finally {
      await eli.context().close();
    }
  });

  test('AN-01 one more open after 31 minutes makes 2 views', async ({ page, browser }) => {
    test.skip(
      !process.env.E2E_LONG_WAITS,
      'Runs by hand, as it waits 31 minutes: set E2E_LONG_WAITS=1',
    );
    test.setTimeout(40 * MINUTE);
    await signInAs(page, 'admin');
    const title = uniqueName('Refund policy');
    const id = await data.makeTeamPage(page, title);
    const eli = await an.windowFor(browser, 'editor');
    try {
      await open(eli, id, title, 3);
      await expectNumbers(page, title, { views: 1, viewers: 1 });
      await eli.waitForTimeout(31 * MINUTE);
      await open(eli, id, title);
      await expectNumbers(page, title, { views: 2, viewers: 1 });
    } finally {
      await eli.context().close();
    }
  });
});

test.describe('Analytics: Overview', () => {
  onlyIn('desktop-light');
  needs('signIn', 'analytics');

  test("AN-04 Overview for 7, 30 and 90 days: each range has its days in the viewer's time zone, the days add up to the totals, and longer ranges hold the shorter ones", async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    await an.openAnalytics(page);
    await an.openTab(page, 'Overview');
    // Other flows open pages while this runs, so numbers only grow between two looks.
    let shorter: an.Totals | undefined;
    for (const days of [7, 30, 90] as const) {
      await test.step(`the last ${days} days`, async () => {
        await an.chooseRange(page, days);
        await an.showChartsAsTables(page);
        const tables = an.dayTables(page);
        await expect
          .poll(async () => (await an.readTable(tables.activity)).length - 1, {
            message: 'one row per day',
          })
          .toBe(days);
        const before = await an.totals(page);
        const activity = await an.readTable(tables.activity);
        const viewsAndEdits = await an.readTable(tables.viewsAndEdits);
        const after = await an.totals(page);

        const today = an.today();
        for (const rows of [activity, viewsAndEdits]) {
          expect(rows).toHaveLength(days + 1);
          expect(rows.at(1)?.[0], 'the first day').toMatch(
            an.dayLabel(an.addDays(today, 1 - days)),
          );
          expect(rows.at(-1)?.[0], "today, in Avery's time zone").toMatch(an.dayLabel(today));
        }
        const sum = (rows: string[][], header: RegExp) => {
          const index = an.column(rows, header);
          return rows.slice(1).reduce((total, row) => total + an.toNumber(row[index]), 0);
        };
        const views = sum(viewsAndEdits, /^(page )?views$/i);
        const edits = sum(viewsAndEdits, /^edits$/i);
        expect(views, 'views per day add up to Page views').toBeGreaterThanOrEqual(before.views);
        expect(views).toBeLessThanOrEqual(after.views);
        expect(edits, 'edits per day add up to Edits').toBeGreaterThanOrEqual(before.edits);
        expect(edits).toBeLessThanOrEqual(after.edits);
        const active = an.column(activity, /active/i);
        for (const row of activity.slice(1)) {
          expect(an.toNumber(row[active]), 'active on one day, at most all').toBeLessThanOrEqual(
            after.activePeople,
          );
        }
        if (shorter) {
          for (const key of Object.keys(before) as (keyof an.Totals)[]) {
            expect(
              before[key],
              `${key} over ${days} days holds the shorter range`,
            ).toBeGreaterThanOrEqual(shorter[key]);
          }
        }
        shorter = after;
      });
    }
  });
});

test.describe("Analytics: a page's visits", () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'analytics');

  test("AN-05 Refund policy's detail lists its visits with person and time, and its CSV matches the table", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const title = uniqueName('Refund policy');
    const id = await data.makeTeamPage(page, title);
    const visitors = [
      await an.windowFor(browser, 'editor'),
      await an.windowFor(browser, 'commenter'),
    ];
    const names = await Promise.all(
      [people.editor.email, people.commenter.email].map(async (email) => {
        const { name } = await data.member(page, email);
        return name;
      }),
    );
    try {
      for (const visitor of visitors) await open(visitor, id, title);
      let rows: string[][] = [];

      await test.step('the detail lists Eli and Casey, each with a time', async () => {
        await expect(async () => {
          await an.openAnalytics(page);
          rows = await an.readTable(await an.openPageDetail(page, title));
          const person = an.column(rows, /^(person|who|people|name)$/i);
          for (const name of names) {
            expect(rows.slice(1).map((row) => row[person])).toContain(name);
          }
        }).toPass({ timeout: 30_000 });
        const time = an.column(rows, /^(time|when|date|date and time|viewed|at)$/i);
        for (const row of rows.slice(1)) {
          expect(row[time], 'a time of day').toMatch(/\d{1,2}:\d{2}/);
        }
      });

      await test.step('Export CSV gives the same visits as the table', async () => {
        const visits = an.tableWith(page, /^(person|who|people|name)$/i).last();
        const csv = await an.exportCsv(page, visits);
        const [headers = [], ...lines] = rows;
        const [csvHeaders = [], ...csvLines] = csv;
        const lower = (texts: string[]) => texts.map((text) => text.trim().toLowerCase());
        // Every column of the table is in the CSV, in any order, and nothing is left out.
        const where = lower(headers).map((header) => lower(csvHeaders).indexOf(header));
        expect(where, `CSV columns ${JSON.stringify(csvHeaders)}`).not.toContain(-1);
        expect(csvLines).toHaveLength(lines.length);
        const key = (cells: (string | undefined)[]) => cells.map((cell) => cell ?? '').join(' | ');
        const unmatched = [...csvLines];
        for (const line of lines) {
          const match = unmatched.findIndex((csvLine) =>
            where.every((at, index) => an.sameValue(line[index] ?? '', csvLine[at] ?? '')),
          );
          expect(match, `a CSV line for ${key(line)}`).toBeGreaterThanOrEqual(0);
          unmatched.splice(match, 1);
        }
      });
    } finally {
      for (const visitor of visitors) await visitor.context().close();
    }
  });
});
