import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import {
  adminOnlyFields,
  clickAndCapture,
  openStatus,
  overallWords,
  parts,
  readableDays,
  recordApiAnswers,
  statusMain,
  uptimePercent,
} from './status-page.js';

// Status page spec, Done means and section 7. /status is public: signed out, it shows only the
// overall status and the 30-day uptime (ST-D1). Avery, the seeded site admin, sees the rest.

test.describe('Status page, signed out', () => {
  onlyIn('desktop-light');
  needs('statusPage');

  test('ST-01 signed out, /status shows only the overall status and uptime', async ({ page }) => {
    const answers = recordApiAnswers(page);
    await openStatus(page);
    const main = statusMain(page);

    await test.step('the overall status shows as a word, with the 30-day uptime', async () => {
      await expect(page).toHaveTitle(/^Care Hub/);
      await expect(main.getByText(overallWords).first()).toBeVisible();
      await expect(main.getByText(uptimePercent).first()).toBeVisible();
      const days = await readableDays(page);
      expect(days, 'the bar should cover the last 30 days, each one readable').toHaveLength(30);
    });

    await test.step('nothing meant for site admins shows', async () => {
      for (const name of ['Back up now', 'Test a restore now']) {
        await expect(page.getByRole('button', { name })).toHaveCount(0);
      }
      await expect(main.getByRole('heading', { name: /backups?|incidents?|version/i })).toHaveCount(
        0,
      );
      await expect(
        main.getByText(/free disk|last good backup|restore test|build date/i),
      ).toHaveCount(0);
      for (const part of parts.slice(1)) await expect(main.getByText(part)).toHaveCount(0);
    });

    await test.step('the answers from the server hold nothing more', async () => {
      await expect
        .poll(() => answers.filter((answer) => answer.path.includes('status')).length, {
          message: 'the page should load its numbers from the server',
        })
        .toBeGreaterThan(0);
      for (const { path, body } of answers) {
        expect(adminOnlyFields(body), `${path} answered more than status and uptime`).toEqual([]);
      }
    });
  });
});

test.describe('Status page, site admin', () => {
  onlyIn('desktop-light');
  needs('signIn', 'statusPage');

  test('ST-02 a site admin sees every part, backups, incidents and the version', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    await openStatus(page);
    const main = statusMain(page);

    await test.step('the overall status and uptime, as for everyone', async () => {
      await expect(main.getByText(overallWords).first()).toBeVisible();
      await expect(main.getByText(uptimePercent).first()).toBeVisible();
    });

    await test.step('each part, with free disk space and failing calendar connections', async () => {
      for (const part of parts) await expect(main.getByText(part).first()).toBeVisible();
      await expect(main.getByText(/\bfree\b/i).first()).toBeVisible();
      await expect(main.getByText(/failing/i).first()).toBeVisible();
    });

    await test.step('backups, with the last restore test', async () => {
      const none = main.getByText('No backups yet. The first one runs tonight.');
      await expect(
        main
          .getByText(/last good backup/i)
          .or(none)
          .first(),
      ).toBeVisible();
      await expect(main.getByText(/restore test/i).first()).toBeVisible();
    });

    await test.step('incidents in the last 30 days and the version', async () => {
      await expect(main.getByText(/incidents?/i).first()).toBeVisible();
      await expect(main.getByText(/version/i).first()).toBeVisible();
    });

    await test.step('the two buttons', async () => {
      await expect(main.getByRole('button', { name: 'Back up now' })).toBeVisible();
      await expect(main.getByRole('button', { name: 'Test a restore now' })).toBeVisible();
    });
  });

  test('ST-08 Back up now and Test a restore now record their results; anyone else gets 403', async ({
    page,
    browser,
  }) => {
    // A backup and a restore test of the test database take a little while.
    test.setTimeout(6 * 60_000);
    await signInAs(page, 'admin');
    await openStatus(page);
    const main = statusMain(page);
    const text = () => main.innerText();

    const backup = await test.step('Back up now makes a good backup', async () => {
      const sent = await clickAndCapture(page, main.getByRole('button', { name: 'Back up now' }));
      await expect(main.getByText('No backups yet. The first one runs tonight.')).toBeHidden({
        timeout: 2 * 60_000,
      });
      await expect
        .poll(text, { timeout: 2 * 60_000, message: 'the last good backup shows with its size' })
        .toMatch(/last good backup[\s\S]{0,120}\d+(\.\d+)?\s?(B|KB|MB|GB)\b/i);
      return sent;
    });

    const restoreTest = await test.step('Test a restore now records its result', async () => {
      const sent = await clickAndCapture(
        page,
        main.getByRole('button', { name: 'Test a restore now' }),
      );
      await expect
        .poll(text, { timeout: 2 * 60_000, message: 'the restore test shows that it worked' })
        .toMatch(/restore test[\s\S]{0,160}\b(passed|succeeded|worked|ok)\b/i);
      return sent;
    });

    await test.step('both results are still there after a reload', async () => {
      await page.reload();
      await expect(main.getByText(overallWords).first()).toBeVisible();
      expect(await text()).toMatch(/last good backup[\s\S]{0,120}\d+(\.\d+)?\s?(B|KB|MB|GB)\b/i);
      expect(await text()).toMatch(/restore test[\s\S]{0,160}\b(passed|succeeded|worked|ok)\b/i);
    });

    await test.step('for anyone else the buttons are missing and the requests refused', async () => {
      const context = await browser.newContext();
      const other = await context.newPage();
      await signInAs(other, 'editor');
      await openStatus(other);
      await expect(other.getByRole('button', { name: 'Back up now' })).toHaveCount(0);
      await expect(other.getByRole('button', { name: 'Test a restore now' })).toHaveCount(0);
      const api = await apiFor(other);
      for (const { method, path, data } of [backup, restoreTest]) {
        const response = await api.send(method, path, data);
        expect(response.status(), `${method} ${path} as an Editor`).toBe(403);
        const body = (await response.json()) as { error?: { message?: string } };
        expect(body.error?.message).toBe("You don't have access to this.");
      }
      await context.close();
    });
  });
});
