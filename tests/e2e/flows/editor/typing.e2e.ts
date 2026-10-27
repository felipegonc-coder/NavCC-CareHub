import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { Editor } from './editor-page.js';

// Pages and blocks, sections 3.3 (Nesting), 3.5 (Links) and 6: typing that needs no "/" menu.

test.describe('Editor: nesting and links', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-03 Tab and Shift+Tab nest and un-nest up to 20 levels, only under blocks that can hold children', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    let editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    const level = (n: number) => `Fictional QA level ${n}`;

    await test.step('Tab nests a list item one level deeper each time, down to level 20 and no further', async () => {
      await keys.type(`- ${level(1)}`);
      for (let n = 2; n <= 21; n += 1) {
        await keys.press('Enter');
        await keys.press('Tab');
        await keys.type(level(n));
      }
      await expect.poll(() => editor.depthOf(level(20))).toBe(20);
      await expect.poll(() => editor.depthOf(level(21))).toBe(20);
    });

    await test.step('Shift+Tab takes it out one level', async () => {
      await keys.press('Shift+Tab');
      await expect.poll(() => editor.depthOf(level(21))).toBe(19);
    });

    await test.step('Tab nests a block under a text block, but not under a heading', async () => {
      editor = await Editor.onNewPage(page);
      const [underHeading, underText] = ['Fictional QA under a heading', 'Fictional QA under text'];
      // Nesting shows as indentation: the block's left edge moves right.
      const left = async (text: string) =>
        (await editor.content.getByText(text, { exact: true }).boundingBox())?.x ?? NaN;
      await keys.type('## Fictional QA heading');
      await keys.press('Enter');
      await keys.type(underHeading);
      const start = await left(underHeading);
      await keys.press('Tab');
      await expect.poll(() => left(underHeading)).toBe(start);
      await keys.press('Enter');
      await keys.type(underText);
      await keys.press('Tab');
      await expect.poll(() => left(underText)).toBeGreaterThan(start);
    });
  });

  test('SH-24 Ctrl+K links text to http, https, mailto and tel addresses only; a link opens in a new tab and hovering offers Copy, Edit and Remove', async ({
    page,
  }) => {
    const web = 'https://example.test/fictional-qa';
    await signInAs(page, 'editor');
    await page
      .context()
      .route(`${web}*`, (route) =>
        route.fulfill({ contentType: 'text/html', body: '<title>Fictional QA</title>' }),
      );
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    const linkEditor = page.getByRole('dialog', { name: /link/i });
    const link = (text: string) => editor.content.getByRole('link', { name: text });
    const linkText = async (text: string, address: string) => {
      await keys.type(text);
      await keys.press('Shift+Home');
      await keys.press('ControlOrMeta+K');
      await linkEditor
        .getByRole('combobox')
        .or(linkEditor.getByRole('textbox'))
        .first()
        .fill(address);
      await keys.press('Enter');
    };

    await test.step('https, mailto and tel addresses become links', async () => {
      const links: [text: string, address: string][] = [
        ['Fictional QA web link', web],
        ['Fictional QA mail link', 'mailto:fictional.qa@example.test'],
        ['Fictional QA phone link', 'tel:+15550100'],
      ];
      for (const [text, address] of links) {
        await linkText(text, address);
        await expect(link(text)).toHaveAttribute('href', address);
        await keys.press('End');
        await keys.press('Enter');
      }
    });

    await test.step('a javascript: address is refused, and the text stays plain', async () => {
      await linkText('Fictional QA unsafe link', 'javascript:alert(1)');
      await expect(link('Fictional QA unsafe link')).toHaveCount(0);
      await expect(editor.content).toContainText('Fictional QA unsafe link');
      if (await linkEditor.isVisible()) await keys.press('Escape');
    });

    await test.step('clicking a web link opens it in a new tab', async () => {
      const opened = page.waitForEvent('popup');
      await link('Fictional QA web link').click();
      await expect(await opened).toHaveURL(web);
    });

    await test.step('hovering a link shows its address with Copy, Edit and Remove; Remove unlinks it', async () => {
      await link('Fictional QA web link').hover();
      await expect(page.getByText(web, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
      await page.getByRole('button', { name: 'Remove' }).click();
      await expect(link('Fictional QA web link')).toHaveCount(0);
      await expect(editor.content).toContainText('Fictional QA web link');
    });
  });
});
