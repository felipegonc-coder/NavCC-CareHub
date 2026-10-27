import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  addRow,
  config,
  getRow,
  makeDatabase,
  optionId,
  tableView,
  updateRow,
  updateView,
  value,
} from './database-api.js';
import { DatabaseScreen, containing, signedInPage } from './database-page.js';
import { RowPage } from './row-page.js';

// Databases spec: DB-09. Sam, who changes the row in the spec, isn't a seeded person: Avery (the
// seeded admin) stands in for him and changes it through the API while Eli has the row open.

/** A database with a Status property and one row in To do. */
async function ticket(page: Page) {
  const title = uniqueName('Fictional Call back Blue Pine Plumbing');
  const database = await makeDatabase(page);
  const status = await addProperty(
    page,
    database.id,
    'Status',
    config.status(['To do', 'todo'], ['Doing', 'in_progress'], ['Done', 'complete']),
  );
  const row = await addRow(page, database.id, title, { [status.id]: optionId(status, 'To do') });
  const set = (on: Page, option: string) =>
    updateRow(on, database.id, row.id, { [status.id]: optionId(status, option) });
  return { title, database, status, row, set };
}

test.describe('Databases: row pages', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases');

  test("DB-09 Next and Previous in the side panel follow the view's order", async ({ page }) => {
    await signInAs(page, 'editor');
    const tag = uniqueName('Fictional ticket');
    const alder = `${tag} Alder`;
    const birch = `${tag} Birch`;
    const cedar = `${tag} Cedar`;
    const database = await makeDatabase(page);
    const score = await addProperty(page, database.id, 'Score', config.number());
    // Made in this order, shown by Score: Birch (10), Cedar (20), Alder (30).
    await addRow(page, database.id, alder, { [score.id]: value.number(30) });
    await addRow(page, database.id, birch, { [score.id]: value.number(10) });
    const middle = await addRow(page, database.id, cedar, { [score.id]: value.number(20) });
    await updateView(page, database.id, tableView(database).id, {
      sorts: [{ propertyId: score.id, direction: 'asc' }],
    });
    const screen = new DatabaseScreen(page, database.id);
    const rowPage = new RowPage(page);
    await screen.open();
    await expect(screen.rows()).toHaveText([birch, cedar, alder].map(containing));

    await test.step('Next and Previous', async () => {
      await screen.openRow(middle.id, cedar);
      await rowPage.go(cedar, 'Next', alder);
      await rowPage.go(alder, 'Previous', cedar);
      await rowPage.go(cedar, 'Previous', birch);
    });

    await test.step('Ctrl+Shift+J opens the next row, Ctrl+Shift+K the previous; Esc closes', async () => {
      await page.keyboard.press('Control+Shift+J');
      await expect(rowPage.panel(cedar)).toBeVisible();
      await page.keyboard.press('Control+Shift+J');
      await expect(rowPage.panel(alder)).toBeVisible();
      await page.keyboard.press('Control+Shift+K');
      await expect(rowPage.panel(cedar)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(screen.grid).toBeVisible();
    });
  });

  test.describe('with live updates', () => {
    needs('liveUpdates');

    test("DB-09 Sam's Status change shows within 2 seconds in the side panel and the full page", async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'editor');
      const t = await ticket(page);
      // Avery stands in for Sam (spec); any member who can edit gives the same result.
      const sam = await signedInPage(browser, 'admin');
      try {
        const screen = new DatabaseScreen(page, t.database.id);
        const rowPage = new RowPage(page);
        await screen.open();

        await test.step('In the side panel', async () => {
          const panel = await screen.openRow(t.row.id, t.title);
          await expect(panel.getByText('To do', { exact: true })).toBeVisible();
          await t.set(sam, 'Doing');
          await expect(panel.getByText('Doing', { exact: true })).toBeVisible({ timeout: 2_000 });
        });

        await test.step('On the full page', async () => {
          const main = await rowPage.openFullPage(t.title, t.row.id);
          await expect(main.getByText('Doing', { exact: true })).toBeVisible();
          await t.set(sam, 'Done');
          await expect(main.getByText('Done', { exact: true })).toBeVisible({ timeout: 2_000 });
        });
      } finally {
        await sam.context().close();
      }
    });
  });

  test("DB-09 a viewer opens the row as a page but can't change it (403)", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const t = await ticket(page);
    const viewer = await signedInPage(browser, 'viewer');
    try {
      await viewer.goto(`/p/${t.row.id}`);
      await expect(viewer.getByRole('main').getByText('To do', { exact: true })).toBeVisible();

      const refused = await (
        await apiFor(viewer)
      ).send('PATCH', `/api/databases/${t.database.id}/rows/${t.row.id}`, {
        values: { [t.status.id]: optionId(t.status, 'Done') },
      });
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: 'forbidden' } });
      const kept = await getRow(page, t.database.id, t.row.id);
      expect(kept.values[t.status.id]).toBe(optionId(t.status, 'To do'));
    } finally {
      await viewer.context().close();
    }
  });
});
