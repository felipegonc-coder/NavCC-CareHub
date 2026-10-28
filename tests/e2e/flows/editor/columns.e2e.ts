import type { Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { Editor } from './editor-page.js';

// Pages and blocks, section 3.3 (Dragging) and the Columns block: blocks side by side.

/**
 * Drags a block by its ⋮⋮ handle (shown on hover, left of the block) and drops it at the right
 * edge of another block, in small steps so the drop line can follow.
 */
async function dropAtRightEdge(page: Page, moved: Locator, target: Locator) {
  await moved.hover();
  const handle = page
    .getByRole('button', { name: /drag|block menu|block actions/i })
    .filter({ visible: true })
    .first();
  const [from, to] = [await handle.boundingBox(), await target.boundingBox()];
  if (!from || !to) throw new Error("Can't drag: the handle or the block isn't shown");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

type Box = { x: number; y: number; width: number; height: number };

/** Where each block is on screen, once all of them are shown. */
async function boxesOf(blocks: Locator[]): Promise<Box[] | null> {
  const boxes = await Promise.all(blocks.map((block) => block.boundingBox()));
  const shown = boxes.filter((box): box is Box => box !== null);
  return shown.length === blocks.length ? shown : null;
}

/** Each block sits to the right of the one before it, on the same line. */
async function expectSideBySide(...blocks: Locator[]) {
  await expect
    .poll(async () => {
      const boxes = await boxesOf(blocks);
      return (
        !!boxes &&
        boxes.slice(1).every((box, index) => {
          const before = boxes[index];
          return !!before && Math.abs(box.y - before.y) < 8 && box.x > before.x + before.width / 2;
        })
      );
    })
    .toBe(true);
}

/** Each block sits below the one before it. */
async function expectStacked(...blocks: Locator[]) {
  await expect
    .poll(async () => {
      const boxes = await boxesOf(blocks);
      return (
        !!boxes &&
        boxes.slice(1).every((box, index) => {
          const before = boxes[index];
          return !!before && box.y >= before.y + before.height - 1;
        })
      );
    })
    .toBe(true);
}

test.describe('Editor: columns', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-05 a block dropped at another block’s right edge makes 2 columns, then 3, saved; on a 390 px wide screen they stack in order', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const [left, middle, right] = [
      uniqueName('Fictional QA left column'),
      uniqueName('Fictional QA middle column'),
      uniqueName('Fictional QA right column'),
    ];
    await editor.typeBlocks(left, middle, right);
    const block = (on: Editor, text: string) => on.content.getByText(text, { exact: true });

    await test.step('the second block dropped at the first one’s right edge makes 2 columns', async () => {
      await dropAtRightEdge(page, block(editor, middle), block(editor, left));
      await expectSideBySide(block(editor, left), block(editor, middle));
    });

    await test.step('the third block dropped at the second one’s right edge makes 3', async () => {
      await dropAtRightEdge(page, block(editor, right), block(editor, middle));
      await expectSideBySide(block(editor, left), block(editor, middle), block(editor, right));
    });

    await test.step('the columns are saved', async () => {
      const again = new Editor((await editor.screen.openAgain()).page);
      await expectSideBySide(block(again, left), block(again, middle), block(again, right));
      await again.page.close();
    });

    await test.step('390 px wide, the columns stack from left to right', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expectStacked(block(editor, left), block(editor, middle), block(editor, right));
    });
  });
});
