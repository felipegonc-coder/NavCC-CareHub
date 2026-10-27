import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { FORBIDDEN, PageScreen, literally, openAs } from '../pages/page-screen.js';
import { AccessDialog, guestEmail, makeGroup, setUpGuest, type Guest } from './access.js';
import { nameOf } from './share-dialog.js';

// Roles and permissions, section 3 (Sharing: the share dialog, inherited access, groups, guests)
// and section 2 (the role-limit note). Pages start in Avery's Private section, so nobody else can
// open them until they're shared.

test.describe('Sharing: a person, a group, a role and a guest', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing', 'settings', 'groups');

  test('RP-16 inviting a person, a group, a role and a guest gives each the level chosen for them', async ({
    page,
    browser,
  }) => {
    test.slow(); // Five people, each in a browser of their own.
    const title = uniqueName('Fictional QA Onboarding plan');
    const group = uniqueName('Fictional QA Phoenix team');
    const email = guestEmail();
    await signInAs(page, 'admin');
    const eli = await openAs(browser, 'editor');
    const casey = await openAs(browser, 'commenter');
    const val = await openAs(browser, 'viewer');
    let guest: Guest | undefined;

    try {
      const [eliName, valName] = await Promise.all([nameOf(eli.page), nameOf(val.page)]);
      await makeGroup(page, group, [valName]);
      const id = await makePage(page, title, { space: 'Private' });
      let link = '';

      await test.step('Avery invites Eli (Can edit), the group with Val in it (Can view), the Commenter role (Can comment) and a guest (Can view)', async () => {
        await new PageScreen(page).goto(id);
        const share = new AccessDialog(page);
        await share.open();
        await share.invite(eliName, 'Can edit');
        await share.invite(group, 'Can view');
        await share.inviteRole('Commenter', 'Can comment');
        link = await share.inviteGuest(email, 'Can view');
      });

      await test.step('after a reload, People with access lists each of them with its level', async () => {
        await page.reload();
        const share = new AccessDialog(page);
        await share.open();
        await expect(share.entry(eliName)).toContainText('Can edit');
        await expect(share.entry(group)).toContainText('Can view');
        await expect(share.roleEntry('Commenter')).toContainText('Can comment');
        await expect(share.entry(email)).toContainText('Can view');
      });

      await test.step('Eli can edit the page', async () => {
        const screen = new PageScreen(eli.page);
        await screen.goto(id);
        await expect(screen.title).toBeEditable();
        await expect(screen.viewOnly).toBeHidden();
      });

      await test.step('Casey, a Commenter, and Val, through the group, can open it but not edit it', async () => {
        for (const someone of [casey.page, val.page]) {
          const screen = new PageScreen(someone);
          await screen.goto(id);
          await screen.expectTitle(title);
          await expect(screen.viewOnly).toBeVisible();
        }
      });

      await test.step('the guest sets up an account with the link and can open the page read only', async () => {
        guest = await setUpGuest(browser, link, email);
        const screen = new PageScreen(guest.page);
        await screen.goto(id);
        await screen.expectTitle(title);
        await expect(screen.viewOnly).toBeVisible();
      });
    } finally {
      await Promise.all([eli.close(), casey.close(), val.close(), guest?.close()]);
    }
  });
});

test.describe('Sharing: inherited access and role limits', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing');

  test('RP-16 a sub-page shows where inherited access comes from, asks before it gets its own, and Restore inherited access undoes it', async ({
    page,
    browser,
  }) => {
    test.slow();
    const parent = uniqueName('Fictional QA Policies');
    const child = uniqueName('Fictional QA Refund steps');
    await signInAs(page, 'admin');
    const parentId = await makePage(page, parent, { space: 'Private' });
    const childId = await makePage(page, child, { parentId });
    const eli = await openAs(browser, 'editor');
    const share = new AccessDialog(page);

    try {
      const eliName = await nameOf(eli.page);
      const from = `From ${parent}`;

      await test.step('Avery gives Eli Can edit on the parent; on the sub-page, Eli shows "From" the parent', async () => {
        await new PageScreen(page).goto(parentId);
        await share.open();
        await share.invite(eliName, 'Can edit');
        await new PageScreen(page).goto(childId);
        await share.open();
        await expect(share.entry(eliName)).toContainText('Can edit');
        await expect(share.entry(eliName)).toContainText(from);
      });

      await test.step('changing Eli to Can view on the sub-page asks first; Yes gives it its own access', async () => {
        await share.changeLevel(share.entry(eliName), 'Can view');
        await expect(share.ownAccess).toContainText(`It will stop following ${parent}.`);
        await share.ownAccess.getByRole('button', { name: /^(yes|give|stop inheriting)/i }).click();
        await expect(share.ownAccess).toBeHidden();
        await expect(share.entry(eliName)).toContainText('Can view');
        await expect(share.entry(eliName)).not.toContainText(from);
        await expect(share.restoreInherited).toBeVisible();
      });

      await test.step('Eli can edit the parent but only view the sub-page', async () => {
        const screen = new PageScreen(eli.page);
        await screen.goto(parentId);
        await expect(screen.title).toBeEditable();
        await screen.goto(childId);
        await expect(screen.viewOnly).toBeVisible();
      });

      await test.step('the sub-page stops following the parent: Can comment there leaves Eli at Can view here', async () => {
        await new PageScreen(page).goto(parentId);
        await share.open();
        await share.changeLevel(share.entry(eliName), 'Can comment');
        await expect(share.entry(eliName)).toContainText('Can comment');
        await new PageScreen(page).goto(childId);
        await share.open();
        await expect(share.entry(eliName)).toContainText('Can view');
      });

      await test.step('Restore inherited access brings back the parent’s entries, with their source', async () => {
        await share.restoreInherited.click();
        await expect(share.entry(eliName)).toContainText('Can comment');
        await expect(share.entry(eliName)).toContainText(from);
        await expect(share.restoreInherited).toBeHidden();
      });
    } finally {
      await eli.close();
    }
  });

  test('RP-03 a Viewer given Can edit can still only view: the Share dialog says why, and an edit sent to the server is refused (403)', async ({
    page,
    browser,
  }) => {
    const title = uniqueName('Fictional QA Refund steps');
    await signInAs(page, 'admin');
    const id = await makePage(page, title, { space: 'Private' });
    const val = await openAs(browser, 'viewer');

    try {
      const valName = await nameOf(val.page);
      const note = new RegExp(
        `${literally(valName).source}['’]s role, Viewer, limits them to Can view`,
      );

      await test.step('Avery gives Val, a Viewer, Can edit; the dialog says her role limits her to Can view', async () => {
        await new PageScreen(page).goto(id);
        const share = new AccessDialog(page);
        await share.open();
        await share.invite(valName, 'Can edit');
        await expect(share.dialog).toContainText(note);
      });

      await test.step('Val gets the page read only', async () => {
        const screen = new PageScreen(val.page);
        await screen.goto(id);
        await screen.expectTitle(title);
        await expect(screen.viewOnly).toBeVisible();
      });

      await test.step('a title change Val sends straight to the server is refused (403)', async () => {
        const response = await (
          await apiFor(val.page)
        ).send('PATCH', `/api/pages/${id}`, {
          title: 'Fictional QA edit',
        });
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject(FORBIDDEN);
        await new PageScreen(page).goto(id);
        await new PageScreen(page).expectTitle(title);
      });
    } finally {
      await val.close();
    }
  });
});
