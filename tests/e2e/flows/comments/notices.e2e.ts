import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { CareHubChat, control } from './care-hub-chat.js';
import { follow, mute } from './following.js';
import { PageComments } from './page-comments.js';
import { Comments, threadsOn } from './threads.js';

// Comments and mentions, section 3.4: the 🔔 chat as inbox, following pages and muted threads.

/** A page in the team space with these paragraphs, open for the person signed in on `page`. */
async function pageWith(page: Page, ...paragraphs: string[]): Promise<string> {
  const id = await makePage(page, uniqueName('Fictional QA intake checklist'));
  const screen = new PageScreen(page);
  await screen.goto(id);
  await screen.title.click();
  await page.keyboard.press('End');
  for (const text of paragraphs) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(text);
  }
  return id;
}

test.describe('Notices: the 🔔 chat as inbox', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'comments', 'notices');

  test('CM-12 the chips sort notices by kind, Unread holds the unread ones, and Mark all as read empties it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    await pageWith(page);
    const notes = [
      uniqueName('Fictional QA please check the address for'),
      uniqueName('Fictional QA and the phone number for'),
    ];
    // Avery's 🔔 chat: other tests open Casey's and Val's in All, which reads new notices at once.
    const avery = await openAs(browser, 'admin');
    try {
      const averyName = await nameOf(avery.page);
      const chat = new CareHubChat(avery.page);

      await test.step('Avery opens the 🔔 chat on Unread', async () => {
        await chat.open();
        await chat.filterBy('Unread');
      });

      await test.step('Eli mentions Avery in two page comments; both arrive in Unread, marked unread', async () => {
        const comments = new PageComments(page);
        for (const note of notes) await comments.addMentioning(averyName, note);
        for (const note of notes) {
          await expect(chat.notice('Open', note)).toBeVisible({ timeout: 10_000 });
          await expect(chat.unread(chat.notice('Open', note))).toHaveCount(1);
        }
      });

      await test.step('Mentions and replies shows them; Following, Reminders and Requests don’t', async () => {
        await chat.filterBy('Mentions and replies');
        for (const note of notes) await expect(chat.shown(note)).toHaveCount(1);
        for (const chip of ['Following', 'Reminders', 'Requests'] as const) {
          await chat.filterBy(chip);
          for (const note of notes) await expect(chat.shown(note)).toHaveCount(0);
        }
      });

      await test.step('Mark all as read takes the dots off and empties Unread', async () => {
        await chat.filterBy('Mentions and replies');
        await expect(chat.markAllAsRead).toBeEnabled();
        await chat.markAllAsRead.click();
        for (const note of notes) {
          await expect(chat.unread(chat.notice('Open', note))).toHaveCount(0);
        }
        await chat.filterBy('Unread');
        for (const note of notes) await expect(chat.shown(note)).toHaveCount(0);
        await chat.filterBy('All');
        for (const note of notes) await expect(chat.shown(note)).toHaveCount(1);
      });
    } finally {
      await avery.close();
    }
  });

  test('CM-12 Reply in a comment notice posts the answer into that comment’s thread', async ({
    page,
    browser,
  }) => {
    needs('noticeReply');
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const id = await pageWith(page);
    const question = uniqueName('Fictional QA can you confirm the refund amount for');
    const answer = uniqueName('Fictional QA confirmed, $40 for');
    const casey = await openAs(browser, 'commenter');
    try {
      const caseyName = await nameOf(casey.page);
      const chat = new CareHubChat(casey.page);
      const comments = new PageComments(page);

      await test.step('Eli mentions Casey in a page comment', async () => {
        await comments.addMentioning(caseyName, question);
        await expect(comments.comment(question)).toContainText(caseyName);
      });

      await test.step('Casey answers with Reply in the 🔔 notice, without leaving the chat', async () => {
        await chat.open();
        const notice = chat.notice('Reply', question);
        await expect(notice).toBeVisible({ timeout: 10_000 });
        await control(notice, 'Reply').click();
        // The reply box may take the Reply button's place, so find the notice by its text.
        await chat
          .shown(question)
          .last()
          .getByRole('textbox')
          .or(casey.page.getByRole('dialog').getByRole('textbox'))
          .first()
          .click();
        await casey.page.keyboard.type(answer);
        await casey.page.keyboard.press('Enter');
        await expect(casey.page).toHaveURL(/\/messages/);
      });

      await test.step('the answer shows in Eli’s thread and is saved there', async () => {
        await expect(comments.comment(answer)).toContainText(question, { timeout: 5_000 });
        await expect
          .poll(async () => {
            const threads = await threadsOn(page, id);
            const thread = threads.find(({ comments: all }) =>
              all.some(({ text }) => text.includes(question)),
            );
            return thread?.comments.map(({ text }) => text);
          })
          .toEqual([expect.stringContaining(question), expect.stringContaining(answer)]);
      });
    } finally {
      await casey.close();
    }
  });

  test('CM-11 a followed page sends a notice for each new comment, except in a thread the person muted', async ({
    page,
    browser,
  }) => {
    needs('following');
    test.setTimeout(150_000);
    await signInAs(page, 'editor');
    const [first, second] = [
      uniqueName('Fictional QA check the ID before the call'),
      uniqueName('Fictional QA read the order back'),
    ];
    const [asked, again, other] = [
      uniqueName('Fictional QA which ID counts?'),
      uniqueName('Fictional QA any photo ID, I think'),
      uniqueName('Fictional QA read it back twice'),
    ];
    const id = await pageWith(page, first, second);
    const casey = await openAs(browser, 'commenter');
    try {
      const chat = new CareHubChat(casey.page);
      const [eli, theirs] = [new Comments(page), new Comments(casey.page)];

      await test.step('Casey follows the page; Eli’s comment on it brings Casey a notice', async () => {
        const screen = new PageScreen(casey.page);
        await screen.goto(id);
        await follow(screen);
        await eli.commentOn(first, asked);
        await chat.open();
        await expect(chat.notice('Open', asked)).toBeVisible({ timeout: 10_000 });
      });

      await test.step('Casey mutes that thread', async () => {
        await new PageScreen(casey.page).goto(id);
        await theirs.openPanel();
        await mute(theirs, asked);
      });

      await test.step('Eli replies in the muted thread and comments elsewhere: only the new comment brings a notice', async () => {
        await eli.openPanel();
        await eli.reply(asked, again);
        await expect(eli.thread(asked)).toContainText(again);
        await eli.commentOn(second, other);
        await chat.open();
        await expect(chat.notice('Open', other)).toBeVisible({ timeout: 10_000 });
        // The reply's notice would have come with the other one; give it 5 seconds more.
        await casey.page.waitForTimeout(5_000);
        await expect(chat.shown(again)).toHaveCount(0);
        await expect(chat.shown(asked)).toHaveCount(1);
      });

      await test.step('both notices are under Following', async () => {
        await chat.filterBy('Following');
        await expect(chat.notice('Open', asked)).toBeVisible();
        await expect(chat.notice('Open', other)).toBeVisible();
      });
    } finally {
      await casey.close();
    }
  });
});
