import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { addProperty, addRow, config, makeDatabase, nameOf } from './database-api.js';
import { DatabaseScreen, containing } from './database-page.js';

// Databases spec: DB-01, DB-03, DB-08 ("+ New") and DB-25. Each test makes its own database in a
// new fictional page of the team space, then works through the screens as Eli (Editor).
test.describe('Databases: a new database, its values and its states', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases');

  test('DB-01 a new database has Name, a Table view and No rows yet', async ({ page }) => {
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const screen = new DatabaseScreen(page, database.id);

    await test.step('Open the new full-page database', async () => {
      await screen.open();
    });

    await test.step('It has the Name property and the Table view', async () => {
      await expect(screen.header('Name')).toBeVisible();
      await expect(screen.tab('Table')).toHaveAttribute('aria-selected', 'true');
      await expect(screen.rows()).toHaveCount(0);
    });

    await test.step('It shows "No rows yet." with New and Import CSV', async () => {
      await expect(screen.root.getByText('No rows yet.')).toBeVisible();
      await expect(screen.button('New').first()).toBeVisible();
      await expect(screen.button('Import CSV').first()).toBeVisible();
    });
  });

  test('DB-03 a value of each type can be set, changed and cleared', async ({ page }) => {
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const notes = await addProperty(page, database.id, 'Notes', config.text());
    const score = await addProperty(page, database.id, 'Score', config.number());
    const done = await addProperty(page, database.id, 'Done', config.checkbox());
    const team = await addProperty(page, database.id, 'Team', config.select('North', 'South'));
    const row = await addRow(page, database.id, uniqueName('Fictional QA row'));
    const screen = new DatabaseScreen(page, database.id);
    const tick = screen.cell(row.id, done.id).getByRole('checkbox');
    await screen.open();

    await test.step('Text: set, change and clear', async () => {
      await screen.editCell(row.id, notes.id, 'Fictional first note');
      await expect(screen.cell(row.id, notes.id)).toHaveText('Fictional first note');
      await screen.editCell(row.id, notes.id, 'Fictional second note');
      await expect(screen.cell(row.id, notes.id)).toHaveText('Fictional second note');
      await screen.editCell(row.id, notes.id, '');
      await expect(screen.cell(row.id, notes.id)).toHaveText('');
    });

    await test.step('Number: "seven" shows "Enter a number." and keeps 7', async () => {
      await screen.editCell(row.id, score.id, '42');
      await expect(screen.cell(row.id, score.id)).toHaveText('42');
      await screen.editCell(row.id, score.id, '7');
      await expect(screen.cell(row.id, score.id)).toHaveText('7');
      await screen.editCell(row.id, score.id, 'seven');
      await expect(page.getByText('Enter a number.')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(screen.cell(row.id, score.id)).toHaveText('7');
    });

    await test.step('Checkbox: tick, then untick', async () => {
      await tick.click();
      await expect(tick).toBeChecked();
      await tick.click();
      await expect(tick).not.toBeChecked();
    });

    await test.step('Select: pick an option, then change it', async () => {
      await screen.pickOption(row.id, team.id, 'North');
      await expect(screen.cell(row.id, team.id)).toHaveText('North');
      await screen.pickOption(row.id, team.id, 'South');
      await expect(screen.cell(row.id, team.id)).toHaveText('South');
    });

    await test.step('After a reload the last values are still there', async () => {
      await expect(async () => {
        await page.reload();
        await expect(screen.cell(row.id, team.id)).toHaveText('South', { timeout: 2_000 });
      }).toPass();
      await expect(screen.cell(row.id, notes.id)).toHaveText('');
      await expect(screen.cell(row.id, score.id)).toHaveText('7');
      await expect(tick).not.toBeChecked();
    });
  });

  test('DB-08 "+ New" adds a row with the cursor in its Name', async ({ page }) => {
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const screen = new DatabaseScreen(page, database.id);
    const names = screen.column(nameOf(database).id);
    const title = uniqueName('Fictional QA row');
    await screen.open();

    await test.step('Press "+ New" at the bottom of the table', async () => {
      await screen.button('+ New').click();
      await expect(screen.rows()).toHaveCount(1);
    });

    await test.step('Type at once: the cursor is already in Name', async () => {
      await expect(page.locator(':focus')).toBeEditable();
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      await expect(names).toHaveText([containing(title)]);
    });

    await test.step('The row and its title are kept after a reload', async () => {
      await expect(async () => {
        await page.reload();
        await expect(names).toHaveText([containing(title)], { timeout: 2_000 });
      }).toPass();
    });
  });

  test('DB-25 the empty, no-match and error states say what to do', async ({ page }) => {
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const screen = new DatabaseScreen(page, database.id);
    const rowsQuery = `**/api/databases/${database.id}/query`;
    const title = uniqueName('Fictional QA row');

    await test.step('With no rows: "No rows yet."', async () => {
      await screen.open();
      await expect(screen.root.getByText('No rows yet.')).toBeVisible();
    });

    await test.step('No match: "No rows match." and Clear search', async () => {
      await addRow(page, database.id, title);
      await screen.open();
      await screen.search(uniqueName('Fictional QA missing'));
      await expect(screen.root.getByText('No rows match.')).toBeVisible();
      await screen.button('Clear search').click();
      await expect(screen.row(title)).toBeVisible();
    });

    await test.step('A failed load: the error and Retry, which loads the rows', async () => {
      await page.route(rowsQuery, (route) => route.abort());
      await screen.open();
      const retry = page.getByRole('button', { name: 'Retry' });
      await expect(retry).toBeVisible();
      await page.unroute(rowsQuery);
      await retry.click();
      await expect(screen.row(title)).toBeVisible();
    });
  });
});
