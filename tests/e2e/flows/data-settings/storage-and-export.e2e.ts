import type { Download, Page } from '@playwright/test';
import { expect, needs, onlyIn, shownDate, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat, control } from '../comments/care-hub-chat.js';
import { makeDatabase } from '../databases/database-api.js';
import { signedInPage } from '../databases/database-page.js';
import { makePage } from '../pages/page-data.js';
import { FORBIDDEN } from '../pages/page-screen.js';
import { archiveFiles, holding } from './archive.js';
import { DataSettings } from './data-settings-screen.js';
import { MB, textFile, uploadIn } from './uploads.js';

// Settings → Data: Storage and Export everything (Data settings spec, sections 3.2 and 3.5).
// Avery is the seeded site admin and Admin; Eli is an Editor with a Private space of his own.

/** The kinds Storage splits the used space into (section 3.2). */
const KINDS = [
  'Page content',
  'Page versions',
  'Files',
  'Message files',
  'Backups',
  'Search index',
];

/** The export notice's link or button. */
const DOWNLOAD = /download/i;

/** The download asks for the password again (section 3.5); the seed's password, never written here. */
async function confirmPassword(page: Page): Promise<void> {
  const box = page.getByLabel('Password', { exact: true });
  const asked = await box.waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!asked) return;
  const password = process.env.CAREHUB_SEED_PASSWORD;
  if (!password) throw new Error('CAREHUB_SEED_PASSWORD is not set.');
  await box.fill(password);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^(Continue|Confirm|Download)$/ })
    .click();
}

onlyIn('desktop-light');

test.describe('Data settings: storage and export', () => {
  needs('signIn', 'dataSettings', 'pages', 'databases');

  test('DS-04 Storage splits the space used, and its largest files show no title Avery can’t open', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const shared = uniqueName('Fictional QA shared');
    const secret = uniqueName('Fictional QA Eli private');
    const sharedFile = `${uniqueName('Fictional QA team recording')}.txt`;
    const privateFile = `${uniqueName('Fictional QA own recording')}.txt`;
    const eli = await signedInPage(browser, 'editor');
    try {
      await test.step('Eli uploads 20 MB in the team space and 20 MB in his Private space', async () => {
        const team = await makeDatabase(eli, shared);
        await uploadIn(eli, team, await textFile(sharedFile, 20 * MB));
        const own = await makeDatabase(eli, secret, 'private');
        await uploadIn(eli, own, await textFile(privateFile, 20 * MB));
      });
    } finally {
      await eli.context().close();
    }

    await signInAs(page, 'admin');
    const data = new DataSettings(page);
    await data.open();
    const storage = await data.show('Storage');
    await storage.getByRole('button', { name: 'Refresh', exact: true }).click();

    await test.step('The space used is split by kind; private spaces show as one total', async () => {
      for (const kind of KINDS) {
        await expect(storage.getByText(kind, { exact: true }).first()).toBeVisible();
      }
      await expect(storage.getByText('Private pages', { exact: true }).first()).toBeVisible();
    });

    await test.step('Largest files: the team file says where it is, Eli’s private one doesn’t', async () => {
      const entries = storage.getByRole('row').or(storage.getByRole('listitem'));
      const team = entries.filter({ hasText: sharedFile }).first();
      await expect(team).toContainText(shared, { timeout: 30_000 });
      await expect(entries.filter({ hasText: privateFile }).first()).toContainText(
        "A page you can't open",
      );
      await expect(storage.getByText(secret)).toHaveCount(0);
    });
  });

  test.describe('with the 🔔 chat', () => {
    // The export runs as a job, and its notice reaches the open 🔔 chat without a reload (#288).
    needs('notices', 'liveUpdates');

    test('DS-09 Export everything runs in the background; its link is Avery’s only; the archive has pages, CSV, JSON and files, and no secrets or private pages of others', async ({
      page,
      browser,
    }) => {
      test.setTimeout(180_000);
      const eli = await signedInPage(browser, 'editor');
      try {
        const secret = uniqueName('Fictional QA Eli private plans');
        await makeDatabase(eli, secret, 'private');
        await signInAs(page, 'admin');
        const title = uniqueName('Fictional QA export check');
        await makePage(page, title);
        const cardName = `${uniqueName('Fictional QA intake card')}.txt`;
        const database = await makeDatabase(page, `${title} uploads`);
        const { row } = await uploadIn(page, database, await textFile(cardName, 2_048));
        const week = shownDate(new Date(Date.now() + 7 * 24 * 3_600_000)).replace(/, \d{4}$/, '');
        let download: Download | undefined;

        await test.step('Avery starts Export everything, then goes on to her 🔔 chat', async () => {
          const data = new DataSettings(page);
          await data.open();
          const part = await data.show('Export everything');
          await part.getByRole('button', { name: /^(Export everything|Start export)$/ }).click();
        });

        await test.step('A notice brings a download link that works for 7 days', async () => {
          const chat = new CareHubChat(page);
          await chat.open();
          const notice = chat.notice(DOWNLOAD);
          await expect(notice).toBeVisible({ timeout: 120_000 });
          await expect(notice).toContainText(new RegExp(`7 days|${week}\\b`));
          const downloaded = page.waitForEvent('download', { timeout: 60_000 });
          await control(notice, DOWNLOAD).first().click();
          await confirmPassword(page);
          download = await downloaded;
        });

        const files = await archiveFiles(download as Download);
        await test.step('The archive has the pages, the database as CSV and JSON, and the file', async () => {
          const pages = holding(files, title);
          expect(
            pages.filter((path) => path.endsWith('.md')),
            'Markdown pages',
          ).not.toEqual([]);
          expect(
            pages.filter((path) => path.endsWith('.html')),
            'HTML pages',
          ).not.toEqual([]);
          const csv = holding(files, row.title).filter((path) => path.endsWith('.csv'));
          expect(csv, 'the database as CSV').not.toEqual([]);
          const json = holding(files, database.title).filter((path) => path.endsWith('.json'));
          expect(json.filter((path) => files.get(path)?.includes('Attachments'))).not.toEqual([]);
          const uploaded = [...files].find(([path]) => path.endsWith(cardName));
          expect(uploaded?.[1].length, 'the uploaded file').toBe(2_048);
        });

        await test.step('No password or session, and nothing from Eli’s Private space', async () => {
          const cookies = await page.context().cookies();
          const secrets = [process.env.CAREHUB_SEED_PASSWORD ?? '', ...cookies.map((c) => c.value)];
          for (const value of secrets.filter((s) => s.length >= 8)) {
            expect(holding(files, value), 'paths holding a password or a session').toEqual([]);
          }
          expect(holding(files, secret), 'paths holding Eli’s private database').toEqual([]);
        });

        await test.step('The link is Avery’s only: Eli is refused (403)', async () => {
          const refused = await eli.request.get((download as Download).url());
          expect(refused.status()).toBe(403);
          expect(await refused.json()).toEqual(FORBIDDEN);
        });
      } finally {
        await eli.context().close();
      }
    });
  });
});
