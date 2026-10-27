import type { Locator } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  config,
  getDatabase,
  makeDatabase,
  nameOf,
  optionId,
  value,
} from '../databases/database-api.js';
import { DatabaseScreen, signedInPage } from '../databases/database-page.js';
import {
  formTitle,
  formViewOf,
  makeForm,
  question,
  sendAnswers,
  showIf,
  when,
} from './form-data.js';
import { FormBuilder, FormFill } from './form-page.js';

/** The id a table row carries, for finding its cells. */
async function rowIdOf(row: Locator): Promise<string> {
  const id = await row.getAttribute('data-row-id');
  if (!id) throw new Error('The row has no data-row-id.');
  return id;
}

// Forms spec section 7: FM-01 to FM-04. Avery (Admin) builds each form in the team space; Eli
// (Editor) fills it in at its link, in a browser of his own.
test.describe('Forms: building and filling in', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'forms');

  test('FM-01 Add view → Form, add Name and Priority and a new question', async ({ page }) => {
    await signInAs(page, 'admin');
    const tickets = await makeDatabase(page, uniqueName('Fictional QA Tickets'));
    const name = nameOf(tickets);
    const priority = await addProperty(page, tickets.id, 'Priority', config.select('Low', 'High'));
    const known = [name.id, priority.id];
    const screen = new DatabaseScreen(page, tickets.id);
    const builder = new FormBuilder(screen);
    await screen.open();

    await test.step('Add view → Form: "Add your first question."', async () => {
      await builder.addFormView();
      await expect(builder.emptyState()).toBeVisible();
    });

    await test.step('Add Name and Priority, then a new question', async () => {
      await builder.addQuestion(name.name);
      await builder.addQuestion('Priority');
      await builder.newQuestion('Text', 'What happened?');
    });

    await test.step('All three are saved; the new one made a property', async () => {
      const questions = async () => formViewOf(await getDatabase(page, tickets.id)).form.questions;
      await expect
        .poll(async () => (await questions()).map((q) => q.text))
        .toEqual([name.name, 'Priority', 'What happened?']);
      const [asked, priorityAsked, added] = await questions();
      expect(asked?.propertyId).toBe(name.id);
      expect(priorityAsked?.propertyId).toBe(priority.id);
      expect(known).not.toContain(added?.propertyId);
      const made = (await getDatabase(page, tickets.id)).properties.find(
        (p) => p.id === added?.propertyId,
      );
      expect(made?.config.type).toBe('text');
    });
  });

  test('FM-02 a response makes one row, Created by the respondent', async ({ page, browser }) => {
    await signInAs(page, 'admin');
    const database = await makeDatabase(page, uniqueName('Fictional QA Requests'));
    const priority = await addProperty(page, database.id, 'Priority', config.select('Low', 'High'));
    const notes = await addProperty(page, database.id, 'Notes', config.text());
    const createdBy = await addProperty(page, database.id, 'Created by', { type: 'created_by' });
    // Name isn't asked, so the row is named "Response from" and the respondent's name.
    const form = await makeForm(page, database, [
      question(priority.id, 'How urgent is it?', { required: true }),
      question(notes.id, 'What happened?'),
    ]);
    const note = uniqueName('Fictional QA note');

    await test.step('Eli picks High, types a note and submits', async () => {
      const eli = await signedInPage(browser, 'editor');
      const fill = new FormFill(eli, formTitle(database, form));
      await fill.open(form.form.linkCode);
      await fill.choose('How urgent is it?', 'High');
      await fill.answer('What happened?', note);
      await fill.send();
      await eli.context().close();
    });

    await test.step('One row: his answers, "Response from Eli…", Created by Eli', async () => {
      const screen = new DatabaseScreen(page, database.id);
      await screen.open();
      await expect(screen.rows()).toHaveCount(1);
      const row = screen.row(note);
      await expect(row).toContainText('High');
      await expect(row).toContainText(/Response from Eli/);
      await expect(screen.cell(await rowIdOf(row), createdBy.id)).toContainText('Eli');
    });
  });

  test('FM-03 Any and All logic; hidden answers are never saved', async ({ page, browser }) => {
    test.slow();
    await signInAs(page, 'admin');
    const database = await makeDatabase(page, uniqueName('Fictional QA Disputes'));
    const name = nameOf(database);
    const category = await addProperty(
      page,
      database.id,
      'Category',
      config.select('Billing', 'Scheduling', 'Other'),
    );
    const urgent = await addProperty(page, database.id, 'Urgent', config.checkbox());
    const reason = await addProperty(page, database.id, 'Reason', config.text());
    const details = await addProperty(page, database.id, 'Details', config.text());
    const billing = when(category.id, 'is_any_of', [optionId(category, 'Billing')]);
    const other = when(category.id, 'is_any_of', [optionId(category, 'Other')]);
    // Reason shows for Billing AND Urgent; Details for Other OR Urgent.
    const form = await makeForm(page, database, [
      question(name.id, 'Your name'),
      question(category.id, 'Category'),
      question(urgent.id, 'Urgent'),
      question(reason.id, 'Reason', { logic: showIf.all(billing, when(urgent.id, 'is_checked')) }),
      question(details.id, 'Details', { logic: showIf.any(other, when(urgent.id, 'is_checked')) }),
    ]);
    const eli = await signedInPage(browser, 'editor');
    const fill = new FormFill(eli, formTitle(database, form));
    const filledIn = uniqueName('Fictional QA filled in');
    const handMade = uniqueName('Fictional QA hand-made');
    await fill.open(form.form.linkCode);

    await test.step('All: Reason shows only for Billing and Urgent', async () => {
      await expect(fill.box('Reason')).toBeHidden();
      await fill.choose('Category', 'Billing');
      await expect(fill.box('Reason')).toBeHidden();
      await fill.tickBox('Urgent').check();
      await expect(fill.box('Reason')).toBeVisible();
    });

    await test.step('Any: Details shows for Urgent or for Other', async () => {
      await expect(fill.box('Details')).toBeVisible();
      await fill.answer('Reason', 'Fictional reason');
      await fill.answer('Details', 'Fictional details');
      await fill.tickBox('Urgent').uncheck();
      await expect(fill.box('Reason')).toBeHidden();
      await expect(fill.box('Details')).toBeHidden();
      await fill.choose('Category', 'Other');
      await expect(fill.box('Details')).toBeVisible();
      await expect(fill.box('Details')).toHaveValue('');
    });

    await test.step('Sent with Reason and Details hidden', async () => {
      await fill.choose('Category', 'Billing');
      await expect(fill.box('Details')).toBeHidden();
      await fill.answer('Your name', filledIn);
      await fill.send();
    });

    await test.step('A hand-made request with hidden answers is taken', async () => {
      const response = await sendAnswers(eli, form.form.linkCode, {
        [name.id]: value.text(handMade),
        [category.id]: optionId(category, 'Scheduling'),
        [urgent.id]: false,
        [reason.id]: value.text('Fictional hidden reason'),
        [details.id]: value.text('Fictional hidden details'),
      });
      expect(response.ok()).toBe(true);
      await eli.context().close();
    });

    await test.step('Neither row kept a hidden answer', async () => {
      const screen = new DatabaseScreen(page, database.id);
      await screen.open();
      await expect(screen.row(filledIn)).toContainText('Billing');
      await expect(screen.row(handMade)).toContainText('Scheduling');
      for (const title of [filledIn, handMade]) {
        await expect(screen.row(title)).not.toContainText(/Fictional (hidden )?(reason|details)/);
      }
    });
  });

  test('FM-04 required questions block Submit unless hidden', async ({ page, browser }) => {
    await signInAs(page, 'admin');
    const database = await makeDatabase(page, uniqueName('Fictional QA Checks'));
    const name = nameOf(database);
    const category = await addProperty(
      page,
      database.id,
      'Category',
      config.select('Billing', 'Other'),
    );
    const reason = await addProperty(page, database.id, 'Reason', config.text());
    const confirmed = await addProperty(page, database.id, 'Confirmed', config.checkbox());
    const confirm = 'I confirm these details are right';
    // Reason is required but shows only for Other; the tick box is required, so it must be ticked.
    const form = await makeForm(page, database, [
      question(name.id, 'Your name', { required: true }),
      question(category.id, 'Category', { required: true }),
      question(reason.id, 'Reason', {
        required: true,
        logic: showIf.all(when(category.id, 'is_any_of', [optionId(category, 'Other')])),
      }),
      question(confirmed.id, confirm, { required: true }),
    ]);
    const eli = await signedInPage(browser, 'editor');
    const fill = new FormFill(eli, formTitle(database, form));
    await fill.open(form.form.linkCode);

    await test.step('Submit with nothing: 3 errors, none for hidden Reason', async () => {
      await fill.submit();
      await expect(fill.form.getByText('3 questions need answers')).toBeVisible();
      await expect(fill.errors('Answer this question.')).toHaveCount(2);
      await expect(fill.errors('Tick this box to continue.')).toHaveCount(1);
      await expect(fill.box('Your name')).toBeFocused();
    });

    await test.step('Once shown, Reason is required too', async () => {
      await fill.answer('Your name', uniqueName('Fictional QA respondent'));
      await fill.choose('Category', 'Other');
      await fill.submit();
      await expect(fill.errors('Answer this question.')).toHaveCount(1);
      await expect(fill.errors('Tick this box to continue.')).toHaveCount(1);
    });

    await test.step("Hidden again it doesn't block; the tick box does", async () => {
      await fill.choose('Category', 'Billing');
      await fill.submit();
      await expect(fill.errors('Answer this question.')).toHaveCount(0);
      await expect(fill.errors('Tick this box to continue.')).toHaveCount(1);
      await fill.tickBox(confirm).check();
      await fill.send();
      await eli.context().close();
    });
  });
});
