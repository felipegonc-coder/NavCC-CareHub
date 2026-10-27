import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { SearchWindow, uniqueWord } from '../search/search-window.js';
import { nameOf } from '../sharing/share-dialog.js';
import {
  KbPage,
  KnowledgeBase,
  dayIn,
  idOf,
  makeHandbook,
  turnIntoKnowledgeBase,
} from './kb-page.js';
import { healthLine, reportByApi } from './reports.js';

// Knowledge base, sections 2 and 3.3, and Search (SR-05): verified pages rank higher, and the
// health line on the home sums up the views. Eli (Editor) makes the knowledge base; Val (Viewer)
// reports a problem on one page. The two pages differ only in their last letter.

/** A result row's name starts with its title: "Refund steps, page in Support › …". */
const startingWith = (title: string) => new RegExp(`^${literally(title).source}`);

test.describe('Knowledge base: search ranking and health', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'search', 'knowledgeBase');

  test("KB-12 a verified page ranks above an otherwise equal unverified page in search; the health line's numbers match the views", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const word = uniqueWord();
    const first = `Fictional QA ${word} refund steps A`;
    const second = `Fictional QA ${word} refund steps B`;
    const handbook = await makeHandbook(page, `Fictional QA handbook ${uniqueWord()}`, [
      first,
      second,
    ]);
    await turnIntoKnowledgeBase(page, handbook.id, 2);
    const firstId = idOf(handbook.subIds, first);
    const secondId = idOf(handbook.subIds, second);
    const screen = new PageScreen(page);
    const kbPage = new KbPage(page);
    const search = new SearchWindow(page);

    /** Searches for the word and checks which of the two pages comes first. */
    const ranksFirst = async (top: string, below: string) => {
      await search.openWith();
      await search.waitUntilFound(word, below);
      await expect(search.results.nth(0)).toHaveAccessibleName(startingWith(top));
      await expect(search.results.nth(1)).toHaveAccessibleName(startingWith(below));
      await search.close();
    };

    await test.step('Eli verifies page A for 90 days: A comes before B', async () => {
      await screen.goto(firstId);
      await kbPage.verify(/90 days/);
      await expect(kbPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
      await ranksFirst(first, second);
    });

    await test.step('A loses its verification and B gets one: now B comes first', async () => {
      await kbPage.verify(/^remove verification/i);
      await expect(kbPage.notVerified).toBeVisible();
      await screen.goto(secondId);
      await kbPage.verify(/90 days/);
      await expect(kbPage.verifiedBadge(owner, dayIn(90))).toBeVisible();
      await ranksFirst(second, first);
    });

    const val = await openAs(browser, 'viewer');
    await test.step('Val reports a problem on page A (test data)', async () => {
      await reportByApi(val.page, firstId, 'Out of date');
    });

    const kb = new KnowledgeBase(page, handbook.id);
    await test.step('The home says "50% verified · 0 expired · 1 open report", as the views show', async () => {
      await kb.open();
      await expect(healthLine(page)).toHaveText('50% verified · 0 expired · 1 open report');
      await kb.view('All pages');
      await expect(kb.screen.rows()).toHaveCount(2);
      await expect(kb.screen.rows().filter({ hasText: /Verified/ })).toHaveCount(1);
      await kb.view('Needs review');
      await expect(kb.screen.rows()).toHaveCount(0);
      await kb.view('Reports');
      await expect(kb.screen.root.getByText(first).first()).toBeVisible();
    });

    await test.step('The health route answers Eli and refuses Val, who can only view (403)', async () => {
      await (await apiFor(page)).get(`/api/knowledge/bases/${handbook.id}/health`);
      const refused = await (
        await apiFor(val.page)
      ).send('GET', `/api/knowledge/bases/${handbook.id}/health`);
      expect(refused.status()).toBe(403);
    });
    await val.close();
  });
});
