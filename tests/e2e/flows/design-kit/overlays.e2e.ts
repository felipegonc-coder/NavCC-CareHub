import { expect, needs, onlyIn, test } from '../_support/index.js';
import {
  announced,
  expectBottomSheet,
  expectFocusWithin,
  listenForAnnouncements,
  openOverlays,
  smallTouchTargets,
  tabTo,
  walkFocus,
} from './overlays-page.js';

// Menus, dialogs, popovers, tooltips and toasts in the design kit gallery at /design (#27),
// checked against the rules for every spec (Keyboard, Screen readers, Phone). Look and feel has
// no check IDs yet, so these continue the provisional DK numbers.

test.describe('Design kit: menus', () => {
  onlyIn('desktop-light');
  needs('overlays');

  test('DK-14 the Page actions menu works with the keyboard', async ({ page }) => {
    await openOverlays(page);
    // While the menu is open, Radix hides the page behind it from screen readers (#255).
    const opener = page.getByRole('button', { name: 'Page actions', includeHidden: true });
    const menu = page.getByRole('menu', { name: 'Page actions' });
    const item = (name: string) => menu.getByRole('menuitem', { name });

    await test.step('Enter opens the menu on its first item', async () => {
      await expect(opener).toHaveAttribute('aria-haspopup', 'menu');
      await opener.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await expect(opener).toHaveAttribute('aria-expanded', 'true');
      await expect(item('Rename')).toBeFocused();
    });

    await test.step('the arrow keys move between the items', async () => {
      await page.keyboard.press('ArrowDown');
      await expect(item('Duplicate')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(item('Move to Trash')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(item('Duplicate')).toBeFocused();
    });

    await test.step('typing a letter jumps to the item that starts with it', async () => {
      await page.keyboard.press('r');
      await expect(item('Rename')).toBeFocused();
    });

    await test.step('Enter picks the item, closes the menu and gives focus back', async () => {
      await page.keyboard.press('Enter');
      await expect(menu).toBeHidden();
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test('DK-15 Esc closes the menu, and so does clicking an item', async ({ page }) => {
    await openOverlays(page);
    const opener = page.getByRole('button', { name: 'Page actions' });
    const menu = page.getByRole('menu', { name: 'Page actions' });

    await test.step('Esc closes the menu and gives focus back', async () => {
      await opener.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(opener).toBeFocused();
    });

    await test.step('clicking an item closes the menu and gives focus back', async () => {
      await opener.click();
      await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
      await expect(menu).toBeHidden();
      await expect(opener).toBeFocused();
    });
  });
});

test.describe('Design kit: dialogs, popovers and tooltips', () => {
  onlyIn('desktop-light');
  needs('overlays');

  test('DK-16 the dialog keeps focus inside and hides the page behind it', async ({ page }) => {
    await openOverlays(page);
    const dialog = page.getByRole('dialog', { name: 'Share page' });

    await test.step('the dialog is named by its title and described by its text', async () => {
      await page.getByRole('button', { name: 'Open dialog' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(
        'People in your workspace can open the link.',
      );
    });

    await test.step('focus moves into the dialog', async () => {
      await expectFocusWithin(dialog);
    });

    await test.step('screen readers no longer reach the page behind it', async () => {
      await expect(page.getByRole('button', { name: 'Show toast' })).toHaveCount(0);
    });

    await test.step('Tab and Shift+Tab go round and round inside the dialog', async () => {
      for (const key of ['Tab', 'Shift+Tab'] as const) {
        const stops = await walkFocus(page, dialog, key, 8);
        const different = new Set(stops).size;
        expect(different, `${key} stops: ${stops.join(', ')}`).toBeGreaterThan(1);
        expect(different, `${key} stops: ${stops.join(', ')}`).toBeLessThan(stops.length);
      }
    });
  });

  test('DK-17 Esc, Cancel and Close shut the dialog, and focus goes back to its button', async ({
    page,
  }) => {
    await openOverlays(page);
    const opener = page.getByRole('button', { name: 'Open dialog' });
    const dialog = page.getByRole('dialog', { name: 'Share page' });

    await test.step('Enter opens it and Esc closes it', async () => {
      await opener.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    });

    for (const button of ['Cancel', 'Close']) {
      await test.step(`${button} closes it`, async () => {
        await opener.click();
        await dialog.getByRole('button', { name: button, exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
      });
    }
  });

  test('DK-18 the popover opens from its button, and Esc closes it and gives focus back', async ({
    page,
  }) => {
    await openOverlays(page);
    const opener = page.getByRole('button', { name: 'Open popover' });
    const popover = page.getByText('Last edited by Alex Morgan today.');

    await test.step('clicking the button opens it', async () => {
      await opener.click();
      await expect(popover).toBeVisible();
      await expect(opener).toHaveAttribute('aria-expanded', 'true');
    });

    await test.step('Esc closes it and focus goes back to the button', async () => {
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('Enter opens it again from the keyboard', async () => {
      await page.keyboard.press('Enter');
      await expect(popover).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      await expect(opener).toBeFocused();
    });
  });

  test('DK-19 a tooltip shows on hover and on keyboard focus, and is only a hint', async ({
    page,
  }) => {
    await openOverlays(page);
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    const tooltip = page.getByRole('tooltip');

    await test.step('pointing at the Settings button shows its tooltip', async () => {
      await settings.hover();
      await expect(tooltip).toHaveText('Settings');
      await expect(settings).toHaveAccessibleDescription('Settings');
    });

    await test.step('moving the pointer away hides it', async () => {
      await page.mouse.move(0, 0, { steps: 5 });
      await expect(tooltip).toBeHidden();
    });

    await test.step('reaching the button with Tab shows it; Esc hides it and keeps focus', async () => {
      await page.getByRole('button', { name: 'New page' }).focus();
      await tabTo(page, settings);
      await expect(tooltip).toHaveText('Settings');
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      await expect(settings).toBeFocused();
    });

    await test.step('the button keeps its name while the tooltip is hidden', async () => {
      await expect(settings).toHaveAccessibleName('Settings');
    });
  });
});

test.describe('Design kit: toasts', () => {
  onlyIn('desktop-light');
  needs('overlays');

  test('DK-20 a toast is announced politely, leaves focus alone and can be dismissed by keyboard', async ({
    page,
  }) => {
    await openOverlays(page);
    await listenForAnnouncements(page);
    const show = page.getByRole('button', { name: 'Show toast' });
    const notifications = page.getByRole('region', { name: /notifications/i });
    const toast = notifications.getByText('Page saved');

    await test.step('the toast appears and focus stays on the button', async () => {
      await show.click();
      await expect(toast).toBeVisible();
      await expect(show).toBeFocused();
    });

    await test.step('screen readers hear it politely', async () => {
      await expect.poll(() => announced(page, 'Page saved')).toContain('polite');
      expect(await announced(page, 'Page saved')).not.toContain('assertive');
    });

    await test.step('F8 moves to the notifications, and Tab reaches Dismiss', async () => {
      await page.keyboard.press('F8');
      await expectFocusWithin(notifications);
      await tabTo(page, notifications.getByRole('button', { name: 'Dismiss notification' }), 4);
      await page.keyboard.press('Enter');
      await expect(toast).toBeHidden();
    });
  });

  test('DK-21 a toast goes away by itself, but not while the pointer rests on it', async ({
    page,
  }) => {
    test.slow(); // waits for real toast timers
    await openOverlays(page);
    const show = page.getByRole('button', { name: 'Show toast' });
    const toast = page.getByRole('region', { name: /notifications/i }).getByText('Page saved');

    await test.step('left alone, it goes away within 10 seconds', async () => {
      await show.click();
      await expect(toast).toBeVisible();
      await expect(toast).toBeHidden({ timeout: 10_000 });
    });

    await test.step('it is still there after 9 seconds under the pointer', async () => {
      await show.click();
      await toast.hover();
      await page.waitForTimeout(9_000);
      await expect(toast).toBeVisible();
    });

    await test.step('once the pointer leaves, it goes away', async () => {
      await page.mouse.move(0, 0, { steps: 5 });
      await expect(toast).toBeHidden({ timeout: 10_000 });
    });
  });
});

test.describe('Design kit: phones', () => {
  onlyIn('phone-light');
  needs('overlays');

  test.beforeEach(async ({ page }) => {
    // Without motion, pop-ups have their final size straight away.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOverlays(page);
  });

  test('DK-22 on a phone every control is at least 44 by 44 px', async ({ page }) => {
    await test.step('the gallery', async () => {
      await expect.poll(() => smallTouchTargets(page.getByRole('main'))).toEqual([]);
    });

    await test.step('the Page actions menu', async () => {
      await page.getByRole('button', { name: 'Page actions' }).click();
      const menu = page.getByRole('menu', { name: 'Page actions' });
      await expect(menu).toBeVisible();
      await expect.poll(() => smallTouchTargets(menu)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    });

    await test.step('the Team list', async () => {
      await page.getByRole('combobox', { name: 'Team' }).click();
      const list = page.getByRole('listbox');
      await expect(list).toBeVisible();
      await expect.poll(() => smallTouchTargets(list)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
    });

    await test.step('the Share page dialog', async () => {
      await page.getByRole('button', { name: 'Open dialog' }).click();
      const dialog = page.getByRole('dialog', { name: 'Share page' });
      await expect(dialog).toBeVisible();
      await expect.poll(() => smallTouchTargets(dialog)).toEqual([]);
    });
  });

  test('DK-23 on a phone, menus, dialogs and popovers open as bottom sheets', async ({ page }) => {
    await test.step('the Page actions menu', async () => {
      await page.getByRole('button', { name: 'Page actions' }).click();
      await expectBottomSheet(page, page.getByRole('menu', { name: 'Page actions' }));
      await page.keyboard.press('Escape');
    });

    await test.step('the Share page dialog', async () => {
      await page.getByRole('button', { name: 'Open dialog' }).click();
      await expectBottomSheet(page, page.getByRole('dialog', { name: 'Share page' }));
      await page.keyboard.press('Escape');
    });

    await test.step('the popover', async () => {
      await page.getByRole('button', { name: 'Open popover' }).click();
      const popover = page.getByRole('dialog').filter({ hasText: 'Last edited by Alex Morgan' });
      await expectBottomSheet(page, popover);
    });
  });
});
