import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { Editor } from './editor-page.js';

// Pages and blocks, section 6 (Shortcuts): "Ctrl means Cmd on a Mac", and Turn into is
// Cmd+Option+0–9 there. The browser says it runs on a Mac, so the app picks the Mac keys.

const MAC_BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

test.describe('Editor: shortcuts on a Mac', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');
  test.use({ userAgent: MAC_BROWSER });

  test('PB-35 on a Mac the section 6 shortcuts take Cmd, and Cmd+Option+number turns a block into another type', async ({
    page,
  }) => {
    // What pages read to tell a Mac: the platform, and the newer user agent data.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    });
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    const words = (text: string) => editor.content.getByText(text, { exact: true });
    const bold = editor.content.getByRole('strong');

    await test.step('Cmd+B, Cmd+I, Cmd+U, Cmd+Shift+S and Cmd+E format what is typed next', async () => {
      const marks: [keys: string, text: string][] = [
        ['Meta+B', 'bold words'],
        ['Meta+I', 'slanted words'],
        ['Meta+U', 'underlined words'],
        ['Meta+Shift+S', 'struck words'],
        ['Meta+E', 'code words'],
      ];
      for (const [shortcut, text] of marks) {
        await keys.press(shortcut);
        await keys.type(text);
        await keys.press(shortcut);
        await keys.type(' ');
      }
      await expect(bold).toHaveText('bold words');
      await expect(editor.content.getByRole('emphasis')).toHaveText('slanted words');
      expect(await editor.decoration(words('underlined words'))).toContain('underline');
      expect(await editor.decoration(words('struck words'))).toContain('line-through');
      await expect(editor.content.getByRole('code')).toHaveText('code words');
    });

    await test.step('Cmd+Option+2 makes it Heading 2, Cmd+Option+4 a to-do that Cmd+Enter ticks, and Cmd+Option+0 text again', async () => {
      await keys.press('Meta+Alt+Digit2');
      await expect(editor.block('Heading 2')).toHaveCount(1);
      await keys.press('Meta+Alt+Digit4');
      await expect(editor.block('Heading 2')).toHaveCount(0);
      await expect(editor.block('To-do list')).toHaveCount(1);
      await keys.press('Meta+Enter');
      await expect(editor.block('To-do list')).toBeChecked();
      await keys.press('Meta+Alt+Digit0');
      await expect(editor.block('To-do list')).toHaveCount(0);
      await expect(bold).toHaveText('bold words');
    });

    await test.step('Cmd+/ opens the block menu; Cmd+D duplicates the block, Cmd+Z and Cmd+Shift+Z undo and redo it', async () => {
      await keys.press('Meta+/');
      await expect(editor.menu.first()).toBeVisible();
      await keys.press('Escape');
      await expect(editor.menu).toHaveCount(0);
      // Esc selects the block the cursor is in (section 3.3, Selecting).
      await words('slanted words').click();
      await keys.press('Escape');
      await keys.press('Meta+D');
      await expect(bold).toHaveCount(2);
      await keys.press('Meta+Z');
      await expect(bold).toHaveCount(1);
      await keys.press('Meta+Shift+Z');
      await expect(bold).toHaveCount(2);
    });
  });
});
