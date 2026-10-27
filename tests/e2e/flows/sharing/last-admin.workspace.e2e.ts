import type { Page } from '@playwright/test';
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
import { confirmDialog } from '../history-trash/history-page.js';
import { makePage } from '../pages/page-data.js';
import { FORBIDDEN } from '../pages/page-screen.js';
import { NO_ACCESS } from './access.js';
import {
  MembersTab,
  SecurityLog,
  SiteAccounts,
  adminNames,
  listMembers,
  workspaceName,
} from './members.js';
import { nameOf } from './share-dialog.js';

// Roles and permissions, section 3 (How access is worked out) and section 7: a workspace always
// keeps at least one Admin ("A workspace needs at least one Admin."), and a site admin can make
// any member an Admin, even in a workspace they aren't in: Settings → Site → Accounts → the person
// → their workspaces → Make Admin. That doesn't add the site admin to the workspace or let them
// open its pages, and it's recorded in the workspace's Security log. In the seed, Avery is the
// only Admin (decision 0007, section 2.5). Roles belong to the whole workspace, so this file runs
// in the project "workspace": after every other test has finished, one test at a time (#369). Eli
// (an Editor) is made an Admin for a moment and put back in `finally`.

/** Jordan, a seeded site admin who isn't in the workspace. */
const JORDAN = 'jordan.siteadmin@example.test';

/** What Care Hub says when a change would leave the workspace without an Admin. */
const LAST_ADMIN = 'A workspace needs at least one Admin.';

/**
 * Avery's and Eli's names. The test is skipped unless Avery is the only Admin: another Admin, such
 * as one a failed run left, makes it moot.
 */
async function averyTheOnlyAdmin(page: Page) {
  const everyone = await listMembers(page);
  const nameFor = (email: string) => {
    const member = everyone.find((each) => each.email === email);
    if (!member) throw new Error(`${email} isn't in the workspace`);
    return member.name;
  };
  const avery = nameFor(people.admin.email);
  const eli = nameFor(people.editor.email);
  const admins = await adminNames(page);
  test.skip(admins.length !== 1 || admins[0] !== avery, `${avery} isn't the only Admin`);
  return { avery, eli };
}

test.describe('Roles: the last Admin', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');

  test('RP-10 the last Admin can’t be removed or given another role', async ({ page }) => {
    await signInAs(page, 'admin');
    const { avery } = await averyTheOnlyAdmin(page);
    const members = new MembersTab(page);

    await test.step('Changing Avery’s role to Editor is refused, and Avery stays an Admin', async () => {
      await members.open();
      await members.pickRole(avery, 'Editor');
      await expect(page.getByText(LAST_ADMIN)).toBeVisible();
      expect(await adminNames(page)).toEqual([avery]);
    });

    await test.step('Remove from workspace on Avery is refused too', async () => {
      // A fresh screen, so the message can't be the one from the step before.
      await members.open();
      const menu = await members.rowMenu(avery);
      await menu.getByRole('menuitem', { name: /^remove from workspace/i }).click();
      await confirmDialog(page, /remove/i)
        .getByRole('button', { name: /^remove/i })
        .click();
      await expect(page.getByText(LAST_ADMIN)).toBeVisible();
      expect(await adminNames(page)).toEqual([avery]);
    });
  });
});

test.describe('Roles: a site admin appoints an Admin', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings', 'siteAccounts');

  test('RP-10 a site admin who isn’t in the workspace makes Eli an Admin from Settings → Site → Accounts, and still can’t open its pages', async ({
    page,
    browser,
  }) => {
    // Two people, and Settings opened four times.
    test.slow();
    await signInAs(page, 'admin');
    const { avery, eli } = await averyTheOnlyAdmin(page);
    const workspace = await workspaceName(page);
    const title = uniqueName('Fictional QA team notes');
    const pageId = await makePage(page, title);
    const members = new MembersTab(page);
    const jordanWindow = await browser.newContext();

    try {
      const jordan = await jordanWindow.newPage();
      await signInAs(jordan, JORDAN);
      const jordanName = await nameOf(jordan);

      await test.step('Jordan: Settings → Site → Accounts → Eli → his workspaces → Make Admin', async () => {
        const accounts = new SiteAccounts(jordan);
        await accounts.open();
        await accounts.makeAdmin({ email: people.editor.email, name: eli }, workspace);
      });

      await test.step('Avery’s Settings → Members shows Eli as an Admin', async () => {
        await members.open();
        await expect.poll(() => members.roleOf(eli)).toMatch(/^Admin\b/);
        expect((await adminNames(page)).sort()).toEqual([avery, eli].sort());
      });

      await test.step('Jordan isn’t in the workspace: its page shows No access, and the server refuses it (403)', async () => {
        expect((await listMembers(page)).map((each) => each.email)).not.toContain(JORDAN);
        await jordan.goto(`/p/${pageId}`);
        await expect(jordan.getByText(NO_ACCESS)).toBeVisible();
        await expect(jordan.getByText(title)).toHaveCount(0);
        const response = await (await apiFor(jordan)).send('GET', `/api/pages/${pageId}`);
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject(FORBIDDEN);
      });

      await test.step('Avery’s Security log has the change: Jordan made Eli an Admin', async () => {
        const log = new SecurityLog(page);
        await log.open();
        await expect(log.entries(jordanName, eli, /\badmin\b/i).first()).toBeVisible();
      });
    } finally {
      await jordanWindow.close();
      // Back to Editor, which is allowed: Avery is still an Admin.
      if ((await adminNames(page)).includes(eli)) {
        await members.open();
        await members.changeRole(eli, 'Editor');
      }
    }
  });
});
