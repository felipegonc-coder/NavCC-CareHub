import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { browseSpaces, createSpace, spaceCard } from '../sidebar/spaces-screens.js';
import { SaveAsTemplate, TemplateGallery } from './templates-page.js';

// Templates and buttons, sections 2 and 3.1: who can use a workspace template, and templates as
// copies, not links. Avery (Admin) makes an Open space and saves a page in it twice: for everyone
// and for Members of the space. Eli (Editor) has the Create permission and isn't in the new space
// until joining it from Browse spaces (Sidebar, section 3.3).

test.describe('Templates: a workspace template for one space', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'templates');

  test("TB-02 a template for Members of a space shows only to its members, and changing it later doesn't change pages made from it", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await signInAs(page, 'admin');
    const owner = await apiFor(page);
    const space = uniqueName('Fictional QA Support');
    // Both templates' names start with this, so one search finds both.
    const word = uniqueName('Fictional QA handover');
    const forEveryone = `${word} for everyone`;
    const forMembers = `${word} for members`;
    const steps = 'Fictional QA check the open tickets';
    const later = 'Fictional QA added after the copy was made';
    const screen = new PageScreen(page);
    const saving = new SaveAsTemplate(page);
    const made: string[] = [];
    const eli = await openAs(browser, 'editor');
    const gallery = new TemplateGallery(eli.page);
    const copy = new PageScreen(eli.page);
    let copyId = '';
    const search = async () => {
      await gallery.open();
      await gallery.search.fill(word);
    };
    try {
      made.push(await createSpace(page, space, 'Open', 'Fictional QA: the support team'));
      const sourceId = await makePage(page, uniqueName('Fictional QA handover page'), { space });

      await test.step('Avery saves one page as two templates: for everyone, and for Members of the space', async () => {
        await screen.goto(sourceId);
        await screen.typeAtEnd(steps);
        await expect(screen.content).toContainText(steps);
        const choices: [string, string][] = [
          [forEveryone, 'Everyone in the workspace'],
          [forMembers, `Members of ${space}`],
        ];
        for (const [name, who] of choices) {
          await saving.open();
          await saving.name.fill(name);
          await saving.whoCanUse(who);
          await saving.save();
        }
      });

      await test.step("Eli, not in the space, finds the one for everyone and not the members' one", async () => {
        await eli.page.goto('/');
        await search();
        await expect(gallery.card(forEveryone)).toBeVisible();
        await expect(gallery.card(forMembers)).toBeHidden();
        await eli.page.keyboard.press('Escape');
        await expect(gallery.dialog).toBeHidden();
      });

      await test.step("Eli joins the space; the members' template shows, and Use template copies it", async () => {
        const browse = await browseSpaces(eli.page);
        await spaceCard(browse, space).getByRole('button', { name: 'Join', exact: true }).click();
        // Closes Browse spaces if it's a dialog.
        await eli.page.keyboard.press('Escape');
        await expect(new Sidebar(eli.page).section(space)).toBeVisible();
        await search();
        await gallery.previewOf(forMembers);
        copyId = await gallery.use('Private');
        await expect(copy.content).toContainText(steps);
      });

      await test.step('Avery changes the template: card menu → Edit template, with its banner', async () => {
        const ownGallery = new TemplateGallery(page);
        await ownGallery.open();
        await ownGallery.search.fill(word);
        await ownGallery.editTemplate(forMembers);
        await screen.typeAtEnd(later);
        await expect(screen.content).toContainText(later);
      });

      await test.step("The template's preview has the change; Eli's copy doesn't", async () => {
        await search();
        const preview = await gallery.previewOf(forMembers);
        await expect(preview).toContainText(later);
        await copy.goto(copyId);
        await expect(copy.content).toContainText(steps);
        await expect(copy.content).not.toContainText(later);
      });
    } finally {
      if (copyId) await (await apiFor(eli.page)).send('DELETE', `/api/pages/${copyId}`);
      // Delete space moves the space and its pages to Trash (Sidebar, section 3.3).
      for (const id of made) await owner.send('DELETE', `/api/spaces/${id}`);
      await eli.close();
    }
  });
});
