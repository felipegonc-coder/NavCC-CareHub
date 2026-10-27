import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { Editor } from '../editor/editor-page.js';
import { PageScreen, openAs, pageIdOf } from '../pages/page-screen.js';
import { FindBar } from './find-bar.js';
import { uniqueWord } from './search-window.js';

// Search, section 3.5: Find in page reaches text in closed toggles; Replace all is one undo step,
// and people with Can view have no Replace. Matches are counted by the bar itself, as a long page
// may not have all its blocks on screen.

test.describe('Search: find and replace in a page', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'search');

  test('SR-14 Ctrl+F on a long page finds the word inside a closed toggle and opens it; Replace all changes all 12 in one undo step; a viewer has no Replace', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    // Made-up words play "refund" and its replacement.
    const word = uniqueWord();
    const replacement = uniqueWord();
    const hidden = `Fictional QA hidden step about ${word}.`;
    const filler = 'Fictional QA filler 1.';
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const find = new FindBar(page);

    await test.step('A long page: 11 lines with the word among 40 others, then a closed toggle with the 12th', async () => {
      const lines = Array.from({ length: 51 }, (_, n) =>
        n % 5 === 0 ? `Fictional QA line ${n} about ${word}.` : `Fictional QA filler ${n}.`,
      );
      await editor.typeBlocks(...lines);
      await page.keyboard.press('Enter');
      await page.keyboard.type('> Fictional QA More steps');
      await page.keyboard.press('Enter');
      await page.keyboard.type(hidden);
      // Into the toggle, if Enter didn't put it there already.
      await page.keyboard.press('Tab');
      await expect(editor.content.getByText(hidden)).toBeVisible();
      await editor.content.getByRole('button', { expanded: true }).click();
      await expect(editor.content.getByText(hidden)).toBeHidden();
    });

    await test.step('Ctrl+F: 12 matches; the last one opens the toggle', async () => {
      await editor.content.getByText(filler, { exact: true }).click();
      await find.open();
      await find.box.fill(word);
      await expect(find.count).toHaveText('1 of 12');
      for (let match = 1; match < 12; match += 1) await page.keyboard.press('Enter');
      await expect(find.count).toHaveText('12 of 12');
      await expect(editor.content.getByRole('button', { expanded: true })).toHaveCount(1);
      await expect(editor.content.getByText(hidden)).toBeVisible();
    });

    await test.step('Replace all: "Replaced 12"; the word is gone and the replacement is there 12 times', async () => {
      await page.keyboard.press('ControlOrMeta+H');
      await find.replaceBox.fill(replacement);
      await find.replaceAll.click();
      await expect(page.getByText(/Replaced 12/)).toBeVisible();
      await expect(find.count).toHaveCount(0);
      await find.box.fill(replacement);
      await expect(find.count).toHaveText('1 of 12');
      await find.box.fill(word);
      await expect(find.count).toHaveCount(0);
      await find.close();
    });

    await test.step('One Ctrl+Z undoes every replacement', async () => {
      await editor.undo();
      await editor.content.getByText(filler, { exact: true }).click();
      await find.open();
      await find.box.fill(word);
      await expect(find.count).toHaveText('1 of 12');
      await find.box.fill(replacement);
      await expect(find.count).toHaveCount(0);
      await find.close();
    });

    await test.step('Val (Can view) gets Find but no Replace', async () => {
      const val = await openAs(browser, 'viewer');
      const theirs = new PageScreen(val.page);
      await theirs.goto(pageIdOf(page));
      await theirs.content.getByText(filler, { exact: true }).click();
      const theirFind = new FindBar(val.page);
      await theirFind.open();
      await theirFind.box.fill(word);
      await expect(theirFind.count).toHaveText('1 of 12');
      await val.page.keyboard.press('ControlOrMeta+H');
      await expect(theirFind.replaceBox).toHaveCount(0);
      await expect(theirFind.bar.getByRole('button', { name: /^replace/i })).toHaveCount(0);
      await val.close();
    });
  });
});
