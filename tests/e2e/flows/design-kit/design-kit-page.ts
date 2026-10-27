import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** Page background and body text in each theme (Look and feel: #FFFFFF / #0A0A0A, #0A0A0A / #FAFAFA). */
export const themeColours = {
  light: { background: 'rgb(255, 255, 255)', text: 'rgb(10, 10, 10)' },
  dark: { background: 'rgb(10, 10, 10)', text: 'rgb(250, 250, 250)' },
} as const;

export type ThemeColours = (typeof themeColours)[keyof typeof themeColours];

/** Opens the design kit gallery and waits for its heading. */
export async function openDesignKit(page: Page): Promise<void> {
  await page.goto('/design');
  await expect(page.getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
}

/** One option of the theme switch: "Light", "Dark", or the one that follows the device. */
export function themeOption(page: Page, name: string | RegExp): Locator {
  return page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name });
}

/** Picks a theme the way a mouse user does: by clicking its visible label. */
export async function chooseTheme(page: Page, label: string): Promise<void> {
  await page.getByRole('radiogroup', { name: 'Theme' }).getByText(label, { exact: true }).click();
}

/** The page background and text show the given theme. */
export async function expectThemeColours(page: Page, expected: ThemeColours): Promise<void> {
  const body = page.locator('body');
  await expect(body).toHaveCSS('background-color', expected.background);
  await expect(body).toHaveCSS('color', expected.text);
}

/** How many animations (spinners, skeletons, transitions) are moving on the page right now. */
export function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length,
  );
}

export interface FocusedControl {
  /** A short description for the test report, for example `button "Primary"`. */
  name: string;
  /** Whether the person can see where the focus is: an outline of at least 2 px, or a ring. */
  indicated: boolean;
}

/**
 * Describes the element that has keyboard focus, or null when focus is back on the page itself.
 * A visually hidden input (such as a theme radio) shows its focus on its label, so that is checked.
 */
export function focusedControl(page: Page): Promise<FocusedControl | null> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body || element === document.documentElement) return null;
    const labels = 'labels' in element ? (element as HTMLInputElement).labels : null;
    const box = element.getBoundingClientRect();
    const tiny = box.width <= 2 || box.height <= 2;
    const shown = tiny && labels?.[0] ? labels[0] : element;
    const style = getComputedStyle(shown);
    const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    const ringed = style.boxShadow !== 'none';
    const label =
      element.getAttribute('aria-label') ?? labels?.[0]?.textContent ?? element.textContent ?? '';
    const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
    return { name: `${role} "${label.trim()}"`, indicated: outlined || ringed };
  });
}

type WatchedWindow = Window & { qaLastClick?: { button: string; cancelled: boolean } };

/** Starts noting the last click on the page and whether something cancelled it. */
export async function watchClicks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      (window as WatchedWindow).qaLastClick = {
        button: button?.textContent?.trim() ?? '',
        cancelled: event.defaultPrevented,
      };
    });
  });
}

/** The last click noted by watchClicks(), once the event has reached the window. */
export function lastClick(page: Page): Promise<{ button: string; cancelled: boolean } | null> {
  return page.evaluate(() => (window as WatchedWindow).qaLastClick ?? null);
}

/** Waits until keyboard focus has moved inside the element, for example a list that just opened. */
export async function expectFocusInside(target: Locator): Promise<void> {
  await expect
    .poll(() => target.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
}
