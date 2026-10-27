import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { Comments, selectPart, threadsOn } from './threads.js';

// Comments and mentions, sections 2, 3.1 and 5: text comments, replies, edits, deletes, resolving.

/** A page in the team space with one sentence in it, open for the person signed in on `page`. */
async function pageWithSentence(page: Page, sentence: string): Promise<string> {
  const id = await makePage(page, uniqueName('Fictional QA comments'));
  const screen = new PageScreen(page);
  await screen.goto(id);
  await screen.title.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(sentence);
  return id;
}

test.describe('Comments: threads on text', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'comments');

  test('CM-01 a comment on a sentence and its reply show for both within 2 seconds, and each person can edit or delete their own', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const sentence = uniqueName('Fictional QA refunds over $50 need a second check');
    const [question, answer] = ['Fictional QA who does the second check?', 'Fictional QA Tier 2'];
    const id = await pageWithSentence(page, sentence);
    const casey = await openAs(browser, 'commenter');
    try {
      const [eli, theirs] = [new Comments(page), new Comments(casey.page)];
      await new PageScreen(casey.page).goto(id);
      await theirs.openPanel();

      await test.step('Eli comments on the sentence; Casey sees the thread within 2 seconds', async () => {
        await eli.commentOn(sentence, question);
        await expect(theirs.thread(question)).toContainText(sentence, { timeout: 2_000 });
      });

      await test.step('Casey replies; Eli sees the reply within 2 seconds', async () => {
        await eli.openPanel();
        await theirs.reply(question, answer);
        await expect(eli.thread(question)).toContainText(answer, { timeout: 2_000 });
      });

      await test.step('nobody changes someone else’s comment, and without Full access nobody deletes it (403)', async () => {
        // Eli made the page, so Eli has Full access on it and may delete any comment (section 5).
        const [thread] = await threadsOn(page, id);
        const idOf = (text: string) =>
          thread?.comments.find((each) => each.text.includes(text))?.id;
        const [eliComment, caseyReply] = [idOf(question), idOf(answer)];
        expect([eliComment, caseyReply], 'both comments in GET /api/comments').not.toContain(
          undefined,
        );
        const [asEli, asCasey] = [await apiFor(page), await apiFor(casey.page)];
        const change = { text: 'Fictional QA changed by someone else' };
        expect((await asEli.send('PATCH', `/api/comments/${caseyReply}`, change)).status()).toBe(
          403,
        );
        expect((await asCasey.send('PATCH', `/api/comments/${eliComment}`, change)).status()).toBe(
          403,
        );
        expect((await asCasey.send('DELETE', `/api/comments/${eliComment}`)).status()).toBe(403);
      });

      await test.step('Eli edits Eli’s comment; it shows "edited" for both', async () => {
        const changed = `${question} Fictional QA today`;
        await eli.edit(question, changed);
        await expect(theirs.comment(changed)).toContainText('edited', { timeout: 2_000 });
      });

      await test.step('Casey deletes Casey’s reply; it’s gone for both', async () => {
        await theirs.remove(answer);
        await expect(theirs.thread(question)).not.toContainText(answer);
        await expect(eli.thread(question)).not.toContainText(answer, { timeout: 2_000 });
      });
    } finally {
      await casey.close();
    }
  });

  test('CM-03 resolving hides the highlight and moves the thread to Resolved, a reply there reopens it, and only the starter and editors can resolve', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const sentence = uniqueName('Fictional QA call the customer back before noon');
    const note = 'Fictional QA done for today';
    const id = await pageWithSentence(page, sentence);
    const comments = new Comments(page);
    await comments.commentOn(sentence, note);
    await expect.poll(async () => (await threadsOn(page, id)).length).toBe(1);
    const [thread] = await threadsOn(page, id);

    await test.step('someone with Can comment who didn’t start it can’t resolve it (403)', async () => {
      const casey = await openAs(browser, 'commenter');
      try {
        const api = await apiFor(casey.page);
        const sent = await api.send('PATCH', `/api/comments/threads/${thread?.id}`, {
          resolved: true,
        });
        expect(sent.status()).toBe(403);
      } finally {
        await casey.close();
      }
    });

    await test.step('Resolve takes the highlight away and moves the thread to Resolved', async () => {
      await comments.openPanel();
      await comments.resolve(note);
      await expect(comments.highlight(sentence)).toHaveCount(0);
      await expect(comments.thread(note)).toHaveCount(0);
      await comments.openPanel('Resolved');
      await expect(comments.thread(note)).toContainText(sentence);
    });

    await test.step('a reply from Resolved reopens it, with its highlight', async () => {
      await comments.reply(note, 'Fictional QA one more call needed');
      await comments.openPanel('Open');
      await expect(comments.thread(note)).toContainText('Fictional QA one more call needed');
      await expect(comments.highlight(sentence)).toBeVisible();
    });
  });
});

test.describe('Comments: text that others change', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'coEditing', 'comments');

  test('CM-02 a text comment follows its text through someone else’s edits; deleting the text keeps the thread with the quote, and undo puts it back', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const sentence = uniqueName('Fictional QA refunds go out within 3 days');
    // Avery's cursor and name are drawn inside the text after the change, so the checks below find
    // the sentence by the part before it.
    const [kept, rewritten] = ['Fictional QA refunds go out within', 'within one week'];
    const note = 'Fictional QA is this still right?';
    const id = await pageWithSentence(page, sentence);
    const comments = new Comments(page);
    await comments.commentOn(sentence, note);
    const avery = await openAs(browser, 'admin');
    try {
      await test.step('Avery rewrites part of the sentence; the comment stays on it', async () => {
        const theirs = new Comments(avery.page);
        await theirs.screen.goto(id);
        await theirs.block(sentence).click();
        await selectPart(theirs.block(sentence), '3 days');
        await avery.page.keyboard.type('one week');
        await expect(comments.highlight(`${kept} one week`)).toBeVisible();
        await comments.openPanel();
        await expect(comments.thread(note)).toBeVisible();
      });

      await test.step('deleting the text keeps the thread, with the quote and a note', async () => {
        await comments.screen.content.getByText(rewritten).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Shift+Home');
        await page.keyboard.press('Backspace');
        await expect(comments.thread(note)).toContainText('The text this was on was deleted.');
        await expect(comments.thread(note)).toContainText(kept);
      });

      await test.step('undo brings the text back with its comment', async () => {
        await page.keyboard.press('ControlOrMeta+Z');
        await expect(comments.highlight(`${kept} one week`)).toBeVisible();
        await expect(comments.thread(note)).not.toContainText('The text this was on was deleted.');
      });
    } finally {
      await avery.close();
    }
  });
});
