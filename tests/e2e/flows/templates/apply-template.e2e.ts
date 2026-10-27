import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  addRow,
  config,
  getRow,
  makeDatabase,
  optionId,
} from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { VersionHistory } from '../history-trash/history-page.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { NewRowMenu, addRowTemplate, applyTemplate } from './templates-page.js';

// Templates and buttons, section 3.2: page menu → Apply template on a row that already has values
// and content. Eli (Editor) makes Tickets, so has Full access on it; the template's values are set
// through the API (decision 0200) and its content in the template's own row page. The version
// saved first is Page history and Trash, section 3.1 (Extra versions). The template's content is
// checked in a second tab before Eli leaves it, so it has been saved.

/** The row's text, in order: the notes come before the steps when the steps are added at the end. */
const inOrder = (...texts: string[]) =>
  new RegExp(texts.map((text) => literally(text).source).join('[\\s\\S]*'));

test.describe('Templates: applying a template to a row', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'databases', 'templates', 'trashHistory');

  test('TB-06 Apply template fills only empty properties unless Replace values is ticked, adds its content at the end and saves a version first', async ({
    page,
  }) => {
    test.slow(); // The template is opened twice, and the history three times.
    await signInAs(page, 'editor');
    const tickets = await makeDatabase(page, uniqueName('Fictional QA Tickets'));
    const status = await addProperty(
      page,
      tickets.id,
      'Status',
      config.status(['Open', 'todo'], ['Done', 'complete']),
    );
    const priority = await addProperty(page, tickets.id, 'Priority', config.select('High', 'Low'));
    const template = await addRowTemplate(page, tickets.id, 'Fictional QA triage', {
      [status.id]: optionId(status, 'Open'),
      [priority.id]: optionId(priority, 'High'),
    });
    const ticket = await addRow(page, tickets.id, uniqueName('Fictional QA ticket'), {
      [status.id]: optionId(status, 'Done'),
    });
    const notes = 'Fictional QA notes from the first call';
    const steps = 'Fictional QA triage steps';
    const rowScreen = new PageScreen(page);
    const history = new VersionHistory(page);
    const valuesNow = async () => (await getRow(page, tickets.id, ticket.id)).values;
    const contentNow = () => rowScreen.content.innerText();
    let before = 0;

    await test.step("The template's own row page gets a line of steps, saved before Eli leaves", async () => {
      const screen = new DatabaseScreen(page, tickets.id);
      await screen.open();
      const editing = await new NewRowMenu(screen).edit(template.name, tickets.title);
      await editing.getByRole('textbox', { name: 'Page content' }).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(steps);
      await expect(editing).toContainText(steps);
      // Saved: the template shows the steps when it's opened again in a new tab.
      const tab = await page.context().newPage();
      try {
        const again = new DatabaseScreen(tab, tickets.id);
        await again.open();
        const reopened = await new NewRowMenu(again).edit(template.name, tickets.title);
        await expect(reopened).toContainText(steps);
      } finally {
        await tab.close();
      }
    });

    await test.step('The ticket, Done with no Priority, gets notes of its own', async () => {
      await rowScreen.goto(ticket.id);
      await rowScreen.typeAtEnd(notes);
      await expect(rowScreen.content).toContainText(notes);
      await history.open();
      await expect(history.versions.first().or(history.empty)).toBeVisible();
      before = await history.versions.count();
      await history.close();
    });

    await test.step('Apply template: Priority fills in, Status stays Done, the steps come after the notes', async () => {
      await applyTemplate(page, template.name);
      await expect.poll(contentNow).toMatch(inOrder(notes, steps));
      await expect.poll(valuesNow).toMatchObject({
        [status.id]: optionId(status, 'Done'),
        [priority.id]: optionId(priority, 'High'),
      });
    });

    await test.step('A version from just before is saved: the notes without the steps', async () => {
      await history.open();
      await expect(history.versions).toHaveCount(before + 1);
      await history.versions.first().click();
      await expect(history.dialog).toContainText(notes);
      await expect(history.dialog).not.toContainText(steps);
      await history.close();
    });

    await test.step('With Replace values ticked, Status becomes Open and the steps are added again', async () => {
      await applyTemplate(page, template.name, true);
      await expect.poll(contentNow).toMatch(inOrder(notes, steps, steps));
      await expect.poll(valuesNow).toMatchObject({ [status.id]: optionId(status, 'Open') });
      await history.open();
      await expect(history.versions).toHaveCount(before + 2);
      await history.close();
    });
  });
});
