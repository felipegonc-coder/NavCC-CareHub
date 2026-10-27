import type { Request } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { signedInPage } from '../databases/database-page.js';
import { FORBIDDEN } from '../pages/page-screen.js';
import { choose, DataSettings, sendAgainAs } from './data-settings-screen.js';

// Who may use Settings → Data (Data settings spec, section 5): Admins for Keeping data, Storage
// and the workspace's upload limit; site admins for the rest. Avery is the seeded site admin and
// Admin.

onlyIn('desktop-light');

test.describe('Data settings: access', () => {
  needs('signIn', 'dataSettings');

  test('DS-12 Eli, not an Admin, has no Data settings, and his direct request is refused (403)', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const data = new DataSettings(page);
    await data.open();
    const activity = (await data.show('Keeping data')).getByLabel('Activity for Analytics');
    // Avery's change is caught on its way to the server and never arrives, so nothing changes.
    let caught: Request | undefined;
    await page.route('**/api/**', async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      caught ??= route.request();
      return route.abort();
    });
    await choose(activity, '2 years');
    await expect.poll(() => caught !== undefined).toBe(true);
    await page.unroute('**/api/**');

    // Eli stands in for Sam (spec); any member who isn't an Admin gives the same result.
    const eli = await signedInPage(browser, 'editor');
    try {
      await eli.goto('/settings/data');
      await expect(eli.getByRole('main')).toBeVisible();
      await expect(eli.getByRole('heading', { name: 'Keeping data' })).toHaveCount(0);
      await expect(eli.getByLabel('Automatic page versions')).toHaveCount(0);

      const refused = await sendAgainAs(eli, caught as Request);
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual(FORBIDDEN);
    } finally {
      await eli.context().close();
    }
  });
});
