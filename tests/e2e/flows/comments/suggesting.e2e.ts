import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { Suggestions } from './suggestions.js';
import { selectPart } from './threads.js';

// Comments and mentions, section 3.2: suggested edits, accepted or rejected by people with Can edit.

/** A page in the team space with these paragraphs, open for the person signed in on `page`. */
async function pageWith(page: Page, ...paragraphs: string[]): Promise<PageScreen> {
  const screen = new PageScreen(page);
  await screen.goto(await makePage(page, uniqueName('Fictional QA suggested edits')));
  await screen.title.click();
  await page.keyboard.press('End');
  for (const text of paragraphs) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(text);
  }
  return screen;
}

test.describe('Comments: suggested edits', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'comments', 'suggestedEdits');

  test('CM-05 in Suggesting mode a deleted word and an added sentence show as suggestions by their author; Accept applies one and Reject drops the other', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAs(page, 'editor');
    const sentence = uniqueName('Fictional QA call the family back within 3 days');
    const added = uniqueName('Fictional QA Leave a voicemail if nobody answers.');
    const kept = sentence.replace('back ', '');
    const screen = await pageWith(page, sentence);
    const eliName = await nameOf(page);
    const suggestions = new Suggestions(page);
    const paragraph = (on: PageScreen) =>
      on.content.getByRole('paragraph').filter({ hasText: 'Fictional QA call the family' });

    await test.step('Eli turns on Suggesting; a deleted word stays, struck through', async () => {
      await suggestions.switchTo('Suggesting');
      await paragraph(screen).click();
      await selectPart(paragraph(screen), 'back ');
      await page.keyboard.press('Backspace');
      await expect(suggestions.deletion(eliName, 'back')).toBeVisible();
    });

    await test.step('an added sentence shows underlined', async () => {
      await page.keyboard.press('End');
      await page.keyboard.type(` ${added}`);
      await expect(suggestions.insertion(eliName, added)).toBeVisible();
    });

    await test.step('each has a thread "Suggested by Eli" with Accept and Reject', async () => {
      await suggestions.comments.openPanel();
      for (const text of ['back', added]) {
        const thread = suggestions.thread(text);
        await expect(thread).toContainText(`Suggested by ${eliName}`);
        await expect(thread.getByRole('button', { name: /^accept/i })).toBeVisible();
        await expect(thread.getByRole('button', { name: /^reject/i })).toBeVisible();
      }
    });

    await test.step('Accept takes the word out; Reject drops the sentence', async () => {
      await suggestions.decide('back', 'Accept');
      await expect(suggestions.deletion(eliName, 'back')).toHaveCount(0);
      await expect(paragraph(screen)).not.toContainText('back ');
      await suggestions.decide(added, 'Reject');
      await expect(paragraph(screen)).toHaveText(kept);
      await expect(suggestions.marks).toHaveCount(0);
    });

    await test.step('that is what was saved', async () => {
      await expect(paragraph(await screen.openAgain())).toHaveText(kept);
    });
  });

  test('CM-05 Reject all and Accept all in the panel’s Suggestions filter decide every suggestion at once', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const lines = [
      uniqueName('Fictional QA check the ID'),
      uniqueName('Fictional QA read the order'),
    ];
    const screen = await pageWith(page, ...lines);
    const eliName = await nameOf(page);
    const suggestions = new Suggestions(page);
    const paragraph = (on: PageScreen, line: string) =>
      on.content.getByRole('paragraph').filter({ hasText: line });

    /** Adds words at the end of each line, in Suggesting mode, and returns them. */
    const suggestMore = async () => {
      const more = lines.map(() => uniqueName('Fictional QA twice'));
      for (const [index, line] of lines.entries()) {
        await paragraph(screen, line).click();
        await page.keyboard.press('End');
        await page.keyboard.type(` ${more[index]}`);
        await expect(suggestions.insertion(eliName, more[index] ?? '')).toBeVisible();
      }
      await suggestions.showSuggestions();
      return more;
    };

    await suggestions.switchTo('Suggesting');

    await test.step('Reject all drops both suggestions', async () => {
      await suggestMore();
      await suggestions.comments.panel.getByRole('button', { name: 'Reject all' }).click();
      await expect(suggestions.marks).toHaveCount(0);
      for (const line of lines) await expect(paragraph(screen, line)).toHaveText(line);
    });

    await test.step('Accept all applies both, and that is what was saved', async () => {
      const more = await suggestMore();
      await suggestions.comments.panel.getByRole('button', { name: 'Accept all' }).click();
      await expect(suggestions.marks).toHaveCount(0);
      const again = await screen.openAgain();
      for (const [index, line] of lines.entries()) {
        await expect(paragraph(screen, line)).toHaveText(`${line} ${more[index]}`);
        await expect(paragraph(again, line)).toHaveText(`${line} ${more[index]}`);
      }
    });
  });
});
