import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { choice, nameOf } from '../sharing/share-dialog.js';
import { CareHubChat, control } from './care-hub-chat.js';
import { PageComments } from './page-comments.js';

// Comments and mentions, sections 3.3 and 3.4: @mentions of people and the 🔔 notices they send.

const firstName = (name: string) => name.replace(/\s.*$/, '');

/** Opens a page and puts the cursor in its first block, as Enter in the title does. */
async function startWriting(page: Page, pageId: string): Promise<PageScreen> {
  const screen = new PageScreen(page);
  await screen.goto(pageId);
  await screen.title.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  return screen;
}

/** Types "@" and a first name where the cursor is, then picks the person in the "@" menu. */
async function mention(page: Page, name: string) {
  await page.keyboard.type(`@${firstName(name)}`);
  await choice(page, literally(name)).click();
}

test.describe('Mentions: people in page text and comments', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'comments', 'notices');

  test('CM-08 a mention in page text sends one 🔔 notice with the sentence, and Open goes to the exact spot; a mention deleted within 10 seconds sends nothing', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await signInAs(page, 'editor');
    const id = await makePage(page, uniqueName('Fictional QA huddle notes'));
    const [kept, dropped] = [
      uniqueName('Fictional QA please call back order 1234 with'),
      uniqueName('Fictional QA draft line for'),
    ];
    const casey = await openAs(browser, 'commenter');
    try {
      const caseyName = await nameOf(casey.page);
      const chat = new CareHubChat(casey.page);
      const screen = await startWriting(page, id);

      await test.step('Eli mentions Casey far down the page, and again in a line, deleted at once', async () => {
        for (let line = 1; line <= 40; line += 1) {
          await page.keyboard.type(`Fictional QA filler line ${line}`);
          await page.keyboard.press('Enter');
        }
        await page.keyboard.type(`${kept} `);
        await mention(page, caseyName);
        await page.keyboard.press('Enter');
        await page.keyboard.type(`${dropped} `);
        await mention(page, caseyName);
        // Backspace takes out the space after the mention, then the mention.
        const draft = screen.content.getByRole('paragraph').filter({ hasText: dropped });
        for (let presses = 0; presses < 3; presses += 1) {
          if (!(await draft.textContent())?.includes(caseyName)) break;
          await page.keyboard.press('Backspace');
        }
        await expect(draft).not.toContainText(caseyName);
      });

      await test.step('Casey gets one notice with the sentence (mentions in text wait 10 seconds)', async () => {
        await chat.open();
        await expect(chat.notice('Open', kept)).toBeVisible({ timeout: 30_000 });
        // The deleted mention's notice would have come by now; give it 5 seconds more.
        await casey.page.waitForTimeout(5_000);
        await expect(chat.shown(kept)).toHaveCount(1);
        await expect(chat.shown(dropped)).toHaveCount(0);
      });

      await test.step('Open goes to the exact spot', async () => {
        await control(chat.notice('Open', kept), 'Open').click();
        await expect(casey.page).toHaveURL(literally(`/p/${id}`));
        await expect(new PageScreen(casey.page).content.getByText(kept)).toBeInViewport();
      });
    } finally {
      await casey.close();
    }
  });

  test('CM-08 someone who follows a page and is mentioned in a comment there gets one notice: the mention', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const id = await makePage(page, uniqueName('Fictional QA followed page'));
    const note = uniqueName('Fictional QA can you take this one');
    const casey = await openAs(browser, 'commenter');
    try {
      const caseyName = await nameOf(casey.page);

      await test.step('Casey follows the page from its page menu', async () => {
        const screen = new PageScreen(casey.page);
        await screen.goto(id);
        const follow = { name: /^follow/i };
        const menu = await screen.openPageMenu();
        await menu
          .getByRole('menuitem', follow)
          .or(menu.getByRole('menuitemcheckbox', follow))
          .click();
        const again = await screen.openPageMenu();
        await expect(
          again
            .getByRole('menuitem', { name: /^unfollow/i })
            .or(again.getByRole('menuitemcheckbox', { ...follow, checked: true })),
        ).toBeVisible();
        await casey.page.keyboard.press('Escape');
      });

      await test.step('Eli mentions Casey in a page comment', async () => {
        await new PageScreen(page).goto(id);
        await new PageComments(page).addMentioning(caseyName, note);
      });

      await test.step('Casey gets one notice for that comment', async () => {
        const chat = new CareHubChat(casey.page);
        await chat.open();
        await expect(chat.notice('Open', note)).toBeVisible({ timeout: 10_000 });
        // A second one, for the followed page, would come at the same time.
        await casey.page.waitForTimeout(5_000);
        await expect(chat.shown(note)).toHaveCount(1);
      });
    } finally {
      await casey.close();
    }
  });

  test('CM-09 mentioning someone who can’t open the page asks first: Share with Can view gives access and a notice; Mention without notifying sends nothing', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await signInAs(page, 'editor');
    // Pages in Eli's Private section: nobody else can open them.
    const shared = await makePage(page, uniqueName('Fictional QA private notes'), {
      space: 'Private',
    });
    const quiet = await makePage(page, uniqueName('Fictional QA private draft'), {
      space: 'Private',
    });
    const [asked, unsent] = [
      uniqueName('Fictional QA please review the refund for'),
      uniqueName('Fictional QA just so you know,'),
    ];
    const casey = await openAs(browser, 'commenter');
    const val = await openAs(browser, 'viewer');
    try {
      const [caseyName, valName] = await Promise.all([nameOf(casey.page), nameOf(val.page)]);
      const status = async (who: Page, pageId: string) =>
        (await (await apiFor(who)).send('GET', `/api/pages/${pageId}`)).status();

      await test.step('the "@" menu marks Casey "Can’t open this page", and picking Casey asks first', async () => {
        await startWriting(page, shared);
        await page.keyboard.type(`${asked} @${firstName(caseyName)}`);
        await expect(choice(page, literally(caseyName))).toContainText("Can't open this page");
        await choice(page, literally(caseyName)).click();
        await expect(page.getByText(`${caseyName} can't open this page.`)).toBeVisible();
      });

      await test.step('Share with Can view gives Casey access and a notice with the sentence', async () => {
        await page.getByRole('button', { name: 'Share with Can view' }).click();
        await expect.poll(() => status(casey.page, shared)).toBe(200);
        const chat = new CareHubChat(casey.page);
        await chat.open();
        await expect(chat.notice('Open', asked)).toBeVisible({ timeout: 30_000 });
      });

      await test.step('Mention without notifying keeps the mention, sends Val nothing, and shares nothing', async () => {
        const screen = await startWriting(page, quiet);
        await page.keyboard.type(`${unsent} `);
        await mention(page, valName);
        await page.getByRole('button', { name: 'Mention without notifying' }).click();
        await expect(screen.content).toContainText(valName);
        // A notice for a mention in text would come within 10 seconds.
        await val.page.waitForTimeout(15_000);
        const chat = new CareHubChat(val.page);
        await chat.open();
        await expect(chat.shown(unsent)).toHaveCount(0);
        expect(await status(val.page, quiet)).toBe(403);
      });
    } finally {
      await Promise.all([casey.close(), val.close()]);
    }
  });
});
