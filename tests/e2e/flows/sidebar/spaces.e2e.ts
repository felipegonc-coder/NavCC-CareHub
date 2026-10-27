import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, TEAM_SPACE, pageIdOf } from '../pages/page-screen.js';
import { ShareDialog } from '../sharing/share-dialog.js';
import { joinWithLink, makeInviteLink } from './new-member.js';
import { Sidebar } from './sidebar-page.js';

// Sidebar, spaces and nested pages, sections 2 (States), 3.1 and 3.3: the sections a person has.

test.describe('Sidebar: a new member', () => {
  onlyIn('desktop-light');
  // The new member joins with an invite link (Settings and members, section 3.4), and Avery
  // shares a page with them from the share dialog (Roles and permissions).
  needs('signIn', 'appShell', 'pages', 'settings', 'sharing');

  test('SB-01 a new member is in General, with Private, Shared and Favorites sections that work as described', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await signInAs(page, 'admin');
    const teamPage = uniqueName('Fictional QA team notes');
    const sharedPage = uniqueName('Fictional QA handover for Riley');
    const ownPage = uniqueName('Fictional QA Riley’s own notes');
    const teamPageId = await makePage(page, teamPage);
    const sharedPageId = await makePage(page, sharedPage, { space: 'Private' });
    const riley = await joinWithLink(browser, await makeInviteLink(page));
    try {
      const sidebar = new Sidebar(riley.page);

      await test.step('General is there with its pages; empty sections show as described', async () => {
        await expect(sidebar.entry(teamPage, sidebar.section(TEAM_SPACE))).toBeVisible();
        await expect(sidebar.section('Private')).toContainText('Add a page');
        await expect(sidebar.section('Favorites')).toContainText('Star pages to keep them here.');
        // A section with nothing in it is hidden (section 2, States).
        await expect(sidebar.section('Shared')).toHaveCount(0);
      });

      await test.step('a page Riley adds to Private is Riley’s alone', async () => {
        await sidebar.addPage(ownPage, 'Private');
        const ownId = pageIdOf(riley.page);
        expect((await (await apiFor(page)).send('GET', `/api/pages/${ownId}`)).status()).toBe(403);
      });

      await test.step('a page shared with Riley directly shows under Shared', async () => {
        const share = new ShareDialog(page);
        await new PageScreen(page).goto(sharedPageId);
        await share.open();
        await share.invite(riley.name, 'Can view');
        await share.closeWithEscape();
        await riley.page.reload();
        await expect(sidebar.entry(sharedPage, sidebar.section('Shared'))).toBeVisible();
      });

      await test.step('a page Riley stars shows under Favorites', async () => {
        const screen = new PageScreen(riley.page);
        await screen.goto(teamPageId);
        await screen.favorite.click();
        await expect(sidebar.entry(teamPage, sidebar.section('Favorites'))).toBeVisible();
        await expect(sidebar.section('Favorites')).not.toContainText(
          'Star pages to keep them here.',
        );
      });
    } finally {
      await riley.close();
    }
  });
});
