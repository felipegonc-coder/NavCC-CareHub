import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { AccessDialog, NO_ACCESS } from './access.js';
import { requestAccess } from './members.js';
import { nameOf } from './share-dialog.js';

// Roles and permissions, section 3: access requests, and moving a page to a place with other
// access. Avery (Admin) owns the pages, in Avery's Private space, so only the people a test shares
// with can open them.

test.describe('Sharing: access requests', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing', 'notices');

  test('RP-24 a request for access never shows the title; after the owner declines, the requester is told and asking again is refused', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const title = uniqueName('Fictional QA private page');
    const pageId = await makePage(page, title, { space: 'Private' });
    const eli = await openAs(browser, 'editor');
    const eliName = await nameOf(eli.page);

    await test.step('Eli opens its link: no access, no title; Request access with a note', async () => {
      await eli.page.goto(`/p/${pageId}`);
      await expect(eli.page.getByText(NO_ACCESS)).toBeVisible();
      await requestAccess(eli.page, 'Fictional QA I need this for a shift handover');
      await expect(eli.page.getByText(literally(title))).toHaveCount(0);
    });

    await test.step("Avery's 🔔 chat has the request with Give Can view, Give Can edit and Decline; Avery declines", async () => {
      const chat = new CareHubChat(page);
      await chat.open();
      const notice = chat.notice('Decline', eliName, title);
      await expect(notice.getByRole('button', { name: 'Give Can view' })).toBeVisible();
      await expect(notice.getByRole('button', { name: 'Give Can edit' })).toBeVisible();
      await notice.getByRole('button', { name: 'Decline' }).click();
    });

    await test.step('Opening the link again, Eli is told it was declined and can ask again only after 24 hours', async () => {
      await eli.page.goto(`/p/${pageId}`);
      await expect(eli.page.getByText(NO_ACCESS)).toBeVisible();
      await expect(eli.page.getByText(/declined/i).first()).toBeVisible();
      const refused = eli.page
        .getByText(/ask again/i)
        .or(eli.page.getByRole('button', { name: 'Request access', disabled: true }))
        .first();
      await expect(refused).toBeVisible();
      await expect(eli.page.getByText(literally(title))).toHaveCount(0);
    });
    await eli.close();
  });
});

test.describe('Sharing: moving a page changes its access', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing');

  test('RP-25 moving a page under one with other access names the changes first, and afterwards access matches them', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const eli = await openAs(browser, 'editor');
    const casey = await openAs(browser, 'commenter');
    const caseyName = await nameOf(casey.page);
    const fromId = await makePage(page, uniqueName('Fictional QA shelf for Eli'), {
      space: 'Private',
    });
    const toTitle = uniqueName('Fictional QA shelf for Casey');
    const toId = await makePage(page, toTitle, { space: 'Private' });
    const title = uniqueName('Fictional QA refund steps');
    const movedId = await makePage(page, title, { parentId: fromId });
    const screen = new PageScreen(page);
    const share = async (pageId: string, name: string, level: 'Can edit' | 'Can view') => {
      await screen.goto(pageId);
      const dialog = new AccessDialog(page);
      await dialog.open();
      await dialog.invite(name, level);
      await dialog.closeWithEscape();
    };
    await share(fromId, await nameOf(eli.page), 'Can edit');
    await share(toId, caseyName, 'Can view');

    await test.step('Move to the other shelf: "1 person loses access; Casey gets Can view", then Move', async () => {
      await screen.goto(movedId);
      const menu = await screen.openPageMenu();
      await menu.getByRole('menuitem', { name: 'Move to', exact: true }).click();
      const picker = page.getByRole('dialog', { name: /move/i });
      await picker.getByRole('searchbox').or(picker.getByRole('textbox')).first().fill(toTitle);
      await picker
        .getByRole('option', { name: literally(toTitle) })
        .or(picker.getByRole('button', { name: literally(toTitle) }))
        .first()
        .click();
      const confirm = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog'))
        .filter({ hasText: 'changes who can open it' });
      await expect(confirm).toContainText(
        `Moving ${title} to ${toTitle} changes who can open it: 1 person loses access; ${caseyName} gets Can view.`,
      );
      await confirm.getByRole('button', { name: /^move/i }).click();
      await expect(confirm).toBeHidden();
    });

    await test.step('Afterwards Eli gets the no-access message and Casey can view it', async () => {
      await eli.page.goto(`/p/${movedId}`);
      await expect(eli.page.getByText(NO_ACCESS)).toBeVisible();
      const caseyScreen = new PageScreen(casey.page);
      await caseyScreen.goto(movedId);
      await expect(caseyScreen.viewOnly).toBeVisible();
    });
    await eli.close();
    await casey.close();
  });
});
