import { expect, needs, onlyIn, people, signInAs, test } from '../_support/index.js';
import { confirmDialog } from '../history-trash/history-page.js';
import { MembersTab, adminNames, listMembers } from './members.js';

// Roles and permissions, section 3 (How access is worked out) and section 7: a workspace always
// keeps at least one Admin ("A workspace needs at least one Admin."), and a site admin can make
// any member an Admin. In the seed, Avery is the only Admin and the site admin (decision 0007,
// section 2.5). Roles belong to the whole workspace, so this file runs in the project "workspace":
// after every other test has finished, one test at a time (the Testing lead's config, #369). Eli
// (an Editor) is made an Admin for a moment and put back in `finally`.

const inWorkspaceProject =
  'Runs in the workspace project, after all other files (Testing lead’s config PR #369)';

/** What Care Hub says when a change would leave the workspace without an Admin. */
const LAST_ADMIN = 'A workspace needs at least one Admin.';

test.describe('Roles: the last Admin', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');
  test.fixme(true, inWorkspaceProject);

  test('RP-10 the last Admin can’t be removed or given another role, and a site admin can appoint an Admin', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const everyone = await listMembers(page);
    const nameOf = (email: string) => {
      const member = everyone.find((each) => each.email === email);
      if (!member) throw new Error(`${email} isn't in the workspace`);
      return member.name;
    };
    const avery = nameOf(people.admin.email);
    const eli = nameOf(people.editor.email);
    // Avery has to be the last Admin: another Admin, such as one a failed run left, makes it moot.
    const admins = await adminNames(page);
    test.skip(admins.length !== 1 || admins[0] !== avery, `${avery} isn't the only Admin`);
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

    try {
      await test.step('Avery, the site admin, makes Eli an Admin', async () => {
        await members.open();
        await members.changeRole(eli, 'Admin');
        expect((await adminNames(page)).sort()).toEqual([avery, eli].sort());
      });
    } finally {
      // Back to Editor, which is allowed again: Avery is still an Admin.
      if ((await adminNames(page)).includes(eli)) {
        await members.open();
        await members.changeRole(eli, 'Editor');
      }
    }
  });
});
