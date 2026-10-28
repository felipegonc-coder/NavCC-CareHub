import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makeDatabase } from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { Editor } from '../editor/editor-page.js';
import { confirmDialog } from '../history-trash/history-page.js';
import { literally, pageIdOf } from '../pages/page-screen.js';
import { ButtonSettings, undoOf } from './templates-page.js';

// Templates and buttons, sections 2 and 3.4: a "/button" block with three actions run in order,
// and Undo for 8 seconds after a run that changed things; Show a confirmation and its Cancel. Eli
// (Editor) sets them up and presses them: the default "People who can edit" lets Eli press them,
// and Eli can add rows to own database.

test.describe('Templates: button blocks', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'slashMenu', 'databases', 'templates');

  test('TB-09 a button that inserts a to-do, adds a row to Tickets and opens it does all three, and Undo reverses them', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const tickets = await makeDatabase(page, uniqueName('Fictional QA Tickets'));
    const label = 'Fictional QA start the shift';
    const todo = 'Fictional QA check the queue';
    const editor = await Editor.onNewPage(page);
    const settings = new ButtonSettings(page);
    const button = editor.content.getByRole('button', { name: label });
    const inserted = editor.content.getByText(todo);

    await test.step('"/button" adds a button and opens its settings', async () => {
      await page.keyboard.type('/button');
      await editor.option('Button').click();
      await expect(settings.dialog).toBeVisible();
      await settings.label.fill(label);
    });

    await test.step('Insert blocks: a to-do', async () => {
      const step = await settings.addAction('Insert blocks');
      await step.getByRole('textbox').first().click();
      await page.keyboard.type(`[] ${todo}`);
    });

    await test.step('Add a row to Tickets, then open that row in a new tab', async () => {
      const adding = await settings.addAction('Add a row');
      await settings.choose(adding, /database/i, literally(tickets.title));
      const opening = await settings.addAction('Open a page');
      await settings.choose(opening, /^page/i, /step 2/i);
      await settings.choose(opening, /open in/i, 'New tab');
      await expect(settings.sentence).toContainText(tickets.title);
      await settings.done();
      await expect(button).toBeVisible();
      await expect(inserted).toHaveCount(0);
    });

    let rowId = '';
    await test.step('Pressing it inserts the to-do, adds the row and opens it in a new tab', async () => {
      const opened = page.context().waitForEvent('page');
      await button.click();
      const tab = await opened;
      await tab.waitForURL(/\/p\/[^/?#]+/);
      rowId = pageIdOf(tab);
      await expect(inserted).toBeVisible();
      await expect(editor.block('To-do list')).toHaveCount(1);
      const row = await (
        await apiFor(page)
      ).send('GET', `/api/databases/${tickets.id}/rows/${rowId}`);
      expect(row.status()).toBe(200);
    });

    await test.step('Undo within 8 seconds takes the to-do and the row away', async () => {
      await undoOf(page).click();
      await expect(inserted).toHaveCount(0);
      await expect(button).toBeVisible();
      const ticketsScreen = new DatabaseScreen(page, tickets.id);
      await ticketsScreen.open();
      await expect(ticketsScreen.rows()).toHaveCount(0);
    });
  });

  test('TB-13 Cancel in Show a confirmation stops the run with no changes, and Continue runs the rest', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const tickets = await makeDatabase(page, uniqueName('Fictional QA Tickets'));
    const label = 'Fictional QA log a callback';
    const question = 'Fictional QA add a callback ticket?';
    const editor = await Editor.onNewPage(page);
    const pageId = pageIdOf(page);
    const settings = new ButtonSettings(page);
    const button = editor.content.getByRole('button', { name: label });
    const asking = confirmDialog(page, question);
    const ticketsScreen = new DatabaseScreen(page, tickets.id);

    await test.step('"/button": Show a confirmation, then Add a row to Tickets', async () => {
      await page.keyboard.type('/button');
      await editor.option('Button').click();
      await expect(settings.dialog).toBeVisible();
      await settings.label.fill(label);
      const confirming = await settings.addAction('Show a confirmation');
      await confirming.getByRole('textbox').first().fill(question);
      const adding = await settings.addAction('Add a row');
      await settings.choose(adding, /database/i, literally(tickets.title));
      await settings.done();
      await expect(button).toBeVisible();
    });

    await test.step('Pressing it asks with Continue and Cancel; Cancel stops the run', async () => {
      await button.click();
      await expect(asking).toBeVisible();
      await expect(asking.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
      await asking.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(asking).toBeHidden();
      await expect(undoOf(page)).toHaveCount(0);
      await ticketsScreen.open();
      await expect(ticketsScreen.rows()).toHaveCount(0);
    });

    await test.step('Pressing it again and choosing Continue adds the row', async () => {
      await editor.screen.goto(pageId);
      await button.click();
      await asking.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(asking).toBeHidden();
      await expect(undoOf(page)).toBeVisible();
      await ticketsScreen.open();
      await expect(ticketsScreen.rows()).toHaveCount(1);
    });
  });
});
