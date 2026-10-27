import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import {
  EXPIRY_WAIT,
  KbPage,
  dayIn,
  idOf,
  makeHandbook,
  minutesIn,
  setVerifiedUntil,
  turnIntoKnowledgeBase,
  untilExpiryShows,
} from './kb-page.js';

// Knowledge base, section 3.3: verifying a page, and the page turning Expired at 9:00 AM in its
// owner's time zone on the until date. Eli (Editor) owns the pages, in the default time zone
// (America/Denver); Val (Viewer) reads them. Until dates of today and yesterday are test data.

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
    test.setTimeout(EXPIRY_WAIT + 2 * 60_000);
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const refund = uniqueName('Fictional QA Refund policy');
    const returns = uniqueName('Fictional QA Returns policy');
    const handbook = await makeHandbook(page, uniqueName('Fictional QA policies'), [
      refund,
      returns,
    ]);
    await turnIntoKnowledgeBase(page, handbook.id, 2);
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
    const today = dayIn(0);
    const now = minutesIn();
    const nearNine = Math.abs(now - NINE_AM) < MARGIN;
    await test.step('Test data: Refund policy verified until yesterday, Returns policy until today', async () => {
      await setVerifiedUntil(page, refundId, yesterday.iso);
      if (!nearNine) await setVerifiedUntil(page, returnsId, today.iso);
    });

    await test.step("Yesterday's 9:00 AM has passed: Eli sees Expired and due for review, Val the banner", async () => {
      await untilExpiryShows(screen, refundId, kbPage.expiredBadge(yesterday));
      await expect(kbPage.reviewBanner(yesterday)).toBeVisible();
      await valScreen.goto(refundId);
      await expect(valPage.readerBanner(yesterday)).toBeVisible();
      await expect(valPage.reviewBanner(yesterday)).toBeHidden();
    });

    await test.step("Until today: Expired from 9:00 AM in the owner's time zone, still verified before", async () => {
      if (nearNine) {
        test
          .info()
          .annotations.push({ type: 'note', description: 'Too close to 9:00 AM to tell.' });
        return;
      }
      if (now >= NINE_AM) {
        await untilExpiryShows(valScreen, returnsId, valPage.readerBanner(today));
        await expect(valPage.expiredBadge(today)).toBeVisible();
      } else {
        // The expiry task has run since both were set (Refund policy turned Expired).
        await valScreen.goto(returnsId);
        await expect(valPage.verifiedBadge(owner, today)).toBeVisible();
        await expect(valPage.readerBanner(today)).toBeHidden();
      }
    });
    await val.close();
  });
});
