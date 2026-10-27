import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat, control } from '../comments/care-hub-chat.js';
import { PageComments, sendPageComment } from '../comments/page-comments.js';
import { makePage } from '../pages/page-data.js';
import { FORBIDDEN, PageScreen, literally, openAs } from '../pages/page-screen.js';
import { ShareDialog, nameOf } from '../sharing/share-dialog.js';

// FLOW-01, page → share → comment mention → notice: Pages and blocks, Roles and permissions (the
// share dialog, section 3), Comments and mentions (sections 3.3, 3.4 and 5) and Messages (the
// 🔔 Care Hub chat, section 3).

test.describe('Cross-area flow: a page, a share, a comment mention and its notice', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing', 'comments', 'notices');

  test('FLOW-01 Casey, invited to comment on Eli’s page, mentions Eli; the notice reaches Eli’s 🔔 chat within 2 seconds and Open goes to the comment', async ({
    page,
    browser,
  }) => {
    test.slow(); // Three people, each in a browser of their own.
    const title = uniqueName('Fictional QA page');
    const note = uniqueName('Fictional QA note');
    await signInAs(page, 'editor');
    // A page in Eli's Private section: nobody else can open it until Eli shares it.
    const pageId = await makePage(page, title, { space: 'Private' });
    const casey = await openAs(browser, 'commenter');
    const val = await openAs(browser, 'viewer');

    try {
      const [eliName, caseyName, valName] = await Promise.all([
        nameOf(page),
        nameOf(casey.page),
        nameOf(val.page),
      ]);

      await test.step('before it’s shared, Casey can’t open the page, and the answer has no title', async () => {
        const response = await (await apiFor(casey.page)).send('GET', `/api/pages/${pageId}`);
        expect(response.status()).toBe(403);
        const body = await response.text();
        expect(body).not.toContain(title);
        expect(JSON.parse(body)).toMatchObject(FORBIDDEN);
      });

      await test.step('Eli invites Casey with Can comment and Val with Can view; Esc closes the dialog', async () => {
        await new PageScreen(page).goto(pageId);
        const share = new ShareDialog(page);
        await share.open();
        await share.invite(caseyName, 'Can comment');
        await share.invite(valName, 'Can view');
        await share.closeWithEscape();
      });

      await test.step('Casey’s 🔔 chat says Eli shared the page, and its card opens the page', async () => {
        const chat = new CareHubChat(casey.page);
        await chat.open();
        const shared = chat.notice(literally(title), `${eliName} shared ${title} with you`);
        await expect(shared).toBeVisible();
        await control(shared, literally(title)).first().click();
        await expect(casey.page).toHaveURL(literally(`/p/${pageId}`));
        await new PageScreen(casey.page).expectTitle(title);
      });

      const eliChat = new CareHubChat(page);
      const mention = eliChat.notice('Open', note, title);

      await test.step('with Eli’s 🔔 chat open, Casey’s comment mentioning Eli arrives in it within 2 seconds', async () => {
        await eliChat.open();
        const comments = new PageComments(casey.page);
        await comments.addMentioning(eliName, note);
        await expect(mention).toBeVisible({ timeout: 2_000 });
        await expect(control(mention, 'Reply')).toBeVisible();
        await expect(comments.comment(note)).toContainText(eliName);
      });

      await test.step('Open in the notice goes to the comment on the page', async () => {
        await control(mention, 'Open').click();
        await expect(page).toHaveURL(literally(`/p/${pageId}`));
        await expect(new PageComments(page).comment(note)).toBeInViewport();
      });

      await test.step('Val, with Can view, reads the comment but has no comment box; a comment sent to the server is refused (403)', async () => {
        await new PageScreen(val.page).goto(pageId);
        const comments = new PageComments(val.page);
        await expect(comments.comment(note)).toBeVisible();
        await expect(comments.box).toHaveCount(0);
        const response = await sendPageComment(val.page, pageId, 'Fictional QA comment from Val');
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject(FORBIDDEN);
      });

      await test.step('Eli has one notice for the comment, though Eli also follows the page', async () => {
        await eliChat.open();
        await expect(eliChat.shown(note)).toHaveCount(1);
      });
    } finally {
      await Promise.all([casey.close(), val.close()]);
    }
  });
});
