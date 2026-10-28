import type { Browser } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { addProperty, addRow, makeDatabase } from '../databases/database-api.js';
import { DatabaseScreen, signedInPage } from '../databases/database-page.js';
import { choose, DataSettings, expectChoice, shownChoice } from './data-settings-screen.js';
import { filesConfig, MB, textFile, uploadInto } from './uploads.js';

// Settings → Data: Keeping data and Uploads (Data settings spec, sections 3.1 and 3.3). These
// are the workspace's and the site's settings, which other files rely on, so this file's name
// ends in .workspace.e2e.ts: it runs after the others, on its own, one test after another, and
// puts the defaults back at the end.

/** The defaults these tests change (section 3.1, DS-D2, and the build contract's 100 MB). */
const VERSIONS_DEFAULT = '1 year';
const LIMIT_DEFAULT_MB = '100';

/** Automatic page versions, under Keeping data. */
async function versionsField(data: DataSettings) {
  return (await data.show('Keeping data')).getByLabel('Automatic page versions');
}

/** The site's largest file, under Uploads (site admins). */
async function largestField(data: DataSettings) {
  return (await data.show('Uploads')).getByLabel(/^Largest file/).first();
}

/** Puts back the defaults, as Avery. Lengthening a period doesn't ask first. */
async function putBackDefaults(browser: Browser): Promise<void> {
  const avery = await signedInPage(browser, 'admin');
  try {
    const data = new DataSettings(avery);
    await data.open();
    const versions = await versionsField(data);
    if (!(await shownChoice(versions)).includes(VERSIONS_DEFAULT)) {
      await choose(versions, VERSIONS_DEFAULT);
      await data.saved();
    }
    const largest = await largestField(data);
    if ((await largest.inputValue()) !== LIMIT_DEFAULT_MB) {
      await largest.fill(LIMIT_DEFAULT_MB);
      await largest.press('Tab');
      await data.saved();
    }
  } finally {
    await avery.context().close();
  }
}

onlyIn('desktop-light');

test.describe('Data settings: keeping data and uploads', () => {
  needs('signIn', 'dataSettings');
  test.describe.configure({ mode: 'serial' });
  test.afterAll(async ({ browser }) => putBackDefaults(browser));

  test('DS-01 Shortening automatic page versions to 90 days shows what goes tonight first', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const data = new DataSettings(page);
    await data.open();
    const versions = await versionsField(data);
    await expectChoice(versions, VERSIONS_DEFAULT);

    await test.step('90 days → the count of versions that go tonight; Cancel keeps 1 year', async () => {
      await choose(versions, '90 days');
      const confirm = data.confirm();
      await expect(confirm).toContainText(
        /Tonight this permanently deletes [\d,]+ page versions? older than 90 days\./,
      );
      await expect(confirm).toContainText('Backups keep them for up to 30 more days.');
      await expect(confirm.getByRole('button', { name: 'Delete tonight' })).toBeFocused();
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(confirm).toBeHidden();
      await expectChoice(versions, VERSIONS_DEFAULT);
    });

    await test.step('90 days → Delete tonight saves it', async () => {
      await choose(versions, '90 days');
      await data.confirm().getByRole('button', { name: 'Delete tonight' }).click();
      await data.saved();
      await data.open();
      await expectChoice(await versionsField(data), '90 days');
    });
  });

  test.describe('with a database to upload into', () => {
    needs('pages', 'databases');

    test('DS-05 A 100.1 MB file is refused at the default limit and accepted once a site admin allows 200 MB', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await signInAs(page, 'admin');
      const name = 'Fictional QA call recording.txt';
      const big = await textFile(name, Math.ceil(100.1 * MB));
      const database = await makeDatabase(page, uniqueName('Fictional QA uploads'));
      const files = await addProperty(page, database.id, 'Attachments', filesConfig());
      const row = await addRow(page, database.id, 'Fictional QA upload');
      const screen = new DatabaseScreen(page, database.id);
      const data = new DataSettings(page);

      await test.step('At the default 100 MB, the upload is refused and says why', async () => {
        await screen.open();
        await uploadInto(screen, row.id, files.id, big);
        await expect(page.getByText('This file is 100.1 MB; the limit is 100 MB.')).toBeVisible({
          timeout: 60_000,
        });
      });

      await test.step('Avery, a site admin, sets the largest file to 200 MB', async () => {
        await data.open();
        const largest = await largestField(data);
        await expect(largest).toHaveValue(LIMIT_DEFAULT_MB);
        await largest.fill('200');
        await largest.press('Tab');
        await data.saved();
      });

      await test.step('The same file is accepted', async () => {
        await screen.open();
        await uploadInto(screen, row.id, files.id, big);
        await expect(screen.cell(row.id, files.id)).toContainText(name, { timeout: 90_000 });
      });
    });
  });
});
