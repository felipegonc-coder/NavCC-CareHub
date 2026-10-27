import type { Locator, Page } from '@playwright/test';
import {
  apiFor,
  expect,
  needs,
  onlyIn,
  shownDate,
  signInAs,
  test,
  uniqueName,
} from '../_support/index.js';
import {
  addProperty,
  config,
  makeDatabase,
  nameOf,
  value,
  type Database,
  type Place,
  type Property,
} from '../databases/database-api.js';
import { DatabaseScreen, signedInPage } from '../databases/database-page.js';
import {
  changeLink,
  formTitle,
  makeForm,
  question,
  sendAnswers,
  updateForm,
  type Form,
  type FormView,
} from './form-data.js';
import { FormFill } from './form-page.js';

type NoteForm = { database: Database; notes: Property; form: FormView };

/** A new database, and a form on it that asks "Your name" and "What happened?". */
async function makeNoteForm(
  page: Page,
  place: Place,
  settings: Partial<Form> = {},
): Promise<NoteForm> {
  const database = await makeDatabase(page, uniqueName('Fictional QA Requests'), place);
  const notes = await addProperty(page, database.id, 'Notes', config.text());
  const form = await makeForm(
    page,
    database,
    [question(nameOf(database).id, 'Your name'), question(notes.id, 'What happened?')],
    settings,
  );
  return { database, notes, form };
}

/** The id a table row carries. */
async function rowIdOf(row: Locator): Promise<string> {
  const id = await row.getAttribute('data-row-id');
  if (!id) throw new Error('The row has no data-row-id.');
  return id;
}

// Forms spec section 7: FM-08, FM-09, FM-11 and FM-13. Avery (Admin) makes each form; Val (Viewer)
// and Eli (Editor) use its link in browsers of their own.
test.describe('Forms: links, access and kept answers', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'forms');

  // FM-08's non-member case isn't here: the seed has no signed-in person outside the workspace.
  test('FM-08 responses off, a changed link, and signed out', async ({ page, browser }) => {
    await signInAs(page, 'admin');
    const { database, notes, form } = await makeNoteForm(page, 'team');
    const answers = { [notes.id]: value.text('Fictional note') };
    const oldCode = form.form.linkCode;
    // Val can only view the database, so the link's rules apply to her in full.
    const val = await signedInPage(browser, 'viewer');
    try {
      const fill = new FormFill(val, formTitle(database, form));

      await test.step('Responses off: the screen says so, and sending is 403', async () => {
        await updateForm(page, database.id, form.id, { accepting: false });
        await val.goto(`/forms/${oldCode}`);
        await expect(val.getByText("This form isn't accepting responses.")).toBeVisible();
        await expect(fill.form).toHaveCount(0);
        expect((await sendAnswers(val, oldCode, answers)).status()).toBe(403);
      });

      const newCode = await test.step('Change link: the old link stops at once', async () => {
        await updateForm(page, database.id, form.id, { accepting: true });
        const code = await changeLink(page, database.id, form.id);
        expect(code).not.toBe(oldCode);
        await val.goto(`/forms/${oldCode}`);
        const changed = 'This form link has changed. Ask the person who sent it for the new one.';
        await expect(val.getByText(changed)).toBeVisible();
        expect((await sendAnswers(val, oldCode, answers)).status()).toBe(403);
        await fill.open(code);
        return code;
      });

      await test.step('Signed out: the sign-in screen, keeping the form', async () => {
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        try {
          const visitor = await context.newPage();
          await visitor.goto(`/forms/${newCode}`);
          await expect(visitor.locator('input[type="password"]')).toBeVisible();
          expect(decodeURIComponent(visitor.url())).toContain(`/forms/${newCode}`);
        } finally {
          await context.close();
        }
      });
    } finally {
      await val.context().close();
    }
  });

  test('FM-09 no database access: can submit, but gets 403', async ({ page, browser }) => {
    await signInAs(page, 'admin');
    const { database, form } = await makeNoteForm(page, 'private');
    const sender = uniqueName('Fictional QA from Val');
    const val = await signedInPage(browser, 'viewer');
    try {
      await test.step("Val submits a form whose database she can't open", async () => {
        const fill = new FormFill(val, formTitle(database, form));
        await fill.open(form.form.linkCode);
        await fill.answer('Your name', sender);
        await fill.answer('What happened?', 'Fictional note from Val');
        await fill.send();
      });

      await test.step('The database and her new row are 403 to her', async () => {
        const screen = new DatabaseScreen(page, database.id);
        await screen.open();
        const rowId = await rowIdOf(screen.row(sender));
        const api = await apiFor(val);
        expect((await api.send('GET', `/api/databases/${database.id}`)).status()).toBe(403);
        const row = await api.send('GET', `/api/databases/${database.id}/rows/${rowId}`);
        expect(row.status()).toBe(403);
        await val.goto(`/p/${database.id}`);
        await expect(new DatabaseScreen(val, database.id).root).toHaveCount(0);
      });
    } finally {
      await val.context().close();
    }
  });

  test('FM-11 answers survive a reload and clear after submitting', async ({ page, browser }) => {
    await signInAs(page, 'admin');
    const { database, form } = await makeNoteForm(page, 'team');
    const name = uniqueName('Fictional QA kept');
    const eli = await signedInPage(browser, 'editor');
    try {
      const fill = new FormFill(eli, formTitle(database, form));
      await fill.open(form.form.linkCode);

      await test.step('Typed answers come back after a reload', async () => {
        await fill.answer('Your name', name);
        await fill.answer('What happened?', 'Fictional note kept');
        await fill.box('What happened?').press('Tab');
        await eli.reload();
        await expect(fill.box('Your name')).toHaveValue(name);
        await expect(fill.box('What happened?')).toHaveValue('Fictional note kept');
      });

      await test.step('Gone once sent, and still gone after a reload', async () => {
        await fill.send();
        await eli.getByRole('button', { name: 'Submit another response' }).click();
        await expect(fill.box('Your name')).toHaveValue('');
        await eli.reload();
        await expect(fill.box('Your name')).toHaveValue('');
        await expect(fill.box('What happened?')).toHaveValue('');
      });
    } finally {
      await eli.context().close();
    }
  });

  test('FM-13 one response each: a second visit is refused', async ({ page, browser }) => {
    await signInAs(page, 'admin');
    const { database, notes, form } = await makeNoteForm(page, 'team', { allowMultiple: false });
    const eli = await signedInPage(browser, 'editor');
    try {
      const fill = new FormFill(eli, formTitle(database, form));

      await test.step('Eli answers once, with no "Submit another response"', async () => {
        await fill.open(form.form.linkCode);
        await fill.answer('Your name', uniqueName('Fictional QA once'));
        await fill.send();
        await expect(eli.getByRole('button', { name: 'Submit another response' })).toHaveCount(0);
      });

      await test.step('A second visit: "You already responded on [today]."', async () => {
        await eli.goto(`/forms/${form.form.linkCode}`);
        const already = `You already responded on ${shownDate(new Date())}.`;
        await expect(eli.getByText(already)).toBeVisible();
        await expect(fill.form).toHaveCount(0);
        const again = await sendAnswers(eli, form.form.linkCode, {
          [notes.id]: value.text('Fictional second note'),
        });
        expect(again.ok()).toBe(false);
      });
    } finally {
      await eli.context().close();
    }
  });
});
