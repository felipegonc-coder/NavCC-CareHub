import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { SearchWindow, uniqueWord } from '../search/search-window.js';
import { NO_ACCESS } from '../sharing/access.js';
import { nameOf } from '../sharing/share-dialog.js';
import { KbPage, KnowledgeBase, makeHandbook, turnIntoKnowledgeBase } from './kb-page.js';

// Knowledge base, section 3.2: drafts, Publish and Back to draft. Eli (Editor) makes the knowledge
// base in the team space; Val (Viewer) reads it with Can view, as Riley does in the spec.

test.describe('Knowledge base: drafts and publishing', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'search', 'knowledgeBase');

  test('KB-03 a new page starts as Draft, and a reader finds it in no view, no search and not at its address; the server refuses it (403)', async ({
    page,
    browser,
  }) => {
    const word = uniqueWord();
    const published = `Fictional QA ${word} published article`;
    const draft = `Fictional QA ${word} draft article`;
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const handbook = await makeHandbook(page, `Fictional QA ${word} handbook`, [published]);
    await turnIntoKnowledgeBase(page, handbook.id, 1);
    const kb = new KnowledgeBase(page, handbook.id);
    let draftId = '';

    await test.step('Eli adds a page: it starts as Draft, owned by Eli', async () => {
      await kb.view('All pages');
      draftId = await kb.addPage(draft);
      const { owner: owners, status } = await kb.builtIns();
      await expect(kb.screen.cell(draftId, status.id)).toContainText('Draft');
      await expect(kb.screen.cell(draftId, owners.id)).toContainText(owner);
      await new PageScreen(page).goto(draftId);
      await expect(new KbPage(page).draftBanner).toBeVisible();
    });

    const val = await openAs(browser, 'viewer');
    await test.step('Val sees the published page in All pages, and not the draft', async () => {
      const valKb = new KnowledgeBase(val.page, handbook.id);
      await valKb.open();
      await valKb.view('All pages');
      await expect(valKb.screen.row(published)).toBeVisible();
      await expect(valKb.screen.rows()).toHaveCount(1);
    });

    await test.step('Search finds the published page for Val, and not the draft', async () => {
      const search = new SearchWindow(val.page);
      await search.openWith();
      await search.waitUntilFound(word, published);
      await expect(search.result(draft)).toHaveCount(0);
      await search.close();
    });

    await test.step("At the draft's address Val gets the no-access message; the API answers 403 without its title", async () => {
      await val.page.goto(`/p/${draftId}`);
      await expect(val.page.getByText(NO_ACCESS)).toBeVisible();
      await expect(val.page.getByText(draft)).toHaveCount(0);
      const response = await (await apiFor(val.page)).send('GET', `/api/pages/${draftId}`);
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain(draft);
    });
    await val.close();
  });
});

test.describe('Knowledge base: publishing and back to draft', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'knowledgeBase');

  test('KB-04 Publish shows the page to a reader at once; Back to draft asks first, then hides it again', async ({
    page,
    browser,
  }) => {
    const word = uniqueWord();
    const published = `Fictional QA ${word} published article`;
    const draft = `Fictional QA ${word} draft article`;
    await signInAs(page, 'editor');
    const handbook = await makeHandbook(page, `Fictional QA ${word} handbook`, [published]);
    await turnIntoKnowledgeBase(page, handbook.id, 1);
    const kb = new KnowledgeBase(page, handbook.id);
    await kb.view('All pages');
    const draftId = await kb.addPage(draft);
    const kbPage = new KbPage(page);
    await new PageScreen(page).goto(draftId);

    // Val keeps All pages open the whole time: what Eli does shows there without a reload.
    const val = await openAs(browser, 'viewer');
    const valKb = new KnowledgeBase(val.page, handbook.id);
    await valKb.open();
    await valKb.view('All pages');
    await expect(valKb.screen.rows()).toHaveCount(1);

    await test.step('Publish in the Draft banner: Val sees the page at once', async () => {
      await kbPage.publish();
      await expect(kbPage.status('Published')).toBeVisible();
      await expect(valKb.screen.row(draft)).toBeVisible();
      await expect(valKb.screen.rows()).toHaveCount(2);
    });

    await test.step('Back to draft, after "Readers won\'t see this page anymore.": hidden from Val again', async () => {
      await kbPage.backToDraft();
      await expect(valKb.screen.row(draft)).toHaveCount(0);
      await expect(valKb.screen.rows()).toHaveCount(1);
      const response = await (await apiFor(val.page)).send('GET', `/api/pages/${draftId}`);
      expect(response.status()).toBe(403);
    });
    await val.close();
  });
});
