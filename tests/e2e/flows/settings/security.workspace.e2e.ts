import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen } from '../pages/page-screen.js';
import { ShareDialog, choice } from '../sharing/share-dialog.js';
import { clickAndCapture, type SentRequest } from '../status/status-page.js';
import * as account from './account-page.js';
import * as emoji from './emoji-page.js';
import { newPerson, picture } from './settings-data.js';
import * as security from './security-page.js';
import { createInviteLink, join, openSettings, windowFor } from './settings-page.js';

// Settings and members, Done means 7 and section 7: SM-09 (each Security switch changes behavior
// at once, and direct requests that break it are refused with 403), SM-10 (required 2-step
// verification) and SM-12's limit of 500 custom emoji. Each check changes something the whole
// workspace shares and other checks rely on, so this file runs in the project "workspace": after
// every other test has finished, one test at a time (#369). Each check puts its change back in
// `finally`, and `afterAll` puts every switch back to its default. Avery (the fictional admin)
// makes the changes; Eli (an Editor) is the member who loses the action.

const inWorkspaceProject = 'Runs in the workspace project, after all other files (#369)';

// In order, one after another, and a failed check doesn't skip the ones after it.
test.describe.configure({ mode: 'default' });

/** A request sent again by someone, with the status it got. */
async function sendAgain(page: Page, sent: SentRequest, data: unknown = sent.data) {
  return (await (await apiFor(page)).send(sent.method, sent.path, data)).status();
}

