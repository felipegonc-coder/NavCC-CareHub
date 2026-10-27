import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import {
  expectFocusOnScreen,
  expectFullScreen,
  menuButton,
  openMissingScreen,
  phoneMenu,
  sidebar,
} from './shell-page.js';

// The signed-in frame around every screen (#34): skip link, sidebar, top bar, phone menu and the
// Not found screen. No spec has check IDs for the frame itself, so these use provisional SH
// numbers (SH-21 and up are already used by other flows). The page tree belongs to the Sidebar
// flows (SB checks).

test.describe('App shell on a computer', () => {
  onlyIn('desktop-light');
  needs('appShell', 'signIn');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'editor');
  });

  test('SH-01 the skip link is the first Tab stop and jumps past the sidebar', async ({ page }) => {
    await openMissingScreen(page);
    const skip = page.getByRole('link', { name: 'Skip to main content' });

    await test.step('the first Tab shows the skip link', async () => {
      await page.keyboard.press('Tab');
      await expect(skip).toBeFocused();
      const box = await skip.boundingBox();
      expect(box?.width ?? 0, 'the focused skip link should be on screen').toBeGreaterThan(20);
    });

    await test.step('Enter moves focus to the screen, so the next Tab is inside it', async () => {
      await page.keyboard.press('Enter');
      await expectFocusOnScreen(page);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('main').getByRole('link', { name: 'Go to Home' })).toBeFocused();
    });
  });

  test('SH-02 the sidebar stays on the left, with Settings and the theme switch', async ({
    page,
  }) => {
    await openMissingScreen(page);

    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByText('Care Hub', { exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);

    const box = await sidebar(page).boundingBox();
    expect(box?.x ?? Infinity, 'the sidebar should start at the left edge').toBeLessThan(20);
  });

  test('SH-05 Not found says what happened and offers a way back to Home', async ({ page }) => {
    await openMissingScreen(page);

    await test.step('the screen explains the link is wrong', async () => {
      await expect(page.getByRole('main')).toContainText('This was deleted, or the link is wrong.');
      await expect(page).toHaveTitle('Care Hub · Not found');
    });

    await test.step('Go to Home goes to Home', async () => {
      await page.getByRole('link', { name: 'Go to Home' }).click();
      await expect(page).toHaveURL((url) => url.pathname === '/');
      await expect(page.getByText('This was deleted, or the link is wrong.')).toBeHidden();
    });
  });
});

test.describe('App shell sidebar items', () => {
  onlyIn('desktop-light');
  needs('appShell', 'signIn', 'home', 'messages', 'calendar');

  test('SH-07 Home, Messages and Calendar are in the sidebar, and the open one is marked', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    await page.goto('/');
    const link = (name: RegExp) => sidebar(page).getByRole('link', { name });
    const home = link(/^Home$/);
    const messages = link(/^Messages/);
    const calendar = link(/^Calendar$/);

    await test.step('they come in the order of the spec', async () => {
      const names = await sidebar(page).getByRole('link').allTextContents();
      const at = (word: string) => names.findIndex((name) => name.trim().startsWith(word));
      expect(at('Home'), names.join(', ')).toBeGreaterThanOrEqual(0);
      expect(at('Messages'), names.join(', ')).toBeGreaterThan(at('Home'));
      expect(at('Calendar'), names.join(', ')).toBeGreaterThan(at('Messages'));
    });

    await test.step('on Home, Home is marked as the current page', async () => {
      await expect(home).toHaveAttribute('aria-current', 'page');
      await expect(messages).not.toHaveAttribute('aria-current', 'page');
    });

    await test.step('opening Calendar moves the mark', async () => {
      await calendar.click();
      await expect(page).toHaveURL(/\/calendar/);
      await expect(calendar).toHaveAttribute('aria-current', 'page');
      await expect(home).not.toHaveAttribute('aria-current', 'page');
    });
  });
});

test.describe('App shell on a phone', () => {
  onlyIn('phone-light');
  needs('appShell', 'signIn');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'editor');
  });

  test('SH-03 the menu button opens the sidebar, and Esc, Close and links close it', async ({
    page,
  }) => {
    await openMissingScreen(page);

    await test.step('the sidebar waits behind the menu button in the top bar', async () => {
      await expect(sidebar(page)).toBeHidden();
      await expect(menuButton(page)).toBeVisible();
    });

    await test.step('the menu button opens the sidebar, with focus inside', async () => {
      await menuButton(page).click();
      await expect(phoneMenu(page)).toBeVisible();
      await expect(phoneMenu(page).getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
      await expect
        .poll(() => phoneMenu(page).evaluate((menu) => menu.contains(document.activeElement)))
        .toBe(true);
    });

    await test.step('Esc closes it and focus goes back to the menu button', async () => {
      await page.keyboard.press('Escape');
      await expect(phoneMenu(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();
    });

    await test.step('Close menu closes it too', async () => {
      await menuButton(page).click();
      await phoneMenu(page).getByRole('button', { name: 'Close menu' }).click();
      await expect(phoneMenu(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();
    });

    await test.step('following a link closes it and opens that screen', async () => {
      await menuButton(page).click();
      await phoneMenu(page).getByRole('link', { name: 'Settings' }).click();
      await expect(page).toHaveURL(/\/settings/);
      await expect(phoneMenu(page)).toBeHidden();
    });
  });

  test('SH-04 on a phone the sidebar opens full screen', async ({ page }) => {
    // Without motion, the menu has its final place straight away.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMissingScreen(page);
    await menuButton(page).click();
    await expectFullScreen(page, phoneMenu(page));
  });

  test('SH-06 widening the window to computer size swaps the menu for the fixed sidebar', async ({
    page,
  }) => {
    await openMissingScreen(page);
    await menuButton(page).click();
    await expect(phoneMenu(page)).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(phoneMenu(page)).toBeHidden();
    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
  });
});
