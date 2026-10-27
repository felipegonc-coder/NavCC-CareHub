import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { PageScreen } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import {
  EXPIRY_WAIT,
  KbPage,
  dayIn,
  idOf,
  makeHandbook,
  setVerifiedUntil,
  turnIntoKnowledgeBase,
  untilExpiryShows,
} from './kb-page.js';

// Knowledge base, section 3.3: Review now on an expired page, then the review bar's Verify for 90
// days or Needs changes. Eli (Editor) owns the pages. Until dates of yesterday are test data.

test.describe('Knowledge base: reviews', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'databases', 'knowledgeBase');

  test('KB-07 Review now → Verify renews the date; Needs changes keeps it Expired and starts editing', async ({
    page,
  }) => {
    test.setTimeout(EXPIRY_WAIT + 90_000);
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const renewed = uniqueName('Fictional QA Refund policy');
    const changed = uniqueName('Fictional QA Phone hours');
    const handbook = await makeHandbook(page, uniqueName('Fictional QA policies'), [
      renewed,
      changed,
    ]);
    await turnIntoKnowledgeBase(page, handbook.id, 2);
    const renewedId = idOf(handbook.subIds, renewed);
    const changedId = idOf(handbook.subIds, changed);
    const screen = new PageScreen(page);
    const kbPage = new KbPage(page);
    const yesterday = dayIn(-1);

    await test.step('Test data: both pages verified until yesterday, so they turn Expired', async () => {
      await setVerifiedUntil(page, renewedId, yesterday.iso);
      await setVerifiedUntil(page, changedId, yesterday.iso);
      await untilExpiryShows(screen, renewedId, kbPage.reviewBanner(yesterday));
    });

    await test.step('Review now → Verify for 90 days: Eli and a new date, and the banner goes', async () => {
      await kbPage.reviewNow();
      await kbPage.review(/^Verify for 90 days$/);
      await expect(kbPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
      await expect(kbPage.reviewBanner(yesterday)).toBeHidden();
      const again = await screen.openAgain();
      await expect(new KbPage(again.page).verifiedBadge(owner, dayIn(90))).toBeVisible();
      await again.page.close();
    });

    await test.step('Review now → Needs changes: it stays Expired, and what Eli types goes into the page', async () => {
      await screen.goto(changedId);
      await kbPage.reviewNow();
      await kbPage.review('Needs changes');
      await expect(kbPage.expiredBadge(yesterday)).toBeVisible();
      const change = 'Fictional QA: phone lines now open at 8 AM.';
      await page.keyboard.type(change);
      await expect(screen.content).toContainText(change);
      const again = await screen.openAgain();
      await expect(again.content).toContainText(change);
      await expect(new KbPage(again.page).expiredBadge(yesterday)).toBeVisible();
      await again.page.close();
    });
  });
});