test.describe('Settings: changes for the whole workspace', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');
  test.fixme(true, inWorkspaceProject);

  test.afterAll(async ({ browser }) => {
    const page = await windowFor(browser, 'admin');
    for (const key of Object.keys(security.switches) as security.SwitchKey[]) {
      await security.setSwitch(page, key, security.switches[key].on);
    }
    await security.setWhoCan(page, 'spaces', 'Everyone');
    await security.setWhoCan(page, 'emoji', 'Everyone');
    await page.context().close();
  });

  test.describe('Security switches in the share dialog', () => {
    needs('pages', 'sharing');

    test('SM-09 with Allow guests off, guest invites are offered nowhere, and a direct invite is refused (403)', async ({
      page,
    }) => {
      test.setTimeout(2 * 60_000);
      await signInAs(page, 'admin');
      const pageId = await makePage(page, uniqueName('Fictional QA security page'));
      const screen = new PageScreen(page);
      const share = new ShareDialog(page);
      const first = newPerson('Gale');
      const second = newPerson('Hollis');
      try {
        const sent =
          await test.step('with guests allowed, the share dialog adds a guest', async () => {
            await screen.goto(pageId);
            await share.open();
            await share.inviteBox.fill(first.email);
            await choice(page, /guest/i).click();
            const name = page
              .getByRole('dialog')
              .last()
              .getByLabel(/^(name|guest.s name|full name)$/i);
            if (await name.isVisible()) await name.fill(first.name);
            return clickAndCapture(
              page,
              share.dialog.getByRole('button', { name: 'Invite', exact: true }),
            );
          });

        await security.setSwitch(page, 'guests', false);

        await test.step('the share dialog offers no guest for an outside address', async () => {
          await screen.goto(pageId);
          await share.open();
          await share.inviteBox.fill(second.email);
          // Give the search a moment to answer before checking that nothing came back.
          await page.waitForTimeout(1_500);
          await expect(choice(page, /guest/i)).toHaveCount(0);
        });

        await test.step('Members → Guests offers no way to add one', async () => {
          await openSettings(page, 'Members');
          await page.getByRole('tab', { name: 'Guests', exact: true }).click();
          await expect(
            page.getByRole('button', { name: /(add|invite) (a )?guests?/i }),
          ).toHaveCount(0);
        });

        await test.step('the same invite sent directly is refused (403)', async () => {
          const again = account.swapped(
            account.swapped(sent.data, first.email, second.email),
            first.name,
            second.name,
          );
          expect(await sendAgain(page, sent, again)).toBe(403);
        });
      } finally {
        await security.setSwitch(page, 'guests', true);
        await security.removeGuest(page, first.email);
        await security.removeGuest(page, second.email);
      }
    });

    test('SM-09 with Allow share links off, no link can be made, a made one stops working at once, and a direct request is refused (403)', async ({
      page,
      browser,
    }) => {
      test.setTimeout(2 * 60_000);
      await signInAs(page, 'admin');
      const title = uniqueName('Fictional QA shared by link');
      const pageId = await makePage(page, title);
      const screen = new PageScreen(page);
      const share = new ShareDialog(page);
      const makeLink = share.dialog.getByRole('button', {
        name: /^(make|create|turn on)( a)?( share)?( link)?$/i,
      });
      const visitor = await (await browser.newContext()).newPage();
      try {
        const { sent, path } =
          await test.step('with share links allowed, Avery makes one', async () => {
            await screen.goto(pageId);
            await share.open();
            await share.dialog.getByRole('tab', { name: /share link/i }).click();
            const request = await clickAndCapture(page, makeLink);
            return { sent: request, path: await security.linkPathIn(share.dialog) };
          });
        await visitor.goto(path);
        await expect(visitor.getByText(title).first()).toBeVisible();

        await security.setSwitch(page, 'shareLinks', false);

        await test.step('the link already made stops working', async () => {
          await visitor.reload();
          await expect(visitor.getByText(title)).toHaveCount(0);
        });

        await test.step('the share dialog offers no share link', async () => {
          await screen.goto(pageId);
          await share.open();
          const tab = share.dialog.getByRole('tab', { name: /share link/i });
          if (await tab.count()) await tab.click();
          await expect(makeLink).toHaveCount(0);
        });

        await test.step('making one directly is refused (403)', async () => {
          expect(await sendAgain(page, sent)).toBe(403);
        });
      } finally {
        await security.setSwitch(page, 'shareLinks', true);
        await visitor.context().close();
      }
    });
  });

  test.describe('Security switches for members', () => {
    test('SM-09 with spaces made by Admins only, Eli is offered no new space and a direct request is refused (403)', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'admin');
      const eli = await windowFor(browser, 'editor');
      const newSpace = eli.getByRole('button', { name: /^(new|create|add)( a)? space$/i });
      try {
        await security.setWhoCan(page, 'spaces', 'Admins only');
        await eli.goto('/');
        await expect(eli.getByRole('main')).toBeVisible();
        await expect(newSpace).toHaveCount(0);
        // Assumes POST /api/spaces with a name, as GET /api/spaces lists them (decision 0007).
        const response = await (
          await apiFor(eli)
        ).send('POST', '/api/spaces', {
          name: uniqueName('Fictional QA space'),
        });
        expect(response.status(), 'POST /api/spaces as Eli').toBe(403);
      } finally {
        await security.setWhoCan(page, 'spaces', 'Everyone');
        await eli.context().close();
      }
    });

    test('SM-09 with custom emoji added by Admins only, Eli is offered no Add emoji and a direct upload is refused (403)', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'admin');
      const eli = await windowFor(browser, 'editor');
      const add = eli.getByRole('button', { name: /^add( custom)? emoji$/i });
      try {
        await openSettings(eli, 'Emoji');
        await expect(add, 'everyone may add emoji by default').toBeVisible();
        await security.setWhoCan(page, 'emoji', 'Admins only');
        await openSettings(eli, 'Emoji');
        await expect(add).toHaveCount(0);
        const name = `qa-${randomUUID().slice(0, 8)}`;
        const response = await emoji.sendEmoji(eli, name, picture(32));
        if (response.ok()) {
          // Taken by mistake: delete it before failing.
          await (await apiFor(page)).send('DELETE', `/api/emoji/${await emoji.addedId(response)}`);
        }
        expect(response.status(), 'POST /api/emoji as Eli').toBe(403);
      } finally {
        await security.setWhoCan(page, 'emoji', 'Everyone');
        await eli.context().close();
      }
    });

    test('SM-09 with moving pages to other workspaces off, Move to offers no other workspace', () => {
      test.fixme(true, 'Needs a second workspace in the seed');
    });
  });

  test.describe('Security switches for members, exporting', () => {
    needs('pages', 'importExport');

    test('SM-09 with Members can export off, only Admins are offered Export', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'admin');
      const pageId = await makePage(page, uniqueName('Fictional QA export page'));
      const eli = await windowFor(browser, 'editor');
      const eliScreen = new PageScreen(eli);
      const exportItem = (menu: Locator) => menu.getByRole('menuitem', { name: /^export/i });
      try {
        await security.setSwitch(page, 'export', false);
        await eliScreen.goto(pageId);
        await expect(exportItem(await eliScreen.openPageMenu())).toHaveCount(0);
        const screen = new PageScreen(page);
        await screen.goto(pageId);
        await expect(exportItem(await screen.openPageMenu())).toBeVisible();
      } finally {
        await security.setSwitch(page, 'export', true);
        await eli.context().close();
      }
    });
  });

  test.describe('Required 2-step verification', () => {
    test('SM-10 with 2-step verification required, someone without it sets it up at their next sign-in', async ({
      page,
      browser,
    }) => {
      // Codes come in 30-second steps, and each step's code is used once, so this waits for up to
      // two new steps.
      test.setTimeout(3 * 60_000);
      await signInAs(page, 'admin');
      const person = newPerson('Morgan');
      const invite = await createInviteLink(page, { role: 'Editor', uses: 1 });
      await (await join(browser, invite, person)).context().close();
      const opened: Page[] = [];
      const device = async () => {
        const each = await account.newDevice(browser);
        opened.push(each);
        return each;
      };
      try {
        await security.setSwitch(page, 'requireTwoStep', true);
        const laptop = await device();

        await test.step('the next sign-in asks for the 2-step setup, with no way to skip it', async () => {
          await account.enterPassword(laptop, person);
          await account.twoStepSetup(laptop);
          await expect(
            laptop
              .getByRole('button', { name: /^(skip|later|not now|maybe later|remind me later)/i })
              .or(laptop.getByRole('link', { name: /^(skip|later|not now)/i })),
          ).toHaveCount(0);
        });

        await test.step('going to Home instead lets nobody in', async () => {
          await laptop.goto('/');
          const signInScreen = account.passwordBox(laptop).first();
          await expect(account.setupRequest(laptop).or(signInScreen).first()).toBeVisible();
          const spaces = await (await apiFor(laptop)).send('GET', '/api/spaces');
          expect(spaces.status(), 'GET /api/spaces before the setup').toBeGreaterThanOrEqual(400);
          if (await signInScreen.isVisible()) await account.enterPassword(laptop, person);
        });

        const app =
          await test.step('setting it up lets them in, with 10 recovery codes', async () => {
            const setUp = await account.setUpTwoStep(laptop, await account.twoStepSetup(laptop));
            expect(setUp.recoveryCodes, 'ten one-time recovery codes').toHaveLength(10);
            await expect.poll(() => account.signedIn(laptop)).toBe(true);
            await expect(laptop.getByRole('main')).toBeVisible();
            return setUp;
          });

        await test.step('from then on, signing in asks for a code instead', async () => {
          const phone = await device();
          await account.enterPassword(phone, person);
          await account.enterCode(
            phone,
            account.codeBox(phone),
            await account.freshCode(phone, app),
          );
          await expect.poll(() => account.signedIn(phone)).toBe(true);
        });
      } finally {
        await security.setSwitch(page, 'requireTwoStep', false);
        for (const each of opened) await each.context().close();
      }
    });
  });

  test.describe('The custom emoji limit', () => {
    test('SM-12 with 500 custom emoji, a 501st is refused on the screen and by the server', async ({
      page,
    }) => {
      // About 500 quick uploads of a small picture through the API, and as many deletes after.
      test.setTimeout(5 * 60_000);
      await signInAs(page, 'admin');
      const tag = randomUUID().slice(0, 8);
      const file = picture(32);
      const added: string[] = [];
      try {
        await test.step('the workspace gets to 500 custom emoji through the API', async () => {
          for (let n = (await emoji.listEmoji(page)).length; n < 500; n += 1) {
            const response = await emoji.sendEmoji(page, `qa-${tag}-${n}`, file);
            expect(response.status(), `custom emoji ${n + 1} of 500`).toBeLessThan(300);
            added.push(await emoji.addedId(response));
          }
          expect(await emoji.listEmoji(page)).toHaveLength(500);
        });

        await test.step('Settings → Emoji adds no 501st and names the limit', async () => {
          await emoji.openEmoji(page);
          const add = page.getByRole('button', { name: /^add( custom)? emoji$/i });
          if ((await add.count()) && (await add.isEnabled())) {
            const dialog = await emoji.fillEmoji(page, `qa-${tag}-over`, file);
            await emoji.submitEmoji(dialog);
            await expect(emoji.refusal(dialog), 'the 501st is refused').toBeVisible();
          }
          await expect(page.getByText(/\b500\b/).first(), 'the limit of 500').toBeVisible();
        });

        await test.step('the server refuses a 501st sent directly', async () => {
          const response = await emoji.sendEmoji(page, `qa-${tag}-direct`, file);
          expect(response.status(), 'POST /api/emoji at 500').toBeGreaterThanOrEqual(400);
          expect(await emoji.listEmoji(page)).toHaveLength(500);
        });
      } finally {
        const api = await apiFor(page);
        for (const id of added) await api.send('DELETE', `/api/emoji/${id}`);
      }
    });
  });
});
