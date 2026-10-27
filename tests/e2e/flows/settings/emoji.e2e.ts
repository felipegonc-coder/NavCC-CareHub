import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { PageComments } from '../comments/page-comments.js';
import * as chat from '../messages/messages-page.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen } from '../pages/page-screen.js';
import * as emoji from './emoji-page.js';
import { MB, newPerson, picture } from './settings-data.js';
import { createInviteLink, join } from './settings-page.js';

// Settings and members, Done means 8 and section 7 (SM-12). Avery (the fictional admin) adds the
// custom emoji blue-pine, uses it in a page, a comment and a message, then deletes it, which
// leaves its name as text in all three. The message goes to Sage, someone new who joins for this
// check, so no other check's unread counts move. A blue-pine left over from an earlier run is
// deleted first; the emoji is the workspace's, so the check runs once, on desktop-light. The limit
// of 500 fills the whole workspace up, so it's checked in security.workspace.e2e.ts.

const NAME = 'blue-pine';

test.describe('Settings: custom emoji', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings', 'pages', 'editor', 'comments', 'messages');

  test('SM-12 the custom emoji blue-pine: upload and name rules, used in a page, a comment and a message, and deleting it leaves its name as text', async ({
    page,
    browser,
  }) => {
    test.setTimeout(3 * 60_000);
    await signInAs(page, 'admin');
    await emoji.openEmoji(page, NAME);
    const before = await emoji.emojiRows(page).count();
    let added = false;

    try {
      await test.step('blue-pine is added, with who added it', async () => {
        await emoji.addEmoji(page, NAME, picture(128));
        added = true;
        await expect(emoji.emojiRow(page, NAME)).toBeVisible();
        await expect(emoji.emojiRow(page, NAME)).toContainText('Avery');
      });

      await test.step('names and files that break the rules are refused', async () => {
        const rows = emoji.emojiRows(page);
        const tries: [string, Buffer][] = [
          ['b', picture(64)],
          ['Blue-Pine-QA', picture(64)],
          ['blue pine qa', picture(64)],
          ['blue.pine', picture(64)],
          ['x'.repeat(33), picture(64)],
          [NAME, picture(64)],
          ['blue-pine-big', picture(64, Math.round(1.2 * MB))],
        ];
        for (const [name, file] of tries) {
          const shown = name.slice(0, 40);
          const dialog = await emoji.fillEmoji(page, name, file);
          const typed = await dialog.getByLabel(/^name/i).inputValue();
          if (typed !== name) {
            // The name box itself keeps the rule (it lowercases, or stops at 32 characters).
            expect(typed, `what the box made of "${shown}"`).toMatch(emoji.allowedName);
          } else {
            await emoji.submitEmoji(dialog);
            await expect(emoji.refusal(dialog), `"${shown}" is refused`).toBeVisible();
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          await expect(rows, `nothing added for "${shown}"`).toHaveCount(before + 1);
        }
      });

      const title = uniqueName('Fictional QA emoji page');
      const note = uniqueName('Pine check');
      const pageId = await makePage(page, title);
      const screen = new PageScreen(page);

      await test.step('it can be used in a page', async () => {
        await screen.goto(pageId);
        await screen.typeAtEnd(`${note} `);
        await emoji.insertEmoji(page, NAME);
        await expect(emoji.emojiIn(screen.content, NAME)).toBeVisible();
        await page.reload();
        await expect(emoji.emojiIn(screen.content, NAME)).toBeVisible();
      });

      const comments = new PageComments(page);
      await test.step('in a comment', async () => {
        await comments.box.click();
        await page.keyboard.type(`${note} `);
        await emoji.insertEmoji(page, NAME, emoji.emojiButton(comments.main));
        await page.keyboard.press('Enter');
        await expect(emoji.emojiIn(comments.comment(note), NAME)).toBeVisible();
      });

      const sage = newPerson('Sage');
      await test.step('and in a message to Sage, who joins for this check', async () => {
        const invite = await createInviteLink(page, { role: 'Editor', uses: 1 });
        await (await join(browser, invite, sage)).context().close();
        await chat.openMessages(page);
        await chat.startChatWith(page, [sage.name]);
        await chat.composer(page).click();
        await page.keyboard.type(`${note} `);
        await emoji.insertEmoji(page, NAME, emoji.emojiButton(page.getByRole('main')));
        await page.keyboard.press('Enter');
        await expect(emoji.emojiIn(chat.messageRow(page, note), NAME)).toBeVisible();
      });

      await test.step('deleting it leaves its name as text in all three', async () => {
        await emoji.openEmoji(page);
        await emoji.deleteEmoji(page, NAME);
        added = false;

        await screen.goto(pageId);
        await expect(screen.content).toContainText(emoji.emojiName(NAME));
        await expect(emoji.emojiIn(screen.content, NAME)).toHaveCount(0);
        await expect(comments.comment(note)).toContainText(emoji.emojiName(NAME));
        await expect(emoji.emojiIn(comments.comment(note), NAME)).toHaveCount(0);

        await chat.openMessages(page);
        await chat.openChat(page, sage.name);
        await expect(chat.messageRow(page, note)).toContainText(emoji.emojiName(NAME));
        await expect(emoji.emojiIn(chat.messageRow(page, note), NAME)).toHaveCount(0);
      });
    } finally {
      if (added) {
        await emoji.openEmoji(page);
        await emoji.deleteEmoji(page, NAME);
      }
    }
  });
});
