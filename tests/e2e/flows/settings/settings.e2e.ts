import type { Page } from '@playwright/test';
import {
  apiFor,
  expect,
  needs,
  onlyIn,
  people,
  signInAs,
  test,
  uniqueName,
} from '../_support/index.js';
import * as data from './settings-data.js';
import * as st from './settings-page.js';

// The Settings and members ⭐ checks, from the spec's Done means and section 7. Val (the seeded
// Viewer) changes her own profile, keeping her first name so other flows still find her, and gets
// her name back at the end. Avery (the fictional admin) makes the invite links. The people who
// join are new each time, with unique fictional names, because the whole run shares one database.

const MINUTE = 60_000;

/** Whether the person on `page` is still signed in to the workspace (GET /api/auth/me). */
async function inWorkspace(page: Page): Promise<boolean> {
  const response = await (await apiFor(page)).send('GET', '/api/auth/me');
  if (!response.ok()) return false;
  const body = (await response.json()) as data.Me;
  return body.member !== null;
}

test.describe('Settings: My account', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');

  test('SM-01 a new name and picture show in the Members list within 2 seconds, and a 6 MB picture is refused with the limit', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'viewer');
    const original = (await data.me(page)).user.name;
    const renamed = uniqueName(original);
    const eli = await st.windowFor(browser, 'editor');
    try {
      await st.openSettings(eli, 'Members');
      const row = st.memberRow(eli, people.viewer.email);
      await expect(row).toContainText(original);
      const firstPicture = await st.pictureIn(row);
      await st.openSettings(page, 'My account');

      await test.step("a new name shows in Eli's Members list within 2 seconds", async () => {
        await st.change(page, page.getByLabel('Name', { exact: true }), renamed);
        await expect(st.saved(page)).toBeVisible();
        const savedAt = Date.now();
        await expect(row).toContainText(renamed, { timeout: 5_000 });
        expect(Date.now() - savedAt, 'ms from Saved until Eli sees it').toBeLessThanOrEqual(2_000);
      });

      await test.step('a new picture shows there within 2 seconds too', async () => {
        await expect(st.saved(page)).toBeHidden({ timeout: 5_000 });
        await st.choosePicture(page, 'fictional-qa-picture.png', data.picture());
        await expect(st.saved(page)).toBeVisible();
        const savedAt = Date.now();
        await expect.poll(() => st.pictureIn(row), { timeout: 5_000 }).not.toBe(firstPicture);
        expect(Date.now() - savedAt, 'ms from Saved until Eli sees it').toBeLessThanOrEqual(2_000);
        await expect(row.locator('img').first()).toBeVisible();
      });

      await test.step('a 6 MB picture is refused, naming the 5 MB limit', async () => {
        const shown = await st.pictureIn(row);
        await st.choosePicture(page, 'fictional-qa-big-picture.png', data.picture(96, 6 * data.MB));
        await expect(page.getByText(/\b5 MB\b/).first()).toBeVisible();
        await page.waitForTimeout(2_500);
        expect(await st.pictureIn(row), 'the picture stays as it was').toBe(shown);
      });
    } finally {
      // Val's seeded name back (PATCH /api/auth/profile, decision 0007), then her initials.
      await (
        await apiFor(page)
      )
        .patch('/api/auth/profile', { name: original })
        .catch(() => undefined);
      const remove = page.getByRole('button', { name: /^remove( picture| photo)?$/i });
      if (await remove.isVisible().catch(() => false)) await remove.click().catch(() => undefined);
      await eli.context().close();
    }
  });
});

test.describe('Settings: invite links', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');

  test("SM-06 an invite link with 2 uses and the Editor role adds two people as Editors, then tells a third it isn't active", async ({
    page,
    browser,
  }) => {
    test.setTimeout(2 * MINUTE);
    await signInAs(page, 'admin');
    const path = await st.createInviteLink(page, { role: 'Editor', uses: 2 });
    const windows: Page[] = [];
    try {
      for (const firstName of ['Quinn', 'Rowan']) {
        await test.step(`${firstName} joins with it, as an Editor`, async () => {
          const person = data.newPerson(firstName);
          const joined = await st.join(browser, path, person);
          windows.push(joined);
          const { member } = await data.me(joined);
          expect(member?.kind, 'a member, not a guest').toBe('member');
          expect(member?.roleName).toBe('Editor');
          expect((await data.member(page, person.email)).roleName, 'in Members').toBe('Editor');
        });
      }

      await test.step("for a third person the link isn't active", async () => {
        const third = await st.openInvite(browser, path);
        windows.push(third);
        await expect(
          third.getByText("This invite link isn't active. Ask an Admin for a new one."),
        ).toBeVisible();
      });
    } finally {
      for (const opened of windows) await opened.context().close();
    }
  });
});

test.describe('Settings: removing a member', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings', 'pages');

  test("SM-07 removing Riley signs Riley out of the workspace within 5 seconds, and Riley's shared page stays", async ({
    page,
    browser,
  }) => {
    test.setTimeout(2 * MINUTE);
    await signInAs(page, 'admin');
    const riley = data.newPerson('Riley');
    const path = await st.createInviteLink(page, { role: 'Editor', uses: 1 });
    const rileyPage = await st.join(browser, path, riley);
    const title = uniqueName("Fictional QA Riley's shift notes");
    try {
      const id = await data.makeTeamPage(rileyPage, title);
      await rileyPage.goto(`/p/${id}`);
      await expect(rileyPage.getByText(title).first()).toBeVisible();

      await test.step('Riley is signed out of the workspace within 5 seconds', async () => {
        await st.removeMember(page, riley.email);
        const removedAt = Date.now();
        await expect
          .poll(() => inWorkspace(rileyPage), { timeout: 10_000, intervals: [250] })
          .toBe(false);
        expect(Date.now() - removedAt, 'ms until Riley is out').toBeLessThanOrEqual(5_000);
        await rileyPage.reload();
        await expect(rileyPage.getByText(title)).toHaveCount(0);
      });

      await test.step("Riley's shared page stays", async () => {
        await page.goto(`/p/${id}`);
        await expect(page.getByText(title).first()).toBeVisible();
      });
    } finally {
      await rileyPage.context().close();
    }
  });
});
