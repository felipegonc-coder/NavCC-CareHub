import type { Locator } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { makePage } from './page-data.js';
import { FORBIDDEN, PageScreen, TEAM_SPACE, literally, openAs } from './page-screen.js';

// Pages and blocks, sections 2, 3.1 and 3.2: the page screen, its header and the page menu.

/** Whether the text is drawn with a line through it, by the element itself or one around it. */
const struckThrough = (text: Locator) =>
  text.evaluate((element) => {
    for (let at: Element | null = element; at; at = at.parentElement) {
      if (getComputedStyle(at).textDecorationLine.includes('line-through')) return true;
    }
    return false;
  });

test.describe('Pages: new pages and who can change them', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('SH-21 a new page in a space opens untitled with the cursor in the title, and Enter starts the first block', async ({
    page,
  }) => {
    const title = uniqueName('Fictional QA page');
    const text = 'Fictional QA first line.';
    const hint = 'Press Enter to start writing, or start with:';
    await signInAs(page, 'editor');
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);

    await test.step('"+" next to the space opens an untitled page, cursor in the title', async () => {
      const space = sidebar.section(TEAM_SPACE);
      await space.hover();
      await space
        .getByRole('button', { name: /^(add a page|new page)/i })
        .first()
        .click();
      await expect(screen.title).toBeFocused();
      await expect(page).toHaveTitle(/Untitled/);
      await expect(screen.main.getByText(hint)).toBeVisible();
    });

    await test.step('the browser tab and the sidebar show the title as it is typed', async () => {
      await page.keyboard.type(title);
      await expect(page).toHaveTitle(literally(title));
      await expect(sidebar.entry(title, sidebar.section(TEAM_SPACE))).toBeVisible();
    });

    await test.step('Enter moves to the first block, and typing hides the start hint', async () => {
      await page.keyboard.press('Enter');
      await expect(screen.content).toBeFocused();
      await page.keyboard.type(text);
      await expect(screen.main.getByText(hint)).toBeHidden();
    });

    await test.step('opened again, the page has its title and text', async () => {
      const again = await screen.openAgain();
      await again.expectTitle(title);
      await expect(again.content).toContainText(text);
    });
  });

  test('PB-32 someone with Can view gets a read-only page, and a change they send is refused (403)', async ({
    page,
    browser,
  }) => {
    const title = uniqueName('Fictional QA page');
    const text = 'Fictional QA text that Val can read.';
    await signInAs(page, 'editor');
    const id = await makePage(page, title);
    const eli = new PageScreen(page);
    await eli.goto(id);
    await eli.typeAtEnd(text);
    const val = await openAs(browser, 'viewer');

    try {
      const screen = new PageScreen(val.page);
      await test.step('Val, a Viewer, sees "View only" and no + or ⋮⋮ beside the blocks', async () => {
        await screen.goto(id);
        await expect(screen.viewOnly).toBeVisible();
        await screen.content.getByText(text).hover();
        await expect(
          val.page.getByRole('button', { name: /add a block|drag|block menu/i }),
        ).toHaveCount(0);
      });

      await test.step('typing in the title or the text changes nothing', async () => {
        await screen.content.getByText(text).click();
        await val.page.keyboard.type(' Fictional QA edit');
        await screen.title.click();
        await val.page.keyboard.type(' Fictional QA edit');
        await expect(screen.content).not.toContainText('Fictional QA edit');
        await screen.expectTitle(title);
      });

      await test.step('a title change sent straight to the server is refused (403)', async () => {
        const api = await apiFor(val.page);
        const response = await api.send('PATCH', `/api/pages/${id}`, {
          title: 'Fictional QA edit',
        });
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject(FORBIDDEN);
        await (await eli.openAgain()).expectTitle(title);
      });
    } finally {
      await val.close();
    }
  });
});

