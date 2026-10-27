import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import {
  KbPage,
  KnowledgeBase,
  dayIn,
  idOf,
  makeHandbook,
  minutesIn,
  setVerifiedUntil,
  turnIntoKnowledgeBase,
} from './kb-page.js';

// Knowledge base, section 3.3: verifying a page, and the page turning Expired at 9:00 AM in its
// owner's time zone on the until date. Eli (Editor) owns the pages, in the default time zone
// (America/Denver); Val (Viewer) reads them. The until dates that have come are test data.

/** 9:00 AM, and a margin around it in which the expiry may not have shown yet. */
const NINE_AM = 9 * 60;
const MARGIN = 15;

test.describe('Knowledge base: verification', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'knowledgeBase');

  test("KB-05 Verify for 90 days shows the name and until date; on the until date the page turns Expired at 9:00 AM in the owner's time zone, and readers see the banner", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const refund = uniqueName('Fictional QA Refund policy');
    const returns = uniqueName('Fictional QA Returns policy');
    const handbook = await makeHandbook(page, uniqueName('Fictional QA policies'), [
      refund,
      returns,
    ]);
    await turnIntoKnowledgeBase(page, handbook.id, 2);
    const { verification } = await new KnowledgeBase(page, handbook.id).builtIns();
    const kb = { id: handbook.id, verificationId: verification.id };
    const refundId = idOf(handbook.subIds, refund);
    const returnsId = idOf(handbook.subIds, returns);
    const screen = new PageScreen(page);
    const kbPage = new KbPage(page);
    const val = await openAs(browser, 'viewer');
    const valScreen = new PageScreen(val.page);
    const valPage = new KbPage(val.page);

    await test.step('Verify for 90 days: the badge names Eli and the date 90 days from today', async () => {
      await screen.goto(refundId);
      await expect(kbPage.notVerified).toBeVisible();
      await kbPage.verify(/90 days/);
      await expect(kbPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
      await valScreen.goto(refundId);
      await expect(valPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
    });

    const yesterday = dayIn(-1);
    await test.step('Test data: verified until yesterday. Eli sees it Expired and due for review; Val sees the banner', async () => {
      await setVerifiedUntil(page, kb, refundId, yesterday.iso);
      await screen.goto(refundId);
      await expect(kbPage.expiredBadge(yesterday)).toBeVisible();
      await expect(kbPage.reviewBanner(yesterday)).toBeVisible();
      await valScreen.goto(refundId);
      await expect(valPage.readerBanner(yesterday)).toBeVisible();
    });

    const today = dayIn(0);
    const now = minutesIn();
    await test.step("Test data: verified until today. Expired from 9:00 AM in the owner's time zone, verified before", async () => {
      if (Math.abs(now - NINE_AM) < MARGIN) {
        test
          .info()
          .annotations.push({ type: 'note', description: 'Too close to 9:00 AM to tell.' });
        return;
      }
      await setVerifiedUntil(page, kb, returnsId, today.iso);
      await valScreen.goto(returnsId);
      if (now >= NINE_AM) {
        await expect(valPage.readerBanner(today)).toBeVisible();
        await expect(valPage.expiredBadge(today)).toBeVisible();
      } else {
        await expect(valPage.verifiedBadge(owner, today)).toBeVisible();
        await expect(valPage.readerBanner(today)).toBeHidden();
      }
    });
    await val.close();
  });
});
