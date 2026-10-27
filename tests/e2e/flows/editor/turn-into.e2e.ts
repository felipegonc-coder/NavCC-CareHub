import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { Editor, type BlockType } from './editor-page.js';

// Pages and blocks, section 3.3 (Turn into): the text-like types that blocks.e2e.ts doesn't turn
// a block into: headings, toggle headings, callouts, and Code, which drops the formatting.

test.describe('Editor: Turn into headings, callouts and code', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-02 headings, toggle headings and callouts keep the text, its formatting and the nested block; Code keeps the text without the formatting', async ({
    page,
  }) => {
    const text = 'Fictional QA turn into';
    const nested = 'Fictional QA nested block';
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    const bold = editor.content.getByRole('strong');

    await test.step('a text block with a bold word and a block nested inside it', async () => {
      await keys.type('Fictional QA ');
      await keys.press('ControlOrMeta+B');
      await keys.type('turn');
      await keys.press('ControlOrMeta+B');
      await keys.type(' into');
      await keys.press('Enter');
      await keys.press('Tab');
      await keys.type(nested);
    });

    // `holds`: the block's own element holds the nested block, as a callout holds its blocks.
    const types: [type: BlockType, holds: boolean][] = [
      ['Heading 2', false],
      ['Toggle heading 1', false],
      ['Callout', true],
      ['Heading 3', false],
      ['Text', false],
    ];
    for (const [type, holds] of types) {
      await test.step(`Turn into ${type}`, async () => {
        await editor.content.getByText('turn', { exact: true }).click();
        await editor.turnInto(type);
        if (type !== 'Text') {
          await expect.soft(editor.block(type).filter({ hasText: text })).toHaveCount(1);
        }
        if (type === 'Toggle heading 1') {
          await expect.soft(editor.block('Toggle list').first()).toBeVisible();
        }
        await expect.soft(bold).toHaveText('turn');
        await expect.soft(editor.content).toContainText(text);
        await expect.soft(editor.content).toContainText(nested);
        if (holds) await expect.soft(editor.block(type).filter({ hasText: nested })).toHaveCount(1);
      });
    }

    await test.step('Turn into Code keeps the text and drops the bold', async () => {
      await editor.content.getByText('turn', { exact: true }).click();
      await editor.turnInto('Code');
      await expect(editor.block('Code').filter({ hasText: text })).toHaveCount(1);
      await expect(bold).toHaveCount(0);
      await expect(editor.content).toContainText(nested);
    });
  });
});
