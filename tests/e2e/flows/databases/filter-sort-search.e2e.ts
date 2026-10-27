import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  addRow,
  addView,
  config,
  filter,
  makeDatabase,
  nameOf,
  optionId,
  tableView,
  updateView,
  value,
} from './database-api.js';
import { DatabaseScreen, containing, signedInPage } from './database-page.js';

// Databases spec: DB-05, DB-06 and DB-23. Rows are named "<tag> Alpha", "<tag> Beta" and so on,
// with a unique tag per test; titles() lists the rows a view should show, in order.
test.describe('Databases: filters, sorts and search', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases');

  test('DB-05 editor filters are shared, viewer changes stay hers', async ({ page, browser }) => {
    test.slow();
    await signInAs(page, 'editor');
    const tag = uniqueName('Fictional QA');
    const titles = (...words: string[]) => words.map((word) => containing(`${tag} ${word}`));
    const database = await makeDatabase(page);
    const name = nameOf(database);
    const score = await addProperty(page, database.id, 'Score', config.number());
    const scores = { Alpha: 9, Beta: 3, Gamma: 1, Delta: 7 };
    for (const [word, points] of Object.entries(scores)) {
      await addRow(page, database.id, `${tag} ${word}`, { [score.id]: value.number(points) });
    }
    const eli = new DatabaseScreen(page, database.id);
    const viewer = await signedInPage(browser, 'viewer');
    const val = new DatabaseScreen(viewer, database.id);

    await test.step('Eli saves a nested filter: Score above 5, or below 2', async () => {
      await updateView(page, database.id, tableView(database).id, {
        filter: filter.all(
          filter.where(name.id, 'contains', tag),
          filter.any(filter.where(score.id, 'gt', '5'), filter.where(score.id, 'lt', '2')),
        ),
      });
      await eli.open();
      await expect(eli.column(name.id)).toHaveText(titles('Alpha', 'Gamma', 'Delta'));
      await expect(eli.forYouOnly()).toHaveCount(0);
    });

    await test.step('Val sees the same rows, with no "Changed for you only"', async () => {
      await val.open();
      await expect(val.column(name.id)).toHaveText(titles('Alpha', 'Gamma', 'Delta'));
      await expect(val.forYouOnly()).toHaveCount(0);
    });

    await test.step('Val filters for herself: "Changed for you only"', async () => {
      await val.addFilter('Name', 'Delta');
      await expect(val.column(name.id)).toHaveText(titles('Delta'));
      await expect(val.forYouOnly()).toBeVisible();
      await expect(val.button('Reset')).toBeVisible();
      await eli.open();
      await expect(eli.column(name.id)).toHaveText(titles('Alpha', 'Gamma', 'Delta'));
    });

    await test.step('Reset, or a reload, brings back the saved filter', async () => {
      await val.button('Reset').click();
      await expect(val.column(name.id)).toHaveText(titles('Alpha', 'Gamma', 'Delta'));
      await expect(val.forYouOnly()).toHaveCount(0);
      await val.addFilter('Name', 'Gamma');
      await expect(val.column(name.id)).toHaveText(titles('Gamma'));
      await viewer.reload();
      await expect(val.column(name.id)).toHaveText(titles('Alpha', 'Gamma', 'Delta'));
      await expect(val.forYouOnly()).toHaveCount(0);
    });

    await test.step('A filter Eli adds on the screen is saved for Val too', async () => {
      await eli.addFilter('Name', 'Alpha');
      await expect(eli.column(name.id)).toHaveText(titles('Alpha'));
      await expect(async () => {
        await viewer.reload();
        await expect(val.column(name.id)).toHaveText(titles('Alpha'), { timeout: 2_000 });
      }).toPass();
      await viewer.context().close();
    });
  });

  test('DB-06 sorts keep empty values last and Select uses option order', async ({ page }) => {
    await signInAs(page, 'editor');
    const tag = uniqueName('Fictional QA');
    const titles = (...words: string[]) => words.map((word) => containing(`${tag} ${word}`));
    const database = await makeDatabase(page);
    const name = nameOf(database);
    const score = await addProperty(page, database.id, 'Score', config.number());
    const tier = await addProperty(page, database.id, 'Tier', config.select('Mid', 'Top', 'Low'));
    await addRow(page, database.id, `${tag} Alpha`, {
      [score.id]: value.number(9),
      [tier.id]: optionId(tier, 'Low'),
    });
    await addRow(page, database.id, `${tag} Beta`, {
      [score.id]: value.number(3),
      [tier.id]: optionId(tier, 'Mid'),
    });
    await addRow(page, database.id, `${tag} Gamma`, { [tier.id]: optionId(tier, 'Top') });
    await addRow(page, database.id, `${tag} Delta`, { [score.id]: value.number(1) });
    await addView(page, database.id, 'Fictional by tier', 'table');
    const screen = new DatabaseScreen(page, database.id);
    await screen.open();

    await test.step('Score ascending, then descending: the empty one stays last', async () => {
      await screen.sort('Score', 'ascending');
      await expect(screen.column(name.id)).toHaveText(titles('Delta', 'Beta', 'Alpha', 'Gamma'));
      await screen.sort('Score', 'descending');
      await expect(screen.column(name.id)).toHaveText(titles('Alpha', 'Beta', 'Delta', 'Gamma'));
    });

    await test.step('Tier sorts by option order (Mid, Top, Low), empty last', async () => {
      await screen.tab('Fictional by tier').click();
      await screen.sort('Tier', 'ascending');
      await expect(screen.column(name.id)).toHaveText(titles('Beta', 'Gamma', 'Alpha', 'Delta'));
      await screen.sort('Tier', 'descending');
      await expect(screen.column(name.id)).toHaveText(titles('Alpha', 'Gamma', 'Beta', 'Delta'));
    });
  });

  test('DB-23 search finds titles, text and options; Esc clears it', async ({ page }) => {
    await signInAs(page, 'editor');
    const tag = uniqueName('Fictional QA');
    const titles = (...words: string[]) => words.map((word) => containing(`${tag} ${word}`));
    const database = await makeDatabase(page);
    const name = nameOf(database);
    const notes = await addProperty(page, database.id, 'Notes', config.text());
    const tier = await addProperty(page, database.id, 'Tier', config.select('Mid', 'Top', 'Low'));
    await addRow(page, database.id, `${tag} Alpha`, { [notes.id]: value.text('Fictional box') });
    await addRow(page, database.id, `${tag} Beta`, { [tier.id]: optionId(tier, 'Top') });
    await addRow(page, database.id, `${tag} Gamma`);
    const screen = new DatabaseScreen(page, database.id);
    await screen.open();

    await test.step('A title: "Gamma"', async () => {
      await screen.search('Gamma');
      await expect(screen.column(name.id)).toHaveText(titles('Gamma'));
    });

    await test.step('Text in a property: "box"', async () => {
      await screen.searchBox().fill('box');
      await expect(screen.column(name.id)).toHaveText(titles('Alpha'));
    });

    await test.step('An option name: "Top"', async () => {
      await screen.searchBox().fill('Top');
      await expect(screen.column(name.id)).toHaveText(titles('Beta'));
    });

    await test.step('Esc clears the search and every row is back', async () => {
      await screen.searchBox().press('Escape');
      await expect(screen.column(name.id)).toHaveText(titles('Alpha', 'Beta', 'Gamma'));
    });
  });
});
