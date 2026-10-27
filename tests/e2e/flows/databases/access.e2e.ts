import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { addProperty, addRow, config, makeDatabase, value } from './database-api.js';
import { DatabaseScreen, signedInPage } from './database-page.js';

// Databases spec: DB-21, with this spec's 403 check. Avery (Admin) makes the database in the team
// space, where each member gets the access their role allows: Val (Viewer) Can view, Casey
// (Commenter) Can comment and Eli (Editor) Can edit.
test.describe('Databases: what each access level can do', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'comments');

  test('DB-21 view, comment and edit rights, and Lock structure', async ({ page, browser }) => {
    test.slow();
    await signInAs(page, 'admin');
    const database = await makeDatabase(page);
    const notes = await addProperty(page, database.id, 'Notes', config.text());
    const title = uniqueName('Fictional QA row');
    const row = await addRow(page, database.id, title, {
      [notes.id]: value.text('Fictional note'),
    });
    const rowPath = `/api/databases/${database.id}/rows/${row.id}`;
    const viewer = await signedInPage(browser, 'viewer');

    await test.step('Val (Can view) sees the row; typing in a cell changes nothing', async () => {
      const screen = new DatabaseScreen(viewer, database.id);
      await screen.open();
      await expect(screen.cell(row.id, notes.id)).toHaveText('Fictional note');
      await expect(screen.button('New')).toHaveCount(0);
      await screen.cell(row.id, notes.id).click();
      await viewer.keyboard.type('Fictional change by Val');
      await viewer.keyboard.press('Enter');
      await viewer.reload();
      await expect(screen.cell(row.id, notes.id)).toHaveText('Fictional note');
    });

    await test.step('A direct edit by Val is refused: 403 with a plain message', async () => {
      const api = await apiFor(viewer);
      const response = await api.send('PATCH', rowPath, {
        values: { [notes.id]: value.text('Fictional change by Val') },
      });
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: 'forbidden', message: "You don't have access to this." },
      });
      await viewer.context().close();
    });

    await test.step('Casey (Can comment) comments on the row page', async () => {
      const commenter = await signedInPage(browser, 'commenter');
      const screen = new DatabaseScreen(commenter, database.id);
      const comment = uniqueName('Fictional QA comment');
      await screen.open();
      const commentBox = (await screen.openRow(row.id, title)).getByRole('textbox', {
        name: /comment/i,
      });
      await commentBox.fill(comment);
      const posted = commenter.waitForResponse(
        (response) => response.request().method() === 'POST' && /comments/.test(response.url()),
      );
      await commentBox.press('Enter');
      expect((await posted).ok()).toBe(true);
      await screen.open();
      await expect((await screen.openRow(row.id, title)).getByText(comment)).toBeVisible();
      await commenter.context().close();
    });

    await test.step('Avery turns on Lock structure from the "…" menu', async () => {
      const screen = new DatabaseScreen(page, database.id);
      await screen.open();
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/api/databases/${database.id}`),
      );
      await screen.more('Lock structure');
      expect((await saved).ok()).toBe(true);
    });

    const editor = await signedInPage(browser, 'editor');

    await test.step('Eli (Can edit) still changes a cell', async () => {
      const screen = new DatabaseScreen(editor, database.id);
      await screen.open();
      await screen.editCell(row.id, notes.id, 'Fictional change by Eli');
      await expect(async () => {
        await editor.reload();
        await expect(screen.cell(row.id, notes.id)).toHaveText('Fictional change by Eli', {
          timeout: 2_000,
        });
      }).toPass();
    });

    await test.step("Eli can't add a property or a view while it's locked", async () => {
      const api = await apiFor(editor);
      const property = await api.send('POST', `/api/databases/${database.id}/properties`, {
        name: 'Fictional extra',
        config: config.text(),
      });
      expect(property.status()).toBe(403);
      const view = await api.send('POST', `/api/databases/${database.id}/views`, {
        name: 'Fictional board',
        layout: 'board',
      });
      expect(view.status()).toBe(403);
      await editor.context().close();
    });
  });
});
