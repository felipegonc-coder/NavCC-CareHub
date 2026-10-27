import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { Screen } from '../screens.js';

/** Full-page screenshots, named <screen>-<project>.png; CI posts them on the pull request. */
export const screenshotDir = fileURLToPath(new URL('../screenshots/', import.meta.url));

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Opens a screen, saves its screenshot and checks it: it loads without errors, has exactly one
 * <main>, a title starting with "Care Hub" and no axe violations of WCAG 2.1 A and AA. The checks
 * are soft, so one run reports every problem of the screen.
 */
export async function checkScreen(page: Page, screen: Screen, testInfo: TestInfo): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(screen.path);
  await screen.setup?.(page);
  // An app shell may render <main> a moment after the load event.
  await page
    .locator('main')
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // First the screenshot, so it exists even when a check fails.
  await page.screenshot({
    path: path.join(screenshotDir, `${screen.name}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: 'disabled',
  });

  expect.soft(response?.ok(), 'the page loads').toBe(true);
  expect.soft(errors, 'no uncaught errors in the page').toEqual([]);
  expect.soft(await page.locator('main').count(), 'exactly one <main>').toBe(1);
  expect.soft(await page.title(), 'the title starts with "Care Hub"').toMatch(/^Care Hub/);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = violations.map(({ id, impact, help, nodes }) => {
    const targets = nodes.slice(0, 3).map((node) => node.target.join(' '));
    return `${id} (${impact ?? 'unknown'}): ${help}: ${targets.join(', ')}${nodes.length > 3 ? ', …' : ''}`;
  });
  expect.soft(found, 'no axe violations (WCAG 2.1 A and AA)').toEqual([]);
}
