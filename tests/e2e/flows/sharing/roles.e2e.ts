import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage, spaceIdOf } from '../pages/page-data.js';
import { PageScreen, TEAM_SPACE, openAs } from '../pages/page-screen.js';
import { type NewMember, joinWithLink, makeInviteLink } from '../sidebar/new-member.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { AccessDialog, NO_ACCESS } from './access.js';
import { MembersTab, RolesSettings } from './members.js';

// Roles and permissions, sections 3 and 5: changing a member's role, and custom roles. Avery
// (Admin) changes roles; the members whose roles change join with an invite link in the test, so
// the seeded people keep theirs. Custom roles have fixed fictional names (at most 20 per workspace).

/** A copy of Viewer (RP-07), and a copy of Editor without the Create permission (RP-05). */
const AGENT = 'Fictional QA Agent';
const NO_CREATE = 'Fictional QA No-create';

test.describe('Roles: a role change reaches open pages', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'sharing', 'settings');

  test('RP-09 changing a member from Editor to Viewer while they have a page open makes it view-only within 5 seconds, with the banner', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const sam = await joinWithLink(
      browser,
      await makeInviteLink(page, 'Editor'),
      'Fictional QA Sam',
    );
    const pageId = await makePage(page, uniqueName('Fictional QA open page'));
    const samScreen = new PageScreen(sam.page);

    await test.step('Sam, an Editor, has a team space page open and can edit it', async () => {
      await samScreen.goto(pageId);
      await expect(samScreen.content).toBeEditable();
      await expect(samScreen.viewOnly).toBeHidden();
    });

    await test.step('Avery makes Sam a Viewer in Settings → Members', async () => {
      const members = new MembersTab(page);
      await members.open();
      await members.changeRole(sam.name, 'Viewer');
    });

    await test.step("Within 5 seconds Sam's page is view-only, with the banner", async () => {
      const banner = sam.page.getByText('Your access changed. This page is now view-only.');
      await expect(banner).toBeVisible({ timeout: 5_000 });
      await expect(samScreen.viewOnly).toBeVisible();
      await expect(samScreen.content).not.toBeEditable();
    });
    await sam.close();
  });
});

test.describe('Roles: custom roles', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing', 'settings');

  test('RP-07 a page shared with a custom role as Can view opens for every member with it, including one who joins later', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    await new RolesSettings(page).ensure(AGENT, 'Viewer');
    const early = await joinWithLink(
      browser,
      await makeInviteLink(page, AGENT),
      'Fictional QA Agent',
    );
    const pageId = await makePage(page, uniqueName('Fictional QA for agents'), {
      space: 'Private',
    });
    const screen = new PageScreen(page);
    const viewer = async (other: NewMember) => {
      const theirs = new PageScreen(other.page);
      await theirs.goto(pageId);
      await expect(theirs.viewOnly).toBeVisible();
    };

    await test.step('Avery shares a Private page with the role as Can view', async () => {
      await screen.goto(pageId);
      const dialog = new AccessDialog(page);
      await dialog.open();
      await dialog.inviteRole(AGENT, 'Can view');
      await dialog.closeWithEscape();
    });

    await test.step('A member who had the role before can view it', async () => {
      await viewer(early);
    });

    await test.step('A member who joins with the role afterwards can view it too', async () => {
      const later = await joinWithLink(
        browser,
        await makeInviteLink(page, AGENT),
        'Fictional QA Agent',
      );
      await viewer(later);
      await later.close();
    });

    await test.step('Eli, without the role, still gets the no-access message', async () => {
      const eli = await openAs(browser, 'editor');
      await eli.page.goto(`/p/${pageId}`);
      await expect(eli.page.getByText(NO_ACCESS)).toBeVisible();
      await eli.close();
    });
    await early.close();
  });

  test('RP-05 without Create, a member has no New page, Duplicate or Import, and the server refuses a new page (403)', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const roles = new RolesSettings(page);
    await roles.ensure(NO_CREATE, 'Editor');
    await roles.setPermission(NO_CREATE, /^Create\b|^Add pages, databases and spaces/, false);
    const pageId = await makePage(page, uniqueName('Fictional QA page they can edit'));
    const member = await joinWithLink(
      browser,
      await makeInviteLink(page, NO_CREATE),
      'Fictional QA No-create',
    );
    const screen = new PageScreen(member.page);
    const sidebar = new Sidebar(member.page);

    await test.step('The page menu has no Duplicate and no Import', async () => {
      await screen.goto(pageId);
      const menu = await screen.openPageMenu();
      await expect(menu.getByRole('menuitem', { name: /^duplicate/i })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: /^import/i })).toHaveCount(0);
      await member.page.keyboard.press('Escape');
    });

    await test.step('The sidebar has no New page next to the space and no Import', async () => {
      const space = sidebar.section(TEAM_SPACE);
      await space.hover();
      await expect(space.getByRole('button', { name: /^(add a page|new page)/i })).toHaveCount(0);
      const importer = { name: 'Import', exact: true };
      await expect(
        sidebar.nav.getByRole('button', importer).or(sidebar.nav.getByRole('link', importer)),
      ).toHaveCount(0);
    });

    await test.step('POST /api/pages is refused (403)', async () => {
      const response = await (
        await apiFor(member.page)
      ).send('POST', '/api/pages', {
        kind: 'page',
        title: uniqueName('Fictional QA refused page'),
        spaceId: await spaceIdOf(member.page),
      });
      expect(response.status()).toBe(403);
    });
    await member.close();
  });
});
