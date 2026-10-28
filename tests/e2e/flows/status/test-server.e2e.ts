import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { openStatus, statusMain } from './status-page.js';

// Status page spec, Done means 4 and 5 (ST-03 and ST-05). They stop the test server's database or
// the app, so they run by hand only, on their own, and skip unless their commands are set:
//
//   E2E_BASE_URL=<the test server's Care Hub address, through Caddy>
//   E2E_STOP_DATABASE / E2E_START_DATABASE   shell commands that stop and start its database
//   E2E_STOP_APP / E2E_START_APP             shell commands that stop and start the app
//   npx playwright test flows/status/test-server.e2e.ts --project=desktop-light --workers=1
//
// The start command always runs at the end, also when a check fails. Never set these in CI.

const MINUTE = 60_000;

const commands = {
  stopDatabase: process.env.E2E_STOP_DATABASE,
  startDatabase: process.env.E2E_START_DATABASE,
  stopApp: process.env.E2E_STOP_APP,
  startApp: process.env.E2E_START_APP,
};

/** The down page Caddy shows while the app doesn't answer (section 2), word for word. */
const downPage =
  "Care Hub isn't responding. It usually comes back within a minute. If it's still down after 10 minutes, restart the server.";

function run(command: string): void {
  execSync(command, { stdio: 'inherit', timeout: 2 * MINUTE });
}

/** The page's text on one line, with typographic apostrophes as plain ones. */
async function shownText(page: Page): Promise<string> {
  const text = await page.locator('body').innerText();
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The overall status word on /status. */
function overall(page: Page, word: 'Working' | 'Down') {
  return statusMain(page).getByText(word, { exact: true }).first();
}

/** The incidents of the last 30 days as a site admin sees them: one text per row. */
async function incidents(page: Page): Promise<string[]> {
  const main = statusMain(page);
  const section = main
    .locator('section, [role="region"]')
    .filter({ has: page.getByRole('heading', { name: /incidents/i }) })
    .last();
  const rows = section
    .getByRole('row')
    .filter({ hasNot: page.getByRole('columnheader') })
    .or(section.getByRole('listitem'));
  return rows.allInnerTexts();
}

/** A length as Care Hub writes it, for example "3 min", "1 minute" or "2m 10s". */
const length = /\b\d+\s?(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hours?)\b/i;

// Not parallel: the two checks must never stop things at the same time.
test.describe.configure({ mode: 'default' });

test.describe('Status page on the test server, by hand: the database', () => {
  onlyIn('desktop-light');
  needs('signIn', 'statusPage');

  test('ST-03 with the database stopped /status shows Down within 60 seconds, and starting it again records an incident with its length', async ({
    page,
    browser,
  }) => {
    const { stopDatabase, startDatabase } = commands;
    test.skip(
      !stopDatabase || !startDatabase,
      'By hand only, on the test server: set E2E_STOP_DATABASE and E2E_START_DATABASE',
    );
    if (!stopDatabase || !startDatabase) return;
    test.setTimeout(12 * MINUTE);

    await signInAs(page, 'admin');
    await openStatus(page);
    const before = await incidents(page);
    // Someone signed out watches too: the overall status needs no session.
    const watcher = await (await browser.newContext()).newPage();
    await openStatus(watcher);
    await expect(overall(watcher, 'Working')).toBeVisible();

    try {
      await test.step('within 60 seconds of stopping the database, Down shows', async () => {
        run(stopDatabase);
        const stoppedAt = Date.now();
        // The open page refreshes itself; nobody reloads it.
        await expect(overall(watcher, 'Down')).toBeVisible({ timeout: MINUTE });
        test.info().annotations.push({
          type: 'Down after',
          description: `${Math.round((Date.now() - stoppedAt) / 1_000)} s`,
        });
        // Avery's page names the database (soft: it may not load its parts while it's down).
        await expect
          .soft(statusMain(page), 'the database part shows down for Avery')
          .toContainText(/database[\s\S]{0,80}\b(down|not working|failing|unreachable)\b/i, {
            timeout: MINUTE,
          });
        // Stay down for 2 minutes, so the heartbeats miss at least one whole minute.
        await page.waitForTimeout(Math.max(0, stoppedAt + 2 * MINUTE - Date.now()));
      });
    } finally {
      run(startDatabase);
    }

    await test.step('after starting it again, Working shows', async () => {
      await expect(overall(watcher, 'Working')).toBeVisible({ timeout: 3 * MINUTE });
    });

    await test.step('Avery sees a new incident with its length', async () => {
      await expect
        .poll(
          async () => {
            await openStatus(page);
            return (await incidents(page)).filter((row) => !before.includes(row));
          },
          { timeout: 3 * MINUTE, intervals: [10_000], message: 'a new incident in the list' },
        )
        .toContainEqual(expect.stringMatching(length));
    });
    await watcher.context().close();
  });
});

test.describe('Status page on the test server, by hand: the app', () => {
  onlyIn('desktop-light');
  needs('statusPage');

  test("ST-05 with the app stopped, Care Hub's address shows the down page", async ({ page }) => {
    const { stopApp, startApp } = commands;
    test.skip(
      !stopApp || !startApp || !process.env.E2E_BASE_URL,
      'By hand only, on the test server through Caddy: set E2E_BASE_URL, E2E_STOP_APP and E2E_START_APP',
    );
    if (!stopApp || !startApp) return;
    test.setTimeout(8 * MINUTE);

    const opened = async (path: string) => {
      try {
        await page.goto(path);
        return await shownText(page);
      } catch {
        return '';
      }
    };

    try {
      run(stopApp);

      await test.step('the down page shows, plain, at every address', async () => {
        await expect
          .poll(() => opened('/'), { timeout: MINUTE, message: 'the down page at /' })
          .toContain(downPage);
        await expect(page.getByRole('navigation')).toHaveCount(0);
        await expect(page.getByRole('textbox')).toHaveCount(0);
        for (const path of ['/status', '/settings/members']) {
          expect(await opened(path), `the down page at ${path}`).toContain(downPage);
        }
      });
    } finally {
      run(startApp);
      // Care Hub answers again before the next run.
      await expect
        .poll(
          async () => {
            const health = await page.request.get('/api/health').catch(() => null);
            return health?.ok() ?? false;
          },
          { timeout: 3 * MINUTE, intervals: [2_000], message: 'Care Hub answers again' },
        )
        .toBe(true);
    }

    await test.step('once the app is back, Care Hub opens again', async () => {
      await page.goto('/status');
      expect(await shownText(page)).not.toContain(downPage);
    });
  });
});
