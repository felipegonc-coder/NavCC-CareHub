import {
  apiFor,
  expect,
  needs,
  onlyIn,
  people,
  signInAs,
  test,
  uniqueName,
} from '../_support/index.js';
import { makePage, spaceIdOf } from '../pages/page-data.js';
import { FORBIDDEN, PageScreen, TEAM_SPACE } from '../pages/page-screen.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { AccessDialog, NO_ACCESS, guestEmail, setUpGuest } from './access.js';
import { choice } from './share-dialog.js';

// Roles and permissions, section 3 (Guests) and section 5; Settings and members, section 5 (only
// members see the member list).

test.describe('Sharing: guests', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing');

  test('RP-18 a guest sees only the pages shared with them: others are refused (403), and there are no top-level pages, no member list and never Full access', async ({
    page,
    browser,
  }) => {
    test.slow();
    const shared = uniqueName('Fictional QA Vendor checklist');
    const other = uniqueName('Fictional QA Team roster');
    const email = guestEmail();
    await signInAs(page, 'admin');
    const sharedId = await makePage(page, shared, { space: 'Private' });
    const otherId = await makePage(page, other);
    const spaceId = await spaceIdOf(page);
    const share = new AccessDialog(page);
    let link = '';

    await test.step('Avery invites a guest with Can edit and gets a setup link', async () => {
      await new PageScreen(page).goto(sharedId);
      await share.open();
      link = await share.inviteGuest(email, 'Can edit');
    });

    await test.step('the guest’s level menu offers Can view but never Full access', async () => {
      await page.reload();
      await share.open();
      await share.levelMenu(share.entry(email)).click();
      await expect(choice(page, /^Can view\b/)).toBeVisible();
      await expect(choice(page, /^Full access\b/)).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    const guest = await setUpGuest(browser, link, email);
    try {
      const sidebar = new Sidebar(guest.page);

      await test.step('the sidebar shows the page under "Shared with me", and no spaces', async () => {
        await expect(sidebar.entry(shared, sidebar.section('Shared with me'))).toBeVisible();
        await expect(sidebar.section(TEAM_SPACE)).toHaveCount(0);
        await expect(sidebar.nav.getByText(other)).toHaveCount(0);
      });

      await test.step('another page shows No access without its title, and the server refuses it (403)', async () => {
        await guest.page.goto(`/p/${otherId}`);
        await expect(guest.page.getByText(NO_ACCESS)).toBeVisible();
        await expect(guest.page.getByText(other)).toHaveCount(0);
        const response = await (await apiFor(guest.page)).send('GET', `/api/pages/${otherId}`);
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject(FORBIDDEN);
      });

      await test.step('a sub-page inside the shared page is allowed, a top-level page is refused (403)', async () => {
        const api = await apiFor(guest.page);
        const inside = await api.send('POST', '/api/pages', {
          kind: 'page',
          title: uniqueName('Fictional QA guest notes'),
          parentId: sharedId,
        });
        expect(inside.ok()).toBe(true);
        const top = await api.send('POST', '/api/pages', {
          kind: 'page',
          title: uniqueName('Fictional QA guest page'),
          spaceId,
        });
        expect(top.status()).toBe(403);
      });

      await test.step('Settings → Members is closed to the guest, with no names or emails', async () => {
        await guest.page.goto('/settings/members');
        await expect(guest.page.getByText(NO_ACCESS)).toBeVisible();
        await expect(guest.page.getByText(people.viewer.email)).toHaveCount(0);
      });
    } finally {
      await guest.close();
    }
  });
});
