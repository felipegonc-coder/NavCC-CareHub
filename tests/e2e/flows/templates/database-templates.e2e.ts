import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  addRow,
  config,
  makeDatabase,
  optionId,
  tableView,
} from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { literally } from '../pages/page-screen.js';
import {
  NewRowMenu,
  addRowBy,
  addRowTemplate,
  setDatabaseDefault,
  setViewDefault,
} from './templates-page.js';

// Templates and buttons, section 3.2, and Databases additions, section 6: which template New uses,
// and what New ▾ and an empty row's "Start with" offer. Eli (Editor) makes the database, so has
// Full access on it; its templates and defaults are set through the API (decision 0200).

test.describe('Templates: database templates', () => {
  onlyIn('desktop-light');
  // Database templates are the Databases lane's screens; the defaults and lists are this spec's.
  needs('signIn', 'appShell', 'pages', 'databases', 'templates');

  test('TB-04 New uses the view default, then the database default, then an empty row; New ▾ and "Start with" offer every template and Empty', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const tasks = await makeDatabase(page, uniqueName('Fictional QA Tasks'));
    const stage = await addProperty(page, tasks.id, 'Stage', config.select('Triage', 'Done'));
    const bug = await addRowTemplate(page, tasks.id, 'Fictional QA bug report', {
      [stage.id]: optionId(stage, 'Triage'),
    });
    const chore = await addRowTemplate(page, tasks.id, 'Fictional QA chore', {
      [stage.id]: optionId(stage, 'Done'),
    });
    // Made before any default is set, so it starts empty: the row page shows "Start with".
    const blank = await addRow(page, tasks.id, uniqueName('Fictional QA empty task'));
    const screen = new DatabaseScreen(page, tasks.id);
    const newMenu = new NewRowMenu(screen);
    const stages = (shown: string) => screen.column(stage.id).filter({ hasText: shown });
    const pressNew = () => addRowBy(screen, () => screen.button('New').first().click());

    await test.step('Templates are not rows; with no default, New makes an empty row', async () => {
      await screen.open();
      await expect(screen.rows()).toHaveCount(1);
      await pressNew();
      await expect(stages('Triage')).toHaveCount(0);
      await expect(stages('Done')).toHaveCount(0);
    });

    await test.step("With the database's default, New uses it", async () => {
      await setDatabaseDefault(page, tasks.id, chore.id);
      await screen.open();
      await pressNew();
      await expect(stages('Done')).toHaveCount(1);
      await expect(stages('Triage')).toHaveCount(0);
    });

    await test.step("With the view's own default as well, New uses the view's", async () => {
      await setViewDefault(page, tasks.id, tableView(tasks).id, bug.id);
      await screen.open();
      await pressNew();
      await expect(stages('Triage')).toHaveCount(1);
      await expect(stages('Done')).toHaveCount(1);
    });

    await test.step('New ▾ lists every template in order, the default marked, then Empty and + New template', async () => {
      const menu = await newMenu.open();
      await expect(menu.getByRole('menuitem')).toContainText([bug.name, chore.name]);
      await expect(newMenu.item(bug.name)).toContainText('Default');
      await expect(newMenu.item(chore.name)).not.toContainText('Default');
      await expect(newMenu.empty).toBeVisible();
      await expect(newMenu.item(/new template/i)).toBeVisible();
      await page.keyboard.press('Escape');
    });

    await test.step('New ▾ → a template, and New ▾ → Empty', async () => {
      await addRowBy(screen, async () => {
        await newMenu.open();
        await newMenu.item(chore.name).click();
      });
      await expect(stages('Done')).toHaveCount(2);
      await addRowBy(screen, async () => {
        await newMenu.open();
        await newMenu.empty.click();
      });
      await expect(screen.rows()).toHaveCount(6);
      await expect(stages('Done')).toHaveCount(2);
      await expect(stages('Triage')).toHaveCount(1);
    });

    await test.step('An empty row page offers "Start with:" every template and Empty', async () => {
      const rowPage = await screen.openRow(blank.id, blank.title);
      await expect(rowPage.getByText(/^Start with:?$/)).toBeVisible();
      for (const name of [bug.name, chore.name]) {
        await expect(rowPage.getByRole('button', { name: literally(name) })).toBeVisible();
      }
      await expect(rowPage.getByRole('button', { name: 'Empty', exact: true })).toBeVisible();
    });
  });
});
