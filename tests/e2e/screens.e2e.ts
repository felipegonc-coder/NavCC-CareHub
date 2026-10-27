import { test } from '@playwright/test';
import { screens } from './screens.js';
import { checkScreen } from './support/screen-checks.js';

for (const screen of screens) {
  test(`${screen.name} ${screen.path}`, async ({ page }, testInfo) =>
    checkScreen(page, screen, testInfo));
}
