import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import {
  EXPIRY_WAIT,
  KbPage,
  dayIn,
  idOf,
  makeHandbook,
  turnIntoKnowledgeBase,
} from './kb-page.js';
import { changeSettings } from './reports.js';

// Knowledge base, section 3.1, Settings: with "Editing removes verification" on, an edit to a
// verified page makes it Not verified and tells its owners. Eli (Editor) owns the page and turns
// the setting on; Avery (Admin) edits it. An edit counts once it's saved more than 15 seconds after
// the verification, and the task that checks edits runs every minute (#310).

test.describe('Knowledge base: editing removes verification', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'databases', 'knowledgeBase', 'notices');

  test('KB-11 with "Editing removes verification" on, an edit makes the page Not verified and notifies its owners', async ({
    page,
    browser,
  }) => {
    test.setTimeout(EXPIRY_WAIT + 90_000);
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const policy = uniqueName('Fictional QA Refund policy');
    const handbook = await makeHandbook(page, uniqueName('Fictional QA policies'), [policy]);
    await turnIntoKnowledgeBase(page, handbook.id, 1);
    const policyId = idOf(handbook.subIds, policy);
    const screen = new PageScreen(page);
    const kbPage = new KbPage(page);

    await test.step('Eli turns on Editing removes verification and verifies the page for 90 days', async () => {
      await changeSettings(page, handbook.id, { editingRemovesVerification: true });
      await screen.goto(policyId);
      await kbPage.verify(/90 days/);
      await expect(kbPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
    });

    await test.step('Avery edits the page more than 15 seconds later; it becomes Not verified', async () => {
      // The 15 seconds are the rule itself, so this waits for them.
      await page.waitForTimeout(16_000);
      const avery = await openAs(browser, 'admin');
      const averyScreen = new PageScreen(avery.page);
      const edit = 'Fictional QA: refunds take 5 days.';
      await averyScreen.goto(policyId);
      await averyScreen.typeAtEnd(edit);
      await expect((await averyScreen.openAgain()).content).toContainText(edit);
      await avery.close();
      await expect(async () => {
        await screen.goto(policyId);
        await expect(kbPage.notVerified).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: EXPIRY_WAIT, intervals: [5_000] });
    });

    await test.step('Eli, the owner, gets "Verification removed" in the 🔔 chat', async () => {
      const chat = new CareHubChat(page);
      await chat.open();
      await expect(chat.notice(literally(policy), 'Verification removed')).toContainText(
        'This page is no longer verified because it was edited.',
      );
    });
  });
});
