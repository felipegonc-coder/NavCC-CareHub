import type { Locator, Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally, pageIdOf } from '../pages/page-screen.js';
import { Sidebar } from './sidebar-page.js';

// Sidebar, spaces and nested pages, section 6 (Phone): the sidebar as a full screen from the menu
// button, the bottom bar, and an entry's long-press menu, whose Move to needs no dragging.

/** Holds a finger on an element for 0.8 seconds: a long-press, through Chromium's touch input. */
async function longPress(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Can't long-press: the element isn't shown");
  const point = { x: box.x + Math.min(box.width / 2, 40), y: box.y + Math.min(box.height / 2, 16) };
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(800);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
}

/** Buttons and links with this name. */
const named = (root: Page | Locator, name: RegExp) =>
  root.getByRole('button', { name }).or(root.getByRole('link', { name }));

test.describe('Sidebar on a phone', () => {
  onlyIn('phone-light');
  // The bottom bar's Search opens the search window (Search, section 2).
  needs('signIn', 'appShell', 'pages', 'search');

  test('SB-13 on a phone the sidebar is a full screen, the bottom bar works, and Move to works without dragging', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Avery, an Admin, has Full access in the team space, which moving needs (section 5).
    await signInAs(page, 'admin');
    const api = await apiFor(page);
    const shelf = uniqueName('Fictional QA phone shelf');
    const note = uniqueName('Fictional QA phone note');
    const shelfId = await makePage(page, shelf);
    const noteId = await makePage(page, note);
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
    const items = {
      home: /^Home$/,
      search: /^Search\b/,
      messages: /^Messages\b/,
      add: /^New page\b/,
    };
    let bar = page.getByRole('navigation').or(page.getByRole('toolbar'));
    for (const name of Object.values(items)) bar = bar.filter({ has: named(page, name) });
    const tap = (name: RegExp) => named(bar, name).first().click();
    await screen.goto(noteId);

    await test.step('the bottom bar has Home, Search, Messages and New page, at the foot of the screen', async () => {
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox();
      expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(height - 2);
    });

    await test.step('Messages, Home and Search on it open what they say', async () => {
      await tap(items.messages);
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/messages\b/);
      await tap(items.home);
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/(home)?$/);
      await tap(items.search);
      const searchWindow = page.getByRole('dialog', { name: /search/i });
      await expect
        .poll(async () => (await searchWindow.isVisible()) || /\/search\b/.test(page.url()))
        .toBe(true);
    });

    await test.step('New page on it opens a new page with the cursor in the title', async () => {
      await screen.goto(noteId);
      await tap(items.add);
      await expect(screen.title).toBeFocused();
      await expect(page).toHaveURL(/\/p\/[^/?#]+/);
      // Not needed after this: to Trash.
      await api.send('DELETE', `/api/pages/${pageIdOf(page)}`);
    });

    await test.step('the menu button opens the sidebar as a full screen', async () => {
      await screen.goto(noteId);
      await page
        .getByRole('banner')
        .getByRole('button', { name: /^(open )?(menu|sidebar)$/i })
        .click();
      await expect(sidebar.entry(note)).toBeVisible();
      const sheet = page.getByRole('dialog').filter({ has: sidebar.nav });
      // Once it has slid in.
      await expect.poll(async () => Math.round((await sheet.boundingBox())?.x ?? -1)).toBe(0);
      const box = await sheet.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(width - 1);
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(height - 1);
    });

    await test.step('a long-press on an entry opens its menu, and Move to puts the page inside another', async () => {
      await longPress(page, sidebar.entry(note));
      await page
        .getByRole('menuitem', { name: 'Move to', exact: true })
        .or(page.getByRole('button', { name: 'Move to', exact: true }))
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: /move/i });
      await dialog
        .getByRole('searchbox')
        .or(dialog.getByRole('textbox'))
        .first()
        .fill(shelf.slice(-6));
      await dialog
        .getByRole('option', { name: literally(shelf) })
        .or(dialog.getByRole('button', { name: literally(shelf) }))
        .first()
        .click();
      type About = { parentId?: string | null; page?: { parentId?: string | null } };
      await expect
        .poll(async () => {
          const about = await api.get<About>(`/api/pages/${noteId}`);
          return about.page?.parentId ?? about.parentId;
        })
        .toBe(shelfId);
    });
  });
});
