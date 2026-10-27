import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage, spaceIdOf } from '../pages/page-data.js';
import { PageScreen, TEAM_SPACE, literally, openAs } from '../pages/page-screen.js';
import { checkScreen } from '../../support/screen-checks.js';
import { Sidebar } from './sidebar-page.js';

// Sidebar, spaces and nested pages, sections 3.2, 3.4 and 6: the page tree and Favorites.

/** Matches text that holds the titles in this order. */
const inOrder = (...titles: string[]) =>
  new RegExp(titles.map((title) => literally(title).source).join('.*'));

/** Matches text that holds any of the titles. */
const anyOf = (...titles: string[]) =>
  new RegExp(titles.map((title) => literally(title).source).join('|'));

test.describe('Sidebar: the page tree', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages');

  test('SB-12 the tree works fully by keyboard and reads as a tree; axe finds no problems with an entry expanded', async ({
    page,
  }, testInfo) => {
    const parent = uniqueName('Fictional QA parent');
    const first = uniqueName('Fictional QA first sub-page');
    const second = uniqueName('Fictional QA second sub-page');
    const renamed = uniqueName('Fictional QA renamed sub-page');
    // Avery, an Admin, has Full access in the team space, which moving entries needs.
    await signInAs(page, 'admin');
    const parentId = await makePage(page, parent);
    const firstId = await makePage(page, first, { parentId });
    await makePage(page, second, { parentId });
    await new PageScreen(page).goto(parentId);
    const sidebar = new Sidebar(page);
    const keys = page.keyboard;

    await test.step('→ expands an entry and then goes to its first sub-page; ↓ and ↑ move', async () => {
      await sidebar.focus(parent);
      await keys.press('ArrowRight');
      await expect(sidebar.expanded(parent, true)).toBeVisible();
      await keys.press('ArrowRight');
      await expect(sidebar.entry(first)).toBeFocused();
      await keys.press('ArrowDown');
      await expect(sidebar.entry(second)).toBeFocused();
      await keys.press('ArrowUp');
      await expect(sidebar.entry(first)).toBeFocused();
    });

    await test.step('screen readers get a tree: the sub-pages are a group in the expanded entry', async () => {
      await expect(sidebar.entry(parent)).toMatchAriaSnapshot(`
        - treeitem ${inOrder(parent)} [expanded]:
          - group:
            - treeitem ${inOrder(first)}
            - treeitem ${inOrder(second)}
      `);
    });

    await test.step('Ctrl+Shift+↓ and ↑ move the entry among its siblings', async () => {
      await keys.press('ControlOrMeta+Shift+ArrowDown');
      await expect(sidebar.subEntries(parent)).toHaveText([inOrder(second), inOrder(first)]);
      await expect(sidebar.entry(first)).toBeFocused();
      await keys.press('ControlOrMeta+Shift+ArrowUp');
      await expect(sidebar.subEntries(parent)).toHaveText([inOrder(first), inOrder(second)]);
    });

    await test.step('F2 renames the entry in place', async () => {
      await sidebar.rename(first, renamed);
      await expect(sidebar.entry(renamed)).toBeFocused();
    });

    await test.step('Shift+F10 opens the entry menu; Esc closes it and puts focus back', async () => {
      const menu = await sidebar.entryMenu(renamed);
      await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Move to', exact: true })).toBeVisible();
      await keys.press('Escape');
      await expect(menu).toBeHidden();
      await expect(sidebar.entry(renamed)).toBeFocused();
    });

    await test.step('← goes to the parent and then collapses it; Enter opens a page', async () => {
      await keys.press('ArrowLeft');
      await expect(sidebar.entry(parent)).toBeFocused();
      await keys.press('ArrowLeft');
      await expect(sidebar.expanded(parent, false)).toBeVisible();
      await keys.press('ArrowRight');
      await keys.press('ArrowRight');
      await expect(sidebar.entry(renamed)).toBeFocused();
      await keys.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/p/${firstId}$`));
      await new PageScreen(page).expectTitle(renamed);
    });

    await test.step('axe finds no problems with the entry expanded', async () => {
      // A state tests/e2e/screens.ts can't reach, so it's checked here (desktop-light only).
      await checkScreen(
        page,
        {
          name: 'sb-12-tree-expanded',
          path: `/p/${parentId}`,
          setup: async (opened) => {
            const tree = new Sidebar(opened);
            await tree.expand(parent);
            await expect(tree.entry(renamed)).toBeVisible();
          },
        },
        testInfo,
      );
    });
  });

  test('SB-03 dragging a page above, below and onto a page, onto a space, onto Favorites and onto Trash', async ({
    page,
  }) => {
    const shelf = uniqueName('Fictional QA drag shelf');
    const parent = uniqueName('Fictional QA parent');
    const target = uniqueName('Fictional QA target');
    const starred = uniqueName('Fictional QA starred');
    const one = uniqueName('Fictional QA one');
    const two = uniqueName('Fictional QA two');
    const three = uniqueName('Fictional QA three');
    await signInAs(page, 'admin');
    // Everything starts inside one page of this test's own, so the team space's top level only
    // changes when "one" is dropped onto the space.
    const shelfId = await makePage(page, shelf);
    const parentId = await makePage(page, parent, { parentId: shelfId });
    const ids = new Map<string, string>();
    for (const sub of [one, two, three]) ids.set(sub, await makePage(page, sub, { parentId }));
    await makePage(page, target, { parentId: shelfId });
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    const space = sidebar.section(TEAM_SPACE);
    const favorites = sidebar.section('Favorites');
    // A starred page keeps the Favorites section on screen to drop onto.
    await screen.goto(await makePage(page, starred, { parentId: shelfId }));
    await screen.favorite.click();
    await expect(sidebar.entry(starred, favorites)).toBeVisible();
    await screen.goto(parentId);
    await sidebar.expand(shelf);
    await sidebar.expand(parent);

    await test.step('above and below a sibling: the tree and the parent page show the new order', async () => {
      await sidebar.drag(three, sidebar.entry(one), 'above');
      await expect(sidebar.subEntries(parent)).toHaveText(
        [three, one, two].map((title) => inOrder(title)),
      );
      await expect(screen.content).toHaveText(inOrder(three, one, two));
      await sidebar.drag(one, sidebar.entry(two), 'below');
      await expect(sidebar.subEntries(parent)).toHaveText(
        [three, two, one].map((title) => inOrder(title)),
      );
      await expect(screen.content).toHaveText(inOrder(three, two, one));
    });

    await test.step('onto a page: it becomes that page’s last sub-page', async () => {
      await sidebar.drag(two, sidebar.entry(target));
      await sidebar.expand(target);
      await expect(sidebar.subEntries(target)).toHaveText([inOrder(two)]);
      await expect(sidebar.subEntries(parent)).toHaveText([inOrder(three), inOrder(one)]);
    });

    await test.step('onto the space name: it moves to the top level of the space', async () => {
      await sidebar.drag(one, space.getByRole('heading', { name: TEAM_SPACE }));
      await expect(sidebar.subEntries(parent)).toHaveText([inOrder(three)]);
      // At the top level it sits at the same tree level as the shelf (aria-level), wherever.
      const topLevel = await sidebar.entry(shelf, space).getAttribute('aria-level');
      expect(topLevel).not.toBeNull();
      await expect(sidebar.entry(one, space)).toHaveAttribute('aria-level', topLevel ?? '');
      // Then back into the shelf (POST /api/pages/:id/move), so the top level is as it was.
      await (await apiFor(page)).post(`/api/pages/${ids.get(one)}/move`, { parentId: shelfId });
    });

    await test.step('onto Favorites: it is starred and stays where it was', async () => {
      await sidebar.drag(three, favorites.getByRole('heading', { name: 'Favorites' }));
      await expect(sidebar.entry(three, favorites)).toBeVisible();
      await expect(sidebar.subEntries(parent, space)).toHaveText([inOrder(three)]);
    });

    await test.step('onto Trash: it leaves the tree, with its sub-page', async () => {
      await sidebar.drag(target, sidebar.trash);
      await expect(sidebar.entry(target)).toHaveCount(0);
      await expect(sidebar.entry(two)).toHaveCount(0);
    });
  });

  test('SB-04 moving a page into a space with different access asks first', async ({ page }) => {
    const title = uniqueName('Fictional QA page');
    await signInAs(page, 'admin');
    await new PageScreen(page).goto(await makePage(page, title));
    const sidebar = new Sidebar(page);
    const privateSection = sidebar.section('Private');
    const heading = privateSection.getByRole('heading', { name: 'Private' });
    // The same confirm as Move to (Pages and blocks, PB-24): "Moving <page> to Private changes who
    // can open it: 4 people lose access; …".
    const confirm = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog'))
      .filter({ hasText: 'changes who can open it' });

    await test.step('dropping it on Private asks first; Cancel leaves it in the team space', async () => {
      await sidebar.drag(title, heading);
      await expect(confirm).toContainText(
        new RegExp(
          `Moving ${literally(title).source} to Private changes who can open it: \\d+ (person loses|people lose) access`,
        ),
      );
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(sidebar.entry(title, sidebar.section(TEAM_SPACE))).toBeVisible();
    });

    await test.step('confirming moves it under Private', async () => {
      await sidebar.drag(title, heading);
      await confirm.getByRole('button', { name: /^move/i }).click();
      await expect(sidebar.entry(title, privateSection)).toBeVisible();
      await expect(sidebar.entry(title, sidebar.section(TEAM_SPACE))).toHaveCount(0);
    });
  });

  test('SB-05 a rename or a new sub-page made by one person shows in another person’s tree within 2 seconds', async ({
    page,
    browser,
  }) => {
    const title = uniqueName('Fictional QA page');
    const renamed = uniqueName('Fictional QA renamed page');
    const firstSub = uniqueName('Fictional QA sub-page');
    const newSub = uniqueName('Fictional QA new sub-page');
    await signInAs(page, 'editor');
    const id = await makePage(page, title);
    await makePage(page, firstSub, { parentId: id });
    await new PageScreen(page).goto(id);
    const eli = new Sidebar(page);
    const casey = await openAs(browser, 'commenter');

    try {
      const theirs = new Sidebar(casey.page);
      await new PageScreen(casey.page).goto(id);
      await theirs.expand(title);
      await expect(theirs.subEntries(title)).toHaveText([inOrder(firstSub)]);

      await test.step('Eli renames the page: Casey’s tree shows the new title within 2 seconds', async () => {
        await eli.rename(title, renamed);
        await expect(theirs.entry(renamed)).toBeVisible({ timeout: 2_000 });
      });

      await test.step('Eli adds a sub-page: it shows in Casey’s tree within 2 seconds', async () => {
        await eli.addSubPage(renamed, newSub);
        await expect(theirs.entry(newSub, theirs.entry(renamed))).toBeVisible({ timeout: 2_000 });
      });
    } finally {
      await casey.close();
    }
  });
});

test.describe('Sidebar: Favorites', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages');

  test('SB-11 favorites can be starred, reordered and removed, and one the person loses access to disappears', async ({
    page,
    browser,
  }) => {
    const [kept, moved] = [
      uniqueName('Fictional QA favorite'),
      uniqueName('Fictional QA favorite'),
    ];
    await signInAs(page, 'editor');
    const keptId = await makePage(page, kept);
    const movedId = await makePage(page, moved);
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    const favorites = sidebar.section('Favorites');
    const ours = favorites.getByRole('treeitem').filter({ hasText: anyOf(kept, moved) });

    await test.step('☆ in the top bar and Add to Favorites in the entry menu star pages', async () => {
      await screen.goto(movedId);
      await screen.favorite.click();
      await expect(sidebar.entry(moved, favorites)).toBeVisible();
      const menu = await sidebar.entryMenu(kept);
      await menu.getByRole('menuitem', { name: 'Add to Favorites' }).click();
      await expect(sidebar.entry(kept, favorites)).toBeVisible();
    });

    await test.step('dragging reorders them, and the order stays after a reload', async () => {
      const before = await ours.allInnerTexts();
      const [top, bottom] = before[0]?.includes(kept) ? [kept, moved] : [moved, kept];
      await sidebar.drag(bottom, sidebar.entry(top, favorites), 'above', favorites);
      await expect(ours).toHaveText([inOrder(bottom), inOrder(top)]);
      await page.reload();
      await expect(ours).toHaveText([inOrder(bottom), inOrder(top)]);
    });

    await test.step('when Eli loses access, the favorite disappears; it comes back with access', async () => {
      await screen.goto(keptId);
      const avery = await openAs(browser, 'admin');
      try {
        const api = await apiFor(avery.page);
        const privateId = await spaceIdOf(avery.page, 'Private');
        await api.post(`/api/pages/${movedId}/move`, { spaceId: privateId });
        await page.reload();
        await expect(sidebar.entry(moved, favorites)).toHaveCount(0);
        await api.post(`/api/pages/${movedId}/move`, { spaceId: await spaceIdOf(avery.page) });
        await page.reload();
        await expect(sidebar.entry(moved, favorites)).toBeVisible();
      } finally {
        await avery.close();
      }
    });

    await test.step('Remove from Favorites in the entry menu takes a page off the list', async () => {
      for (const title of [kept, moved]) {
        const menu = await sidebar.entryMenu(title, favorites);
        await menu.getByRole('menuitem', { name: 'Remove from Favorites' }).click();
        await expect(sidebar.entry(title, favorites)).toHaveCount(0);
      }
    });
  });
});
