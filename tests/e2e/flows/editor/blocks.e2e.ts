import AxeBuilder from '@axe-core/playwright';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { Editor, type BlockType } from './editor-page.js';

// Pages and blocks, sections 3.3 to 3.6 and 6: blocks, the "/" menu, Markdown shortcuts and links.

/** Every block in the catalog (section 3.4), with what to type after "/" to find it. */
const CATALOG: [filter: string, title: string | RegExp][] = [
  ['text', 'Text'],
  ['page', 'Page'],
  ['todo', 'To-do list'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['bullet', 'Bulleted list'],
  ['numbered', 'Numbered list'],
  ['toggle', 'Toggle list'],
  ['toggle heading', 'Toggle heading 1'],
  ['toggle heading', 'Toggle heading 2'],
  ['toggle heading', 'Toggle heading 3'],
  ['quote', 'Quote'],
  ['callout', 'Callout'],
  ['divider', 'Divider'],
  ['link to page', 'Link to page'],
  ['table', 'Table'],
  ['columns', /^(\d )?columns$/i],
  ['tabs', 'Tabs'],
  ['image', 'Image'],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['file', 'File'],
  ['pdf', 'PDF'],
  ['bookmark', 'Web bookmark'],
  ['embed', 'Embed'],
  ['code', 'Code'],
  ...[
    'Table',
    'Board',
    'List',
    'Gallery',
    'Calendar',
    'Timeline',
    'Chart',
    'Feed',
    'Dashboard',
  ].map((view): [string, string] => [`${view.toLowerCase()} view`, `${view} view`]),
  ['form', 'Form'],
  ['database full page', /^database,? full page$/i],
  ['linked view', /^linked view( of database)?$/i],
  ['toc', 'Table of contents'],
  ['equation', 'Block equation'],
  ['button', 'Button'],
  ['breadcrumb', 'Breadcrumb'],
  ['synced block', 'Synced block'],
  ['meeting notes', 'Meeting notes'],
];

/** Blocks picked from "/" in PB-01, with the filter that finds each. */
const PICKED: [filter: string, type: BlockType][] = [
  ['h1', 'Heading 1'],
  ['h3', 'Heading 3'],
  ['bullet', 'Bulleted list'],
  ['numbered', 'Numbered list'],
  ['todo', 'To-do list'],
  ['toggle', 'Toggle list'],
  ['quote', 'Quote'],
  ['divider', 'Divider'],
  ['code', 'Code'],
  ['equation', 'Block equation'],
];

/** The Markdown shortcuts of section 3.6 and the block each one makes. */
const SHORTCUTS: [typed: string, type: BlockType][] = [
  ['# ', 'Heading 1'],
  ['## ', 'Heading 2'],
  ['### ', 'Heading 3'],
  ['- ', 'Bulleted list'],
  ['* ', 'Bulleted list'],
  ['+ ', 'Bulleted list'],
  ['1. ', 'Numbered list'],
  ['a. ', 'Numbered list'],
  ['i. ', 'Numbered list'],
  ['> ', 'Toggle list'],
  ['" ', 'Quote'],
  ['$$ ', 'Block equation'],
  ['[]', 'To-do list'],
  ['---', 'Divider'],
  ['```', 'Code'],
];

const [A, B, C] = ['Fictional QA block A', 'Fictional QA block B', 'Fictional QA block C'] as const;

/** Turn into by keys (section 6): Ctrl+Shift+0–9 on Windows and Linux, Cmd+Option+0–9 on a Mac. */
const turnIntoKeys = (digit: number) =>
  process.platform === 'darwin' ? `Meta+Alt+${digit}` : `Control+Shift+${digit}`;

test.describe('Editor: the "/" menu and the block menu', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'slashMenu');

  test('PB-01 every catalog block is in the "/" menu, each Markdown shortcut makes its block, and Ctrl+Z right after turns it back', async ({
    page,
  }) => {
    test.slow(); // About 25 short pages, each opened fresh so one block can't spoil the next.
    await signInAs(page, 'editor');
    const keys = page.keyboard;
    const parentId = await makePage(page, uniqueName('Fictional QA blocks'));
    let editor = await Editor.onNewPage(page, { parentId });
    const clearLine = async () => {
      await keys.press('Shift+Home');
      await keys.press('Backspace');
    };

    await test.step('"/" and a name or another name offers every block in the catalog', async () => {
      for (const [filter, title] of CATALOG) {
        await keys.type(`/${filter}`);
        await expect.soft(editor.option(title), `"/${filter}" offers ${title}`).toBeVisible();
        if (await editor.slashMenu.isVisible()) await keys.press('Escape');
        await clearLine();
      }
    });

    await test.step('↓ and ↑ move through the entries, and Enter picks one', async () => {
      await keys.type('/heading');
      const first = editor.slashMenu.getByRole('option').first();
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await keys.press('ArrowDown');
      await expect(first).not.toHaveAttribute('aria-selected', 'true');
      await keys.press('ArrowUp');
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await keys.press('Enter');
      await expect(editor.content.getByRole('heading')).toBeVisible();
    });

    await test.step('Esc closes the menu and keeps the typed text', async () => {
      editor = await Editor.onNewPage(page, { parentId });
      await keys.type('/quo');
      await expect(editor.slashMenu).toBeVisible();
      await keys.press('Escape');
      await expect(editor.slashMenu).toBeHidden();
      await expect(editor.content).toHaveText('/quo');
      await clearLine();
    });

    await test.step('a name that matches nothing shows "No results", then the menu closes', async () => {
      let sawNoResults = false;
      await keys.type('/');
      for (const letter of 'qzxqzx') {
        await keys.type(letter);
        sawNoResults ||= await editor.slashMenu.getByText('No results').isVisible();
      }
      expect(sawNoResults, '"No results" showed before the menu closed').toBe(true);
      await expect(editor.slashMenu).toBeHidden();
      await expect(editor.content).toHaveText('/qzxqzx');
    });

    await test.step('picking a block from "/" makes it', async () => {
      for (const [filter, type] of PICKED) {
        editor = await Editor.onNewPage(page, { parentId });
        await keys.type(`/${filter}`);
        await editor.option(type).click();
        await expect.soft(editor.block(type), `"/${filter}" makes ${type}`).toBeVisible();
      }
    });

    await test.step('each Markdown shortcut makes its block; Ctrl+Z right after brings back the typed text', async () => {
      for (const [typed, type] of SHORTCUTS) {
        editor = await Editor.onNewPage(page, { parentId });
        await keys.type(typed);
        await expect.soft(editor.block(type), `"${typed}" makes ${type}`).toBeVisible();
        await keys.press('ControlOrMeta+Z');
        await expect.soft(editor.block(type), `Ctrl+Z after "${typed}"`).toHaveCount(0);
        await expect.soft(editor.content, `Ctrl+Z after "${typed}"`).toHaveText(typed.trim());
      }
    });

    await test.step('Suggested lists the 5 blocks used most recently', async () => {
      await keys.press('End');
      await keys.press('Enter');
      await keys.type('/');
      const suggested = editor.slashMenu.getByRole('group', { name: 'Suggested' });
      await expect(suggested.getByRole('option')).toHaveCount(5);
    });
  });

  test('PB-02 Turn into keeps the text, its formatting and the nested blocks; Turn into Page moves them into the new page', async ({
    page,
  }) => {
    const text = 'Fictional QA turn into';
    const nested = 'Fictional QA nested block';
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;

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

    // Types that hold children (section 3.3, Nesting); `holds` says the block's element holds them.
    const types: [type: BlockType, holds: boolean][] = [
      ['To-do list', false],
      ['Bulleted list', true],
      ['Numbered list', true],
      ['Toggle list', false],
      ['Quote', true],
      ['Text', false],
    ];
    for (const [type, holds] of types) {
      await test.step(`Turn into ${type}`, async () => {
        await editor.content.getByText('turn', { exact: true }).click();
        await editor.turnInto(type);
        if (type !== 'Text') await expect.soft(editor.block(type).first()).toBeVisible();
        await expect.soft(editor.content.getByRole('strong')).toHaveText('turn');
        await expect.soft(editor.content).toContainText(text);
        await expect.soft(editor.content).toContainText(nested);
        if (holds) await expect.soft(editor.block(type).filter({ hasText: nested })).toHaveCount(1);
      });
    }

    await test.step('Turn into Page: the text becomes its title and the nested block its content', async () => {
      await editor.content.getByText('turn', { exact: true }).click();
      await editor.turnInto('Page');
      await expect(editor.content).not.toContainText(nested);
      await editor.content.getByText(text).click();
      const sub = new PageScreen(page);
      await sub.expectTitle(text);
      await expect(sub.content).toContainText(nested);
    });
  });

  test('PB-04 blocks selected together are duplicated, moved and deleted as one action that one Ctrl+Z undoes', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    await editor.typeBlocks(A, B, C);

    await test.step('Esc and Shift+↓ select two blocks; Ctrl+D duplicates both, and Ctrl+Z undoes it', async () => {
      await editor.selectBlocks(A, 2);
      await keys.press('ControlOrMeta+D');
      await editor.expectBlocks(A, B, A, B, C);
      await editor.undo();
      await editor.expectBlocks(A, B, C);
    });

    await test.step('Ctrl+Shift+↓ moves both, and Ctrl+Z puts them back', async () => {
      await editor.selectBlocks(A, 2);
      await keys.press('ControlOrMeta+Shift+ArrowDown');
      await editor.expectBlocks(C, A, B);
      await editor.undo();
      await editor.expectBlocks(A, B, C);
    });

    await test.step('the block menu duplicates and deletes the selection, each undone at once', async () => {
      await editor.selectBlocks(A, 2);
      await (await editor.openBlockMenu()).getByRole('menuitem', { name: 'Duplicate' }).click();
      await editor.expectBlocks(A, B, A, B, C);
      await editor.undo();
      await editor.expectBlocks(A, B, C);
      await editor.selectBlocks(A, 2);
      await (await editor.openBlockMenu()).getByRole('menuitem', { name: 'Delete' }).click();
      await editor.expectBlocks(C);
      await editor.undo();
      await editor.expectBlocks(A, B, C);
    });

    await test.step('Shift-click selects a range of blocks; Backspace deletes them, and Ctrl+Z brings them back', async () => {
      await editor.content.getByText(A, { exact: true }).click();
      await editor.content.getByText(C, { exact: true }).click({ modifiers: ['Shift'] });
      await keys.press('Backspace');
      await expect(editor.content).not.toContainText(B);
      await editor.undo();
      await editor.expectBlocks(A, B, C);
    });
  });

  test('PB-35 blocks move by keyboard and by the block menu, moves are announced, and the section 6 shortcuts work', async ({
    page,
  }) => {
    const other = uniqueName('Fictional QA other page');
    await signInAs(page, 'editor');
    const otherId = await makePage(page, other);
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    await editor.typeBlocks(A, B, C);

    await test.step('Ctrl+Shift+↓ and ↑ move the block with the cursor, and the move is announced', async () => {
      await editor.content.getByText(A, { exact: true }).click();
      await keys.press('ControlOrMeta+Shift+ArrowDown');
      await editor.expectBlocks(B, A, C);
      await expect(page.getByRole('status').filter({ hasText: `Moved below '${B}'` })).toHaveCount(
        1,
      );
      await keys.press('ControlOrMeta+Shift+ArrowUp');
      await editor.expectBlocks(A, B, C);
    });

    await test.step('the block menu’s Move to sends a block to the end of another page', async () => {
      await editor.content.getByText(C, { exact: true }).click();
      await (
        await editor.openBlockMenu()
      )
        .getByRole('menuitem', { name: 'Move to', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: /move/i });
      await dialog
        .getByRole('searchbox')
        .or(dialog.getByRole('textbox'))
        .first()
        .fill(other.slice(-6));
      await dialog
        .getByRole('option', { name: literally(other) })
        .or(dialog.getByRole('button', { name: literally(other) }))
        .first()
        .click();
      await editor.expectBlocks(A, B);
      const there = new PageScreen(page);
      await there.goto(otherId);
      await expect(there.content).toContainText(C);
      await page.goBack();
      await editor.expectBlocks(A, B);
    });

    await test.step('Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+S and Ctrl+E format the selected text', async () => {
      const formats: [press: string, text: string][] = [
        ['ControlOrMeta+B', 'Fictional bold'],
        ['ControlOrMeta+I', 'Fictional italic'],
        ['ControlOrMeta+U', 'Fictional underline'],
        ['ControlOrMeta+Shift+S', 'Fictional strikethrough'],
        ['ControlOrMeta+E', 'Fictional code'],
      ];
      // Each word gets its own block first, so no formatting carries over to the next one.
      await editor.content.getByText(B, { exact: true }).click();
      await keys.press('End');
      for (const [, text] of formats) {
        await keys.press('Enter');
        await keys.type(text);
      }
      for (const [press, text] of formats) {
        await editor.content.getByText(text, { exact: true }).click();
        await keys.press('Home');
        await keys.press('Shift+End');
        await keys.press(press);
      }
      const word = (text: string) => editor.content.getByText(text, { exact: true });
      await expect.soft(editor.content.getByRole('strong')).toHaveText('Fictional bold');
      await expect.soft(editor.content.getByRole('emphasis')).toHaveText('Fictional italic');
      await expect.soft(editor.content.getByRole('code')).toHaveText('Fictional code');
      expect.soft(await editor.decoration(word('Fictional underline'))).toContain('underline');
      expect
        .soft(await editor.decoration(word('Fictional strikethrough')))
        .toContain('line-through');
    });

    await test.step('Turn into by keys: 2 a Heading 2, 4 a to-do that Ctrl+Enter ticks, 0 back to text', async () => {
      await editor.content.getByText(A, { exact: true }).click();
      await keys.press(turnIntoKeys(2));
      await expect.soft(editor.block('Heading 2')).toHaveText(A);
      await keys.press(turnIntoKeys(4));
      await expect.soft(editor.block('To-do list')).not.toBeChecked();
      await keys.press('ControlOrMeta+Enter');
      await expect.soft(editor.block('To-do list')).toBeChecked();
      await keys.press(turnIntoKeys(0));
      await expect.soft(editor.block('To-do list')).toHaveCount(0);
      await expect.soft(editor.block('Heading 2')).toHaveCount(0);
    });

    await test.step('axe finds no serious problems on the page', async () => {
      const { violations } = await new AxeBuilder({ page }).include('main').analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  });
});
