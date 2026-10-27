import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { CareHubChat, control } from '../comments/care-hub-chat.js';
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
} from '../knowledge-base/kb-page.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { SearchWindow, uniqueWord } from '../search/search-window.js';
import { nameOf } from '../sharing/share-dialog.js';

// FLOW-07, knowledge base review (specs README, cross-area flows; KB-05, KB-06, KB-07, KB-12):
// Knowledge base (sections 2 and 3.3), Messages (the 🔔 Care Hub chat) and Search (SR-05). Eli
// (Editor) owns the pages, in the default time zone (America/Denver); Val (Viewer) reads them.

/** From 9:15 AM the test data is "until today"; before, it's yesterday, whose 9:00 AM has passed. */
const NINE_FIFTEEN = 9 * 60 + 15;

/** A result row's name starts with its title: "Refund steps, page in Support › …". */
const startingWith = (title: string) => new RegExp(`^${literally(title).source}`);

test.describe('Cross-area flow: a knowledge base page expires, is reviewed and ranks again', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'knowledgeBase', 'notices', 'search');

  test("FLOW-07 Refund policy, verified until today, turns Expired at 9:00 AM in the owner's time zone with a 🔔 notice and the readers' banner; Review now → Verify for 90 days brings the badge back, and it ranks above an equal unverified page", async ({
    page,
    browser,
  }) => {
    test.setTimeout(EXPIRY_WAIT + 2 * 60_000);
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const word = uniqueWord();
    const refund = `Fictional QA ${word} Refund policy East`;
    const twin = `Fictional QA ${word} Refund policy West`;
    const handbook = await makeHandbook(page, `Fictional QA Support handbook ${uniqueWord()}`, [
      refund,
      twin,
    ]);
    await turnIntoKnowledgeBase(page, handbook.id, 2);
    const refundId = idOf(handbook.subIds, refund);
    const screen = new PageScreen(page);
    const kbPage = new KbPage(page);
    const val = await openAs(browser, 'viewer');
    const valScreen = new PageScreen(val.page);
    const valPage = new KbPage(val.page);
    const until = minutesIn() >= NINE_FIFTEEN ? dayIn(0) : dayIn(-1);

    await test.step('Test data: Refund policy verified until today (before 9:15 AM, yesterday)', async () => {
      await setVerifiedUntil(page, refundId, until.iso);
    });

    await test.step('Its 9:00 AM has passed: it turns Expired, and Eli sees "Due for review"', async () => {
      await untilExpiryShows(screen, refundId, kbPage.reviewBanner(until));
      await expect(kbPage.expiredBadge(until)).toBeVisible();
    });

    const chat = new CareHubChat(page);
    await test.step('Eli gets the notice in the 🔔 chat, with the page', async () => {
      await chat.open();
      await expect(chat.notice(literally(refund), 'Due for review')).toContainText(
        'This page needs review: its verification expired today.',
      );
    });

    await test.step('Val sees the expired banner', async () => {
      await valScreen.goto(refundId);
      await expect(valPage.readerBanner(until)).toBeVisible();
    });

    await test.step('From the notice, Review now → Verify for 90 days: the badge is back for both', async () => {
      await control(chat.notice(literally(refund), 'Due for review'), literally(refund)).click();
      await expect(page).toHaveURL(new RegExp(`/p/${refundId}`));
      await kbPage.reviewNow();
      await kbPage.review(/^Verify for 90 days$/);
      await expect(kbPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
      await expect(kbPage.reviewBanner(until)).toBeHidden();
      await valScreen.goto(refundId);
      await expect(valPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
      await expect(valPage.readerBanner(until)).toBeHidden();
    });

    await test.step('Searching for the word lists Refund policy East above its unverified twin', async () => {
      const search = new SearchWindow(page);
      await search.openWith();
      await search.waitUntilFound(word, twin);
      await expect(search.results.nth(0)).toHaveAccessibleName(startingWith(refund));
      await expect(search.results.nth(1)).toHaveAccessibleName(startingWith(twin));
      await search.close();
    });
    await val.close();
  });
});
