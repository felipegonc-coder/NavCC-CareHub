import type { Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { png } from '../import-export/zip-files.js';
import { Editor } from './editor-page.js';

// Pages and blocks, section 6 (Phone): the "/" menu, pictures and the long-press block menu.

/** Holds a finger on an element for 0.8 seconds: a long-press, through Chromium's touch input. */
async function longPress(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Can't long-press: the element isn't shown");
  const point = { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 };
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(800);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
}

test.describe('Editor on a phone', () => {
  onlyIn('phone-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'slashMenu');

  test('PB-36 on a phone the "/" menu works, a picture opens full screen, and a long-press opens the block menu as a sheet', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const line = uniqueName('Fictional QA phone heading');
    const headings = editor.block('Heading 2').filter({ hasText: line });
    const screen = page.viewportSize() ?? { width: 390, height: 844 };

    await test.step('the "/" menu shows on screen and makes a heading', async () => {
      await page.keyboard.type('/h2');
      await expect(editor.slashMenu).toBeInViewport();
      await editor.option('Heading 2').tap();
      await page.keyboard.type(line);
      await expect(headings).toHaveCount(1);
    });

    await test.step('a picture added with "/image" opens full screen, and closes', async () => {
      await page.keyboard.press('Enter');
      await page.keyboard.type('/image');
      const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
      await editor.option('Image').tap();
      // Picking Image may open the file chooser at once, or show the block's Upload first.
      const upload = page.getByRole('button', { name: /^upload/i }).first();
      await upload.waitFor({ timeout: 5_000 }).then(
        () => upload.tap(),
        () => undefined,
      );
      await (
        await chooser
      ).setFiles({
        name: 'Fictional QA photo.png',
        mimeType: 'image/png',
        buffer: png(60, 40, [40, 120, 200]),
      });
      const image = editor.content.locator('img').first();
      // A picture may ask for a description after uploading; it can be skipped (section 3.4).
      await expect(async () => {
        const skip = page.getByRole('button', { name: /^skip/i });
        if (await skip.count()) await skip.first().tap();
        await expect(image).toBeVisible({ timeout: 2_000 });
        await expect(skip).toHaveCount(0);
      }).toPass({ timeout: 60_000 });
      await image.tap();
      const viewer = page.getByRole('dialog').filter({ has: page.locator('img') });
      await expect(viewer).toBeVisible();
      const box = await viewer.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(screen.width - 1);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(screen.height - 1);
      await viewer.getByRole('button', { name: /close/i }).first().tap();
      await expect(viewer).toHaveCount(0);
    });

    await test.step('a long-press on the heading opens its menu as a sheet at the bottom; Duplicate works', async () => {
      await longPress(page, headings.first());
      const sheet = page.getByRole('dialog').or(page.getByRole('menu')).first();
      await expect(sheet).toBeVisible();
      const box = await sheet.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(screen.height - 2);
      const duplicate = { name: /^duplicate/i };
      await sheet
        .getByRole('menuitem', duplicate)
        .or(sheet.getByRole('button', duplicate))
        .first()
        .tap();
      await expect(headings).toHaveCount(2);
    });
  });
});
