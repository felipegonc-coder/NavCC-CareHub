import type { Locator } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { Editor } from './editor-page.js';

// Pages and blocks, section 3.3 (Selecting): a box drawn in the margin selects blocks, and
// coloring several selected blocks is one action that one Ctrl+Z undoes (PB-04).

const [A, B, C] = ['Fictional QA box A', 'Fictional QA box B', 'Fictional QA box C'] as const;

/** The color a block's text shows in. */
const colorOf = (text: Locator) => text.evaluate((element) => getComputedStyle(element).color);

test.describe('Editor: the margin box and coloring', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-04 a box drawn from the margin selects blocks, and a color given to several blocks comes and goes as one action', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    await editor.typeBlocks(A, B, C);
    const block = (text: string) => editor.content.getByText(text, { exact: true });

    await test.step('a box drawn from the right margin over two blocks selects both; Backspace deletes them, and Ctrl+Z brings them back', async () => {
      const content = await editor.content.boundingBox();
      const [first, second] = [await block(A).boundingBox(), await block(B).boundingBox()];
      if (!content || !first || !second) throw new Error("The blocks aren't shown");
      const margin = Math.min(
        content.x + content.width + 40,
        (page.viewportSize()?.width ?? 1280) - 8,
      );
      await page.mouse.move(margin, first.y + first.height / 2);
      await page.mouse.down();
      await page.mouse.move(content.x + content.width / 2, second.y + second.height / 2, {
        steps: 10,
      });
      await page.mouse.up();
      await page.keyboard.press('Backspace');
      await editor.expectBlocks(C);
      await editor.undo();
      await editor.expectBlocks(A, B, C);
    });

    await test.step('Color → Red on two selected blocks colors both; one Ctrl+Z takes it off both', async () => {
      const plain = await colorOf(block(C));
      await editor.selectBlocks(A, 2);
      const menu = await editor.openBlockMenu();
      await menu.getByRole('menuitem', { name: /^colou?r$/i }).click();
      await page
        .getByRole('menuitem', { name: 'Red', exact: true })
        .or(page.getByRole('menuitemradio', { name: 'Red', exact: true }))
        .first()
        .click();
      await expect.poll(() => colorOf(block(A))).not.toBe(plain);
      expect(await colorOf(block(B))).toBe(await colorOf(block(A)));
      expect(await colorOf(block(C))).toBe(plain);
      await editor.undo();
      await expect.poll(() => colorOf(block(A))).toBe(plain);
      expect(await colorOf(block(B))).toBe(plain);
    });
  });
});
