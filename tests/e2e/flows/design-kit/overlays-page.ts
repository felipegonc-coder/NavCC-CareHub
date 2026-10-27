import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** Opens the design kit gallery and brings its "Menus and dialogs" section into view. */
export async function openOverlays(page: Page): Promise<void> {
  await page.goto('/design');
  const heading = page.getByRole('heading', { level: 2, name: 'Menus and dialogs' });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeVisible();
}

/** Waits until keyboard focus is on the element or inside it. */
export async function expectFocusWithin(target: Locator): Promise<void> {
  await expect
    .poll(() => target.evaluate((element) => element.contains(document.activeElement)), {
      message: 'keyboard focus should be inside',
    })
    .toBe(true);
}

/** A short name for the element that has keyboard focus, for test reports. */
export function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'the page';
    return element.getAttribute('aria-label') ?? (element.textContent?.trim() || element.tagName);
  });
}

/** Presses a key again and again, checking that focus never leaves `scope`. Returns each stop. */
export async function walkFocus(
  page: Page,
  scope: Locator,
  key: 'Tab' | 'Shift+Tab',
  presses: number,
): Promise<string[]> {
  const stops: string[] = [];
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press(key);
    await expectFocusWithin(scope);
    stops.push(await focusedName(page));
  }
  return stops;
}

/** Presses Tab until `target` has keyboard focus, at most `max` times. */
export async function tabTo(page: Page, target: Locator, max = 6): Promise<void> {
  for (let press = 0; press < max; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

type Politeness = 'polite' | 'assertive';
type HeardWindow = Window & { qaHeard?: { politeness: Politeness; text: string }[] };

/**
 * Starts noting what screen readers would announce: text that appears in a live region
 * (aria-live, or the status and alert roles), with how politely it is announced.
 */
export async function listenForAnnouncements(page: Page): Promise<void> {
  await page.evaluate(() => {
    const heard: { politeness: Politeness; text: string }[] = [];
    (window as HeardWindow).qaHeard = heard;
    const liveRegion = (node: Node): Element | null => {
      const element = node instanceof Element ? node : node.parentElement;
      return element?.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') ?? null;
    };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of [mutation.target, ...Array.from(mutation.addedNodes)]) {
          const region = liveRegion(node);
          const live = region?.getAttribute('aria-live');
          if (!region || live === 'off') continue;
          const assertive =
            live === 'assertive' || (!live && region.getAttribute('role') === 'alert');
          heard.push({
            politeness: assertive ? 'assertive' : 'polite',
            text: region.textContent?.trim() ?? '',
          });
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

/** How politely `text` has been announced since listenForAnnouncements(), e.g. ['polite']. */
export function announced(page: Page, text: string): Promise<Politeness[]> {
  return page.evaluate(
    (wanted) =>
      ((window as HeardWindow).qaHeard ?? [])
        .filter((entry) => entry.text.includes(wanted))
        .map((entry) => entry.politeness),
    text,
  );
}

/**
 * Lists the controls inside `scope` that are smaller than 44 x 44 px to tap. A checkbox, radio or
 * switch counts together with its label, because tapping the label works too. Controls that are
 * hidden from everyone (aria-hidden, not on screen) are left out.
 */
export function smallTouchTargets(scope: Locator, minimum = 44): Promise<string[]> {
  return scope.evaluate((root, min) => {
    const controls = root.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], ' +
        '[role="checkbox"], [role="combobox"], [role="menuitem"], [role="menuitemcheckbox"], ' +
        '[role="menuitemradio"], [role="option"], [role="radio"], [role="switch"], [role="tab"]',
    );
    const small: string[] = [];
    for (const control of controls) {
      if (control.closest('[aria-hidden="true"]')) continue;
      const boxes = [control.getBoundingClientRect()];
      const toggle = control.matches(
        'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]',
      );
      const labels = toggle && 'labels' in control ? (control as HTMLInputElement).labels : null;
      for (const label of labels ?? []) boxes.push(label.getBoundingClientRect());
      const shown = boxes.filter((box) => box.width > 1 && box.height > 1);
      if (shown.length === 0) continue;
      const width =
        Math.max(...shown.map((box) => box.right)) - Math.min(...shown.map((box) => box.left));
      const height =
        Math.max(...shown.map((box) => box.bottom)) - Math.min(...shown.map((box) => box.top));
      if (width >= min - 0.5 && height >= min - 0.5) continue;
      const name =
        control.getAttribute('aria-label') ??
        (labels?.[0]?.textContent?.trim() || control.textContent?.trim() || control.tagName);
      small.push(`${name}: ${Math.round(width)} x ${Math.round(height)} px`);
    }
    return small;
  }, minimum);
}

/** The pop-up sits along the bottom edge of the screen and is about as wide as the screen. */
export async function expectBottomSheet(page: Page, popUp: Locator): Promise<void> {
  await expect(popUp).toBeVisible();
  const screen = page.viewportSize();
  if (!screen) throw new Error('This check needs a fixed viewport size.');
  await expect
    .poll(
      async () => {
        const box = await popUp.boundingBox();
        if (!box) return 'not on screen';
        const onBottom = box.y + box.height >= screen.height - 1;
        const fullWidth = box.width >= screen.width * 0.9;
        if (onBottom && fullWidth) return 'bottom sheet';
        const [x, y, w, h] = [box.x, box.y, box.width, box.height].map(Math.round);
        return `at x ${x}, y ${y}, ${w} x ${h} px on a ${screen.width} x ${screen.height} screen`;
      },
      { message: 'the pop-up should sit along the bottom edge, about as wide as the screen' },
    )
    .toBe('bottom sheet');
}
