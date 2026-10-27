import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../flows/_support/index.js';
import {
  composer,
  message,
  messageRow,
  openMessages,
  send,
  startChat,
} from '../flows/messages/messages-page.js';

// Smoke flow for the Messages screen (docs/team/testing/messages.md): start a direct chat, send a
// message, edit it with ↑, find it with search and delete it. The full flows are in
// ../flows/messages.
test.describe('Messages smoke', () => {
  onlyIn('desktop-light');
  needs('signIn');

  test('starts a chat, sends, edits with ↑, finds and deletes a message', async ({ page }) => {
    const text = uniqueName('Fictional QA smoke message');
    const edited = uniqueName('Fictional QA smoke message, edited');
    await signInAs(page, 'admin');
    await openMessages(page);
    await startChat(page, ['editor']);

    await test.step('Enter sends, and the message stays once it is saved', async () => {
      await send(page, text);
      await expect(message(page, text)).toBeVisible();
      await expect(messageRow(page, text)).not.toContainText('Sending…');
    });

    await test.step('↑ in the empty message box edits the last message', async () => {
      await composer(page).press('ArrowUp');
      await expect(composer(page)).toHaveValue(text);
      await composer(page).fill(edited);
      await composer(page).press('Enter');
      await expect(messageRow(page, edited)).toContainText('(edited)');
    });

    await test.step('Search finds the message and opens the chat at it', async () => {
      await page.getByRole('searchbox', { name: 'Search messages' }).fill(`"${edited}"`);
      const results = page.getByRole('region', { name: 'Search results' });
      await results.getByRole('link').filter({ hasText: edited }).click();
      await expect(page).toHaveURL(/[?&]message=/);
      await expect(messageRow(page, edited)).toBeInViewport();
      await page.getByRole('searchbox', { name: 'Search messages' }).press('Escape');
      await expect(results).toHaveCount(0);
    });

    await test.step('Delete asks first, then "This message was deleted" stays', async () => {
      const row = messageRow(page, edited);
      await row.hover();
      await row.getByRole('button', { name: /actions$/ }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('main').getByText(edited)).toHaveCount(0);
      await expect(
        page.getByRole('main').getByText('This message was deleted').last(),
      ).toBeVisible();
    });
  });
});