test.describe('Pages: icon, cover and Move to', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages');

  test('SH-22 an emoji icon shows in the header, the browser tab and the sidebar, and can be removed', async ({
    page,
  }) => {
    const title = uniqueName('Fictional QA page');
    await signInAs(page, 'editor');
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    await screen.goto(await makePage(page, title));
    const icon = screen.main.getByText('🚀', { exact: true });
    const picker = page.getByRole('dialog');

    await test.step('Add icon opens the emoji picker; searching "rocket" finds 🚀', async () => {
      await screen.title.hover();
      await screen.button('Add icon').click();
      await picker.getByRole('searchbox').or(picker.getByRole('textbox')).first().fill('rocket');
      await picker
        .getByRole('button', { name: /rocket/i })
        .or(picker.getByRole('option', { name: /rocket/i }))
        .first()
        .click();
    });

    await test.step('🚀 shows in the header, the browser tab and the sidebar entry', async () => {
      await expect(icon).toBeVisible();
      await expect(sidebar.entry(title)).toContainText('🚀');
      // The tab shows the icon in its title or as its picture (favicon).
      const favicon = page.locator('link[rel~="icon"]').first();
      const tab = async () =>
        `${await page.title()} ${decodeURIComponent((await favicon.getAttribute('href')) ?? '')}`;
      await expect.poll(tab).toContain('🚀');
      await expect((await screen.openAgain()).main.getByText('🚀', { exact: true })).toBeVisible();
    });

    await test.step('Remove takes it away, and Add icon is offered again', async () => {
      await icon.click();
      await picker.getByRole('button', { name: 'Remove' }).click();
      await expect(icon).toHaveCount(0);
      await expect(sidebar.entry(title)).not.toContainText('🚀');
      await screen.title.hover();
      await expect(screen.button('Add icon')).toBeVisible();
    });
  });

  test('SH-23 a cover is 280 px tall on a computer, stays when the page is opened again, and can be removed', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const screen = new PageScreen(page);
    await screen.goto(await makePage(page, uniqueName('Fictional QA page')));
    const coverOf = (on: PageScreen) => on.main.getByRole('img', { name: /cover/i });

    await test.step('Add cover puts a picture from the gallery above the title', async () => {
      await screen.title.hover();
      await screen.button('Add cover').click();
      await expect(coverOf(screen)).toBeVisible();
      expect((await coverOf(screen).boundingBox())?.height).toBeCloseTo(280, 0);
    });

    await test.step('the cover is still there when the page is opened again', async () => {
      await expect(coverOf(await screen.openAgain())).toBeVisible();
    });

    await test.step('hovering the cover offers Change, Reposition and Remove; Remove takes it away', async () => {
      await coverOf(screen).hover();
      await expect(screen.button(/^change/i)).toBeVisible();
      await expect(screen.button(/^reposition/i)).toBeVisible();
      await screen.button(/^remove/i).click();
      await expect(coverOf(screen)).toHaveCount(0);
    });
  });

  test('PB-24 Move to warns when access changes, and the moved page keeps its sub-pages', async ({
    page,
  }) => {
    const title = uniqueName('Fictional QA page');
    const subTitle = uniqueName('Fictional QA sub-page');
    // Avery, an Admin, has Full access in the team space, which moving needs (section 4).
    await signInAs(page, 'admin');
    const id = await makePage(page, title);
    await makePage(page, subTitle, { parentId: id });
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    await screen.goto(id);

    await test.step('Move to Private asks first, saying how many people lose access', async () => {
      const menu = await screen.openPageMenu();
      await menu.getByRole('menuitem', { name: 'Move to', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /move/i });
      await dialog.getByRole('searchbox').or(dialog.getByRole('textbox')).first().fill('Private');
      await dialog
        .getByRole('option', { name: /^private/i })
        .or(dialog.getByRole('button', { name: /^private/i }))
        .first()
        .click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toContainText(/\d+ (person|people) will lose access/);
      await confirm.getByRole('button', { name: /^move/i }).click();
    });

    await test.step('the page is under Private now, with its sub-page inside', async () => {
      await expect(sidebar.entry(title, sidebar.section('Private'))).toBeVisible();
      await expect(sidebar.entry(title, sidebar.section(TEAM_SPACE))).toHaveCount(0);
      await sidebar.expand(title);
      await expect(sidebar.subEntries(title)).toHaveText([literally(subTitle)]);
    });
  });
});

test.describe('Pages: renames and links', () => {
  onlyIn('desktop-light');
  // '@' page mentions come with comments; restoring from Trash with trashHistory.
  needs('signIn', 'appShell', 'pages', 'editor', 'comments', 'trashHistory');

  test('PB-19 a rename shows live in mentions, links, breadcrumbs and the sidebar; a link to a trashed page is struck through until restored', async ({
    page,
  }) => {
    const target = uniqueName('Fictional QA page');
    const renamed = uniqueName('Fictional QA renamed page');
    const linkText = 'Fictional QA link text';
    await signInAs(page, 'admin');
    const targetId = await makePage(page, target);
    const subId = await makePage(page, uniqueName('Fictional QA sub-page'), { parentId: targetId });
    const linkingId = await makePage(page, uniqueName('Fictional QA page with links'));
    // This tab shows the sub-page, whose breadcrumbs name the target; the other one links to it.
    const sub = new PageScreen(page);
    await sub.goto(subId);
    await expect(sub.breadcrumbs).toContainText(target);
    const other = new PageScreen(await page.context().newPage());
    await other.goto(linkingId);
    const mention = other.content.getByText(literally(target));
    const link = other.content.getByRole('link', { name: linkText });

    await test.step('the other page mentions the target, and links to it from a line of text', async () => {
      await other.content.click();
      await other.page.keyboard.type(`@${target.slice(-6)}`);
      await other.page.getByRole('option', { name: literally(target) }).click();
      await other.page.keyboard.press('Enter');
      await other.page.keyboard.type(linkText);
      await other.page.keyboard.press('Shift+Home');
      await other.page.keyboard.press('ControlOrMeta+K');
      await other.page.keyboard.type(target.slice(-6));
      await other.page.getByRole('option', { name: literally(target) }).click();
      await expect(mention).toBeVisible();
      await expect(link).toHaveAttribute('href', new RegExp(`/p/${targetId}`));
    });

    await test.step('renaming it in the sidebar updates the breadcrumbs, the tree and the mention', async () => {
      await new Sidebar(page).rename(target, renamed);
      await expect(sub.breadcrumbs).toContainText(renamed);
      await expect(new Sidebar(other.page).entry(renamed)).toBeVisible();
      await expect(other.content.getByText(literally(renamed))).toBeVisible();
      await expect(mention).toHaveCount(0);
    });

    await test.step('in Trash, the mention and the link are struck through; restored, they are not', async () => {
      const api = await apiFor(page);
      const renamedMention = other.content.getByText(literally(renamed));
      await api.delete(`/api/pages/${targetId}`);
      await expect.poll(() => struckThrough(renamedMention)).toBe(true);
      await expect.poll(() => struckThrough(link)).toBe(true);
      await api.post(`/api/trash/${targetId}/restore`);
      await expect.poll(() => struckThrough(renamedMention)).toBe(false);
      await expect.poll(() => struckThrough(link)).toBe(false);
    });
  });
});
