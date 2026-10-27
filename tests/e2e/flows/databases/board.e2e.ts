import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { Board } from './board-page.js';
import {
  addProperty,
  addRow,
  addView,
  config,
  getRow,
  makeDatabase,
  optionId,
  updateView,
  value,
  type Row,
} from './database-api.js';
import { DatabaseScreen, containing, signedInPage } from './database-page.js';

// Databases spec: DB-10. Each test makes its own database with Status (To do, Doing, Done), Score
// and a Board view grouped by Status, whose columns are keyed by option id.

type Column = 'To do' | 'Doing' | 'Done';

const BOARD = 'Fictional board';

async function makeBoard(page: Page) {
  const database = await makeDatabase(page, uniqueName('Fictional tickets'));
  const status = await addProperty(
    page,
    database.id,
    'Status',
    config.status(['To do', 'todo'], ['Doing', 'in_progress'], ['Done', 'complete']),
  );
  const score = await addProperty(page, database.id, 'Score', config.number());
  const view = await addView(page, database.id, BOARD, 'board');
  await updateView(page, database.id, view.id, { grouping: { propertyId: status.id } });
  const key = (column: Column) => optionId(status, column);
  return {
    database,
    status,
    score,
    view,
    key,
    /** Adds a card to a column. */
    add: (title: string, column: Column, points: number) =>
      addRow(page, database.id, title, {
        [status.id]: key(column),
        [score.id]: value.number(points),
      }),
    /** Opens the database on its board. */
    open: async (on: Page = page) => {
      const screen = new DatabaseScreen(on, database.id);
      await screen.open();
      await screen.tab(BOARD).click();
      return new Board(screen);
    },
    /** The Status option a row has now, as the server keeps it. */
    statusOf: async (row: Row) => (await getRow(page, database.id, row.id)).values[status.id],
  };
}

test.describe('Databases: board moves', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'databaseViews');

  test('DB-10 a mouse drag from To do to Doing changes the Status', async ({ page }) => {
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional Call back Blue Pine Plumbing');
    const s = await makeBoard(page);
    const row = await s.add(title, 'To do', 1);
    const board = await s.open();
    await expect(board.cards(s.key('To do'))).toHaveText([containing(title)]);

    await board.drag(row.id, s.key('Doing'));
    await expect(board.cards(s.key('Doing'))).toHaveText([containing(title)]);
    await expect(board.cards(s.key('To do'))).toHaveCount(0);
    await expect.poll(() => s.statusOf(row)).toBe(s.key('Doing'));

    const reopened = await s.open();
    await expect(reopened.cards(s.key('Doing'))).toHaveText([containing(title)]);
  });

  test('DB-10 a keyboard move changes the Status and is announced; Esc cancels', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional Call back Blue Pine Plumbing');
    const s = await makeBoard(page);
    const row = await s.add(title, 'To do', 1);
    const board = await s.open();

    await test.step('Space, →, Space moves the card to Doing', async () => {
      await board.moveWithKeys(row.id, 'ArrowRight');
      await expect(board.cards(s.key('Doing'))).toHaveText([containing(title)]);
      await expect(board.announcement(title, 'Doing')).toBeAttached();
      await expect.poll(() => s.statusOf(row)).toBe(s.key('Doing'));
    });

    await test.step('Space, →, Esc leaves it where it was', async () => {
      await board.pickUp(row.id);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Escape');
      await expect(board.cards(s.key('Doing'))).toHaveText([containing(title)]);
      await expect(board.cards(s.key('Done'))).toHaveCount(0);
      expect(await s.statusOf(row)).toBe(s.key('Doing'));
    });
  });

  test('DB-10 Move to… in the card menu changes the Status', async ({ page }) => {
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional Call back Blue Pine Plumbing');
    const s = await makeBoard(page);
    const row = await s.add(title, 'To do', 1);
    const board = await s.open();

    await board.moveWithMenu(row.id, 'Done');
    await expect(board.cards(s.key('Done'))).toHaveText([containing(title)]);
    await expect(board.cards(s.key('To do'))).toHaveCount(0);
    await expect.poll(() => s.statusOf(row)).toBe(s.key('Done'));
  });

  test('DB-10 with a sort on, a card dropped at the top of a column stays in sorted order', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const tag = uniqueName('Fictional ticket');
    const s = await makeBoard(page);
    await s.add(`${tag} Ten`, 'Doing', 10);
    await s.add(`${tag} Twenty`, 'Doing', 20);
    const thirty = await s.add(`${tag} Thirty`, 'To do', 30);
    await updateView(page, s.database.id, s.view.id, {
      sorts: [{ propertyId: s.score.id, direction: 'asc' }],
    });
    const board = await s.open();
    const sorted = ['Ten', 'Twenty', 'Thirty'].map((word) => containing(`${tag} ${word}`));
    await expect(board.cards(s.key('Doing'))).toHaveText(sorted.slice(0, 2));

    await board.drag(thirty.id, s.key('Doing'));
    await expect(board.cards(s.key('Doing'))).toHaveText(sorted);
    await expect.poll(() => s.statusOf(thirty)).toBe(s.key('Doing'));
  });

  test("DB-10 a viewer can't move a card: the server refuses it (403)", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional Call back Blue Pine Plumbing');
    const s = await makeBoard(page);
    const row = await s.add(title, 'To do', 1);
    const viewer = await signedInPage(browser, 'viewer');

    const refused = await (
      await apiFor(viewer)
    ).send('PATCH', `/api/databases/${s.database.id}/rows/${row.id}`, {
      values: { [s.status.id]: s.key('Doing') },
    });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'forbidden' } });

    const board = await s.open(viewer);
    await expect(board.cards(s.key('To do'))).toHaveText([containing(title)]);
    expect(await s.statusOf(row)).toBe(s.key('To do'));
    await viewer.context().close();
  });
});
