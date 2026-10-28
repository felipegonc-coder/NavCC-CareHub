import { randomUUID } from 'node:crypto';
import {
  apiFor,
  expect,
  needs,
  onlyIn,
  shownTime,
  signInAs,
  test,
  uniqueName,
} from '../flows/_support/index.js';

// Smoke flow for the Reminders list (Home and reminders spec, section 2). The acceptance checks
// (HR-*) are the Testing lane's, in tests/e2e/flows/home/.
test.describe('Reminders list', () => {
  onlyIn('desktop-light');
  needs('signIn', 'reminders');

  test('a pending reminder shows its time and note, takes a new note and can be deleted', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const api = await apiFor(page);
    const note = uniqueName('Fictional check the queue');
    // Two hours from now, on the minute.
    const at = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 60_000) * 60_000);
    // Any page ID works until page access comes from core's page model; the list then shows
    // "A page you can't open" as the title.
    await api.post('/api/reminders', {
      target: { type: 'page', pageId: randomUUID() },
      at: at.toISOString(),
      note,
    });

    await page.goto('/reminders');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Reminders' })).toBeVisible();
    const pending = main.getByRole('region', { name: 'Pending' });
    const item = pending.getByRole('listitem').filter({ hasText: note });
    await expect(item).toContainText(shownTime(at));

    await item.getByRole('button', { name: /^Edit reminder/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Change reminder' });
    const changed = `${note} (changed)`;
    await dialog.getByRole('textbox', { name: 'Note' }).fill(changed);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const changedItem = pending.getByRole('listitem').filter({ hasText: changed });
    await expect(changedItem).toBeVisible();

    await changedItem.getByRole('button', { name: /^Delete reminder/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this reminder?' });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(changedItem).toBeHidden();
  });
});
