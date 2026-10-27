import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat, control } from '../comments/care-hub-chat.js';
import { makePage } from '../pages/page-data.js';
import { openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { Sidebar } from './sidebar-page.js';
import { browseSpaces, createSpace, spaceCard } from './spaces-screens.js';

// Sidebar, spaces and nested pages, section 3.3 (Kinds): who sees Open, Closed and Private spaces,
// and a Closed space's Request to join, answered from the 🔔 notice its owner gets.

test.describe('Sidebar: Open, Closed and Private spaces', () => {
  onlyIn('desktop-light');
  // Requests to join reach owners as 🔔 notices in Messages (Comments and mentions, section 3.4).
  needs('signIn', 'appShell', 'pages', 'messages', 'notices');

  test('SB-07 each kind of space shows to the right people, and Approve on a request to join adds the person', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await signInAs(page, 'admin');
    const owner = await apiFor(page);
    const open = uniqueName('Fictional QA open space');
    const closed = uniqueName('Fictional QA closed space');
    const secret = uniqueName('Fictional QA private space');
    const made: string[] = [];
    const casey = await openAs(browser, 'commenter');
    try {
      // Avery makes the three spaces, so Avery owns them.
      made.push(await createSpace(page, open, 'Open', 'Fictional QA: anyone can join'));
      made.push(await createSpace(page, closed, 'Closed', 'Fictional QA: ask to join'));
      const secretId = await createSpace(page, secret, 'Private', 'Fictional QA: members only');
      made.push(secretId);
      const notesId = await makePage(page, uniqueName('Fictional QA closed space notes'), {
        space: closed,
      });
      const caseyName = await nameOf(casey.page);
      const asCasey = await apiFor(casey.page);
      const sidebar = new Sidebar(casey.page);
      const screen = await browseSpaces(casey.page);
      const requestToJoin = spaceCard(screen, closed).getByRole('button', {
        name: 'Request to join',
        exact: true,
      });

      await test.step('Casey sees the Open and Closed spaces in Browse spaces, and nothing of the Private one', async () => {
        await expect(spaceCard(screen, open)).toContainText('Fictional QA: anyone can join');
        await expect(spaceCard(screen, closed)).toContainText('Fictional QA: ask to join');
        await expect(requestToJoin).toBeVisible();
        await expect(screen).not.toContainText(secret);
        // Only its members know it exists: no answer names it, and its tree is refused.
        expect(JSON.stringify(await asCasey.get('/api/spaces'))).not.toContain(secret);
        expect([403, 404]).toContain(
          (await asCasey.send('GET', `/api/spaces/${secretId}/tree`)).status(),
        );
      });

      await test.step('Join puts the Open space in Casey’s sidebar; Request to join doesn’t let Casey in yet', async () => {
        await spaceCard(screen, open).getByRole('button', { name: 'Join', exact: true }).click();
        await requestToJoin.click();
        // Closes Browse spaces if it's a dialog. No reload: that could cut the request short.
        await casey.page.keyboard.press('Escape');
        await expect(sidebar.section(open)).toBeVisible();
        await expect(sidebar.section(closed)).toHaveCount(0);
        expect((await asCasey.send('GET', `/api/pages/${notesId}`)).status()).toBe(403);
      });

      await test.step('Avery, its owner, gets a 🔔 notice with Approve and Decline; Approve lets Casey in', async () => {
        const chat = new CareHubChat(page);
        const notice = chat.main
          .getByRole('article')
          .filter({ hasText: caseyName })
          .filter({ hasText: closed });
        await expect(async () => {
          await chat.open();
          await expect(notice).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        await expect(control(notice, 'Decline')).toBeVisible();
        await control(notice, 'Approve').click();
        await expect
          .poll(async () => (await asCasey.send('GET', `/api/pages/${notesId}`)).status())
          .toBe(200);
        await casey.page.reload();
        await expect(sidebar.section(closed)).toBeVisible();
      });
    } finally {
      // Delete space moves each space and its pages to Trash (section 3.3).
      for (const id of made) await owner.send('DELETE', `/api/spaces/${id}`);
      await casey.close();
    }
  });
});
