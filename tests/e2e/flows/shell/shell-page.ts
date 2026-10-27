import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** An address that no screen uses, so the shell shows its Not found screen. */
export const missingPath = '/fictional-qa-no-such-screen';

/** Opens an address nothing matches and waits for the Not found screen inside the shell. */
export async function openMissingScreen(page: Page): Promise<void> {
  await page.goto(missingPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
}

/** The sidebar's navigation (fixed on a computer, inside the menu on a phone). */
export function sidebar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Sidebar' });
}

/** The top bar's menu button, shown on phones. */
export function menuButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: 'Open menu' });
}

/** The phone menu, open. */
export function phoneMenu(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Menu' });
}

/** Keyboard focus is on the screen itself: its <main>, an element around it, or inside it. */
export async function expectFocusOnScreen(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const main = document.querySelector('main');
          const focused = document.activeElement;
          if (!main || !focused || focused === document.body) return false;
          return focused === main || focused.contains(main) || main.contains(focused);
        }),
      { message: 'keyboard focus should be on the screen' },
    )
    .toBe(true);
}

/** The element covers the whole screen. */
export async function expectFullScreen(page: Page, element: Locator): Promise<void> {
  await expect(element).toBeVisible();
  const screen = page.viewportSize();
  if (!screen) throw new Error('This check needs a fixed viewport size.');
  await expect
    .poll(
      async () => {
        const box = await element.boundingBox();
        if (!box) return 'not on screen';
        const covers =
          box.x <= 1 &&
          box.y <= 1 &&
          box.x + box.width >= screen.width - 1 &&
          box.y + box.height >= screen.height - 1;
        if (covers) return 'full screen';
        const [x, y, w, h] = [box.x, box.y, box.width, box.height].map(Math.round);
        return `at x ${x}, y ${y}, ${w} x ${h} px on a ${screen.width} x ${screen.height} screen`;
      },
      { message: 'it should cover the whole screen' },
    )
    .toBe('full screen');
}
