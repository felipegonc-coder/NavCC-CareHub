import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { PageComments } from '../comments/page-comments.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { choice, nameOf } from '../sharing/share-dialog.js';
import { KbPage, KnowledgeBase, idOf, makeHandbook, turnIntoKnowledgeBase } from './kb-page.js';

// Knowledge base, section 3.1: turning a page into a knowledge base. Eli (Editor) makes the page
// and its sub-pages, so has Full access on them and owns every page the knowledge base gets.

test.describe('Knowledge base: turning a page into one', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'comments', 'databases', 'knowledgeBase');

  test('KB-01 a page with 24 sub-pages becomes a knowledge base of 24 pages with Owner, Published and Not verified, keeping its address, links and comments', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const refunds = uniqueName('Fictional QA refund steps');
    const others = Array.from({ length: 23 }, (_, n) => `Fictional QA handbook page ${n + 2}`);
    const handbook = await makeHandbook(page, uniqueName('Fictional QA Support handbook'), [
      refunds,
      ...others,
    ]);
    const refundsId = idOf(handbook.subIds, refunds);
    const comment = 'Fictional QA comment that stays with the page';
    await (await apiFor(page)).post('/api/comments', { pageId: refundsId, text: comment });
    const linkText = 'Fictional QA how refunds work';
    const link = page.getByRole('main').getByRole('link', { name: linkText });
    const screen = new PageScreen(page);
    const kb = new KnowledgeBase(page, handbook.id);

    await test.step('The handbook links to one of its sub-pages', async () => {
      await screen.goto(handbook.id);
      await screen.typeAtEnd(linkText);
      await page.keyboard.press('Shift+Home');
      await page.keyboard.press('ControlOrMeta+K');
      await page.keyboard.type(refunds.slice(-6));
      await choice(page, literally(refunds)).click();
      await expect(link).toHaveAttribute('href', new RegExp(`/p/${refundsId}`));
    });

    await test.step('Turn into knowledge base: the confirm counts 24 sub-pages; the address stays', async () => {
      await turnIntoKnowledgeBase(page, handbook.id, 24);
    });

    await test.step('The old content is the Home section, and its link still opens the sub-page', async () => {
      await expect(link).toHaveAttribute('href', new RegExp(`/p/${refundsId}`));
    });

    await test.step('All pages lists 24 pages, each owned by Eli, Published and Not verified', async () => {
      const { owner: owners, status, verification } = await kb.builtIns();
      await kb.view('All pages');
      await expect(kb.screen.rows()).toHaveCount(24);
      const each = (propertyId: string, text: string) =>
        expect(kb.screen.column(propertyId).filter({ hasText: text })).toHaveCount(24);
      await each(owners.id, owner);
      await each(status.id, 'Published');
      await each(verification.id, 'Not verified');
    });

    await test.step('The sub-page keeps its address and its comment, and shows the strip', async () => {
      await screen.goto(refundsId);
      const kbPage = new KbPage(page);
      await expect(kbPage.notVerified).toBeVisible();
      await expect(kbPage.status('Published')).toBeVisible();
      await expect(kbPage.draftBanner).toBeHidden();
      await expect(new PageComments(page).comment(comment)).toBeVisible();
    });
  });
});
