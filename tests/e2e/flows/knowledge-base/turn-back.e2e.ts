import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { NO_ACCESS } from '../sharing/access.js';
import {
  KnowledgeBase,
  confirmDialog,
  idOf,
  makeHandbook,
  turnIntoKnowledgeBase,
} from './kb-page.js';
import { reportByApi } from './reports.js';

// Knowledge base, section 3.1: Turn back into a page, from the database menu. Eli (Editor) makes
// the knowledge base and adds a draft; Val (Viewer) reports a problem on a published page.

type About = { parentId?: string | null; page?: { parentId?: string | null } };

test.describe('Knowledge base: turning it back into a page', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'knowledgeBase');

  test('KB-02 turning it back makes sub-pages again after a confirm listing what goes; drafts stay hidden from readers', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional QA Support handbook');
    const refund = uniqueName('Fictional QA Refund policy');
    const draft = uniqueName('Fictional QA Holiday hours draft');
    const handbook = await makeHandbook(page, title, [refund]);
    await turnIntoKnowledgeBase(page, handbook.id, 1);
    const refundId = idOf(handbook.subIds, refund);
    const kb = new KnowledgeBase(page, handbook.id);
    const val = await openAs(browser, 'viewer');
    let draftId = '';

    await test.step('Test data: a draft added in All pages, and an open report from Val', async () => {
      await kb.open();
      await kb.view('All pages');
      draftId = await kb.addPage(draft);
      await reportByApi(val.page, refundId, 'Out of date');
    });

    await test.step('Database menu → Turn back into a page: the confirm lists what goes', async () => {
      await kb.open();
      await kb.screen.more('Turn back into a page');
      const confirm = confirmDialog(page, /will be removed\./);
      await expect(confirm).toContainText(
        'Owner, status, verification, tags and 1 open report will be removed.',
      );
      await confirm.getByRole('button', { name: /turn back/i }).click();
      await expect(confirm).toBeHidden();
    });

    await test.step('The address shows a page again, and both pages are its sub-pages', async () => {
      await expect(new DatabaseScreen(page, handbook.id).root).toBeHidden();
      await new PageScreen(page).goto(handbook.id);
      await new PageScreen(page).expectTitle(title);
      const api = await apiFor(page);
      for (const id of [refundId, draftId]) {
        const about = await api.get<About>(`/api/pages/${id}`);
        expect(about.page?.parentId ?? about.parentId).toBe(handbook.id);
      }
    });

    await test.step('Val opens the published page, but not the old draft; Eli opens both', async () => {
      await new PageScreen(val.page).goto(refundId);
      await val.page.goto(`/p/${draftId}`);
      await expect(val.page.getByText(NO_ACCESS)).toBeVisible();
      await expect(val.page.getByText(draft)).toHaveCount(0);
      const response = await (await apiFor(val.page)).send('GET', `/api/pages/${draftId}`);
      expect(response.status()).toBe(403);
      await new PageScreen(page).goto(draftId);
      await new PageScreen(page).expectTitle(draft);
    });
    await val.close();
  });
});
