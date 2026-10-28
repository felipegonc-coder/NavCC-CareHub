import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage, spaceIdOf } from '../pages/page-data.js';
import { PageScreen, literally, pageIdOf } from '../pages/page-screen.js';
import { choice, nameOf } from '../sharing/share-dialog.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import {
  MADE_HERE,
  STARTER_CATEGORIES,
  SaveAsTemplate,
  TemplateGallery,
  spaceOfPage,
} from './templates-page.js';

// Templates and buttons, sections 2 and 3.1: the template gallery, Care Hub's starters, Save as
// template and Use template. Eli (Editor) has the Create and Templates permissions (Roles and
// permissions). Each copy goes to Eli's Private space and into Trash at the end.

/** A starter in Meetings, and one in Forms that a search for "meeting" leaves out (section 3.1). */
const MEETING_NOTES = 'Meeting notes';
const REQUEST_FORM = 'Request form';

test.describe('Templates: the gallery and Care Hub starters', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'templates');

  test('TB-01 the gallery has its categories, search and a read-only preview, and Use template puts a copy of a starter in Private', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const gallery = new TemplateGallery(page);
    const screen = new PageScreen(page);

    await test.step('Templates in the sidebar opens the gallery: search box focused, every category', async () => {
      await page.goto('/');
      await gallery.open();
      await expect(gallery.search).toBeFocused();
      for (const category of [MADE_HERE, ...STARTER_CATEGORIES]) {
        await expect(gallery.category(category)).toBeVisible();
      }
    });

    await test.step('Searching "meeting" finds Meeting notes and not Request form', async () => {
      await gallery.search.fill('meeting');
      await expect(gallery.card(MEETING_NOTES)).toBeVisible();
      await expect(gallery.card(REQUEST_FORM)).toBeHidden();
      await gallery.search.clear();
    });

    await test.step('A category shows its own templates', async () => {
      await gallery.category('Forms').click();
      await expect(gallery.card(REQUEST_FORM)).toBeVisible();
      await expect(gallery.card(MEETING_NOTES)).toBeHidden();
      await gallery.category('Meetings').click();
      await expect(gallery.card(MEETING_NOTES)).toBeVisible();
      await expect(gallery.card(REQUEST_FORM)).toBeHidden();
    });

    await test.step('The preview is by Care Hub and nothing in it can be edited', async () => {
      const preview = await gallery.previewOf(MEETING_NOTES);
      await expect(preview).toContainText('by Care Hub');
      await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
    });

    await test.step('Use template → Add to: Private makes the copy there and opens it', async () => {
      const copyId = await gallery.use('Private');
      await expect.poll(() => screen.titleText()).toMatch(new RegExp(MEETING_NOTES, 'i'));
      expect(await spaceOfPage(page, copyId)).toBe(await spaceIdOf(page, 'Private'));
      await (await apiFor(page)).delete(`/api/pages/${copyId}`);
    });
  });
});

test.describe('Templates: a page saved as a template', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'templates');

  test('TB-01 Use template on a page saved with its sub-page copies the sub-page, and the link inside points to the copy', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const author = await nameOf(page);
    const title = uniqueName('Fictional QA template page');
    const subTitle = uniqueName('Fictional QA template sub-page');
    const linkText = 'Fictional QA see the sub-page';
    const sourceId = await makePage(page, title);
    const subId = await makePage(page, subTitle, { parentId: sourceId });
    const screen = new PageScreen(page);
    const link = screen.content.getByRole('link', { name: linkText });
    const gallery = new TemplateGallery(page);
    const saving = new SaveAsTemplate(page);
    const sidebar = new Sidebar(page);
    const ownPages = sidebar.section('Private');
    let copyId = '';

    await test.step('The page links to its sub-page from a line of text', async () => {
      await screen.goto(sourceId);
      await screen.typeAtEnd(linkText);
      await page.keyboard.press('Shift+Home');
      await page.keyboard.press('ControlOrMeta+K');
      await page.keyboard.type(subTitle.slice(-6));
      await choice(page, literally(subTitle)).click();
      await expect(link).toHaveAttribute('href', new RegExp(`/p/${subId}`));
    });

    await test.step('Page menu → Save as template, with "Include sub-pages" on by default', async () => {
      await saving.open();
      await saving.name.fill(title);
      await expect(saving.includeSubPages).toBeChecked();
      await saving.save();
    });

    await test.step('The gallery has it in Made in this workspace, by Eli; the preview counts 1 sub-page', async () => {
      await gallery.open();
      await gallery.category(MADE_HERE).click();
      await expect(gallery.card(title)).toContainText(`by ${author}`);
      const preview = await gallery.previewOf(title);
      await expect(preview).toContainText(/1 sub-page/);
    });

    await test.step('Use template → Private: the copy has a sub-page of its own', async () => {
      copyId = await gallery.use('Private');
      expect(copyId).not.toBe(sourceId);
      await screen.expectTitle(title);
      await sidebar.expand(title, ownPages);
      await expect(sidebar.subEntries(title, ownPages)).toHaveCount(1);
      await expect(sidebar.subEntries(title, ownPages)).toContainText([subTitle]);
    });

    await test.step("The copy's link opens the copied sub-page, not the original", async () => {
      await expect(link).not.toHaveAttribute('href', new RegExp(subId));
      await link.click();
      await expect(page).not.toHaveURL(new RegExp(copyId));
      await screen.expectTitle(subTitle);
      expect(pageIdOf(page)).not.toBe(subId);
    });

    await test.step('The original still links to its own sub-page', async () => {
      await screen.goto(sourceId);
      await expect(link).toHaveAttribute('href', new RegExp(`/p/${subId}`));
      const api = await apiFor(page);
      await api.delete(`/api/pages/${copyId}`);
      await api.delete(`/api/pages/${sourceId}`);
    });
  });
});
