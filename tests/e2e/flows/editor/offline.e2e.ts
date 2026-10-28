import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { openAs, pageIdOf } from '../pages/page-screen.js';
import { Editor } from './editor-page.js';

// Pages and blocks, section 3.12: typing through a dropped connection.

const reconnecting = /^Reconnecting/;

test.describe('Editor: connection drops', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-31 with the network off for 2 minutes typing goes on, and on reconnecting every line is saved once, in order', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(300_000);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const lines = [1, 2, 3, 4, 5].map((line) => uniqueName(`Fictional QA handover note ${line}`));
    const [first, ...rest] = lines;
    await editor.typeBlocks(first ?? '');

    await test.step('offline: "Reconnecting…" shows, and each line shows as it’s typed', async () => {
      await context.setOffline(true);
      const cutAt = Date.now();
      await expect(editor.screen.topBar.getByText(reconnecting)).toBeVisible({ timeout: 10_000 });
      for (const line of rest) {
        await page.keyboard.press('Enter');
        await page.keyboard.type(line);
        await expect(editor.content).toContainText(line);
        await page.waitForTimeout(15_000);
      }
      await page.waitForTimeout(Math.max(0, 120_000 - (Date.now() - cutAt)));
    });

    await test.step('back online, Eli’s other browser shows every line once, in order', async () => {
      await context.setOffline(false);
      await expect(editor.screen.topBar.getByText(reconnecting)).toHaveCount(0, {
        timeout: 30_000,
      });
      const other = await openAs(browser, 'editor');
      try {
        const there = new Editor(other.page);
        await there.screen.goto(pageIdOf(page));
        await there.expectBlocks(...lines);
      } finally {
        await other.close();
      }
    });
  });

  test('PB-31 closing the tab with changes that aren’t sent yet asks first', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    await context.setOffline(true);
    await editor.typeBlocks(uniqueName('Fictional QA not sent yet'));
    const asked = page.waitForEvent('dialog', { timeout: 10_000 });
    await page.close({ runBeforeUnload: true });
    const dialog = await asked;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await expect(editor.content).toContainText('Fictional QA not sent yet');
    await context.setOffline(false);
  });
});
