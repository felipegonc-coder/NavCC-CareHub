import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { Editor } from './editor-page.js';

// Pages and blocks, sections 3.3 (Nesting), 3.5 (Links) and 6: typing that needs no "/" menu.

test.describe('Editor: nesting', () => {
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
});

test.describe('Editor: links', () => {
  onlyIn('desktop-light');
  // The link editor finds Care Hub pages with the same search as everywhere (Search, section 3.1).
  needs('signIn', 'appShell', 'pages', 'editor', 'search');

  test('PB-40 Ctrl+K links selected text to a web address or a searched Care Hub page; hovering offers Edit and Remove; Care Hub links open in the same tab, web links in a new one', async ({
    page,
  }) => {
    const web = 'https://example.test/fictional-qa';
    const edited = 'https://example.test/fictional-qa-edited';
    const target = uniqueName('Fictional QA link target');
    await signInAs(page, 'editor');
    const targetId = await makePage(page, target);
    await page
      .context()
      .route('https://example.test/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<title>Fictional QA</title>' }),
      );
    const editor = await Editor.onNewPage(page);
    const keys = page.keyboard;
    const linkEditor = page.getByRole('dialog', { name: /link/i });
    const linkBox = linkEditor.getByRole('combobox').or(linkEditor.getByRole('textbox')).first();
    const link = (text: string) => editor.content.getByRole('link', { name: text });
    /** Types the text, selects it and presses Ctrl+K. */
    const selectAndLink = async (text: string) => {
      await keys.type(text);
      await keys.press('Shift+Home');
      await keys.press('ControlOrMeta+K');
      await expect(linkBox).toBeVisible();
    };
    /** A new line after a block's text. */
    const newLineAfter = async (text: string) => {
      await editor.content.getByText(text).click();
      await keys.press('End');
      await keys.press('Enter');
    };

    await test.step('https, mailto and tel addresses become links', async () => {
      const links: [text: string, address: string][] = [
        ['Fictional QA web link', web],
        ['Fictional QA mail link', 'mailto:fictional.qa@example.test'],
        ['Fictional QA phone link', 'tel:+15550100'],
      ];
      for (const [text, address] of links) {
        await selectAndLink(text);
        await linkBox.fill(address);
        await keys.press('Enter');
        await expect(link(text)).toHaveAttribute('href', address);
        await newLineAfter(text);
      }
    });

    await test.step('a javascript: address is refused, and the text stays plain', async () => {
      await selectAndLink('Fictional QA unsafe link');
      await linkBox.fill('javascript:alert(1)');
      await keys.press('Enter');
      await expect(link('Fictional QA unsafe link')).toHaveCount(0);
      await expect(editor.content).toContainText('Fictional QA unsafe link');
      if (await linkEditor.isVisible()) await keys.press('Escape');
    });

    await test.step('typing a title in the link editor finds the Care Hub page, and picking it links to it', async () => {
      await newLineAfter('Fictional QA unsafe link');
      await selectAndLink('Fictional QA page link');
      await linkBox.fill(target);
      await linkEditor.getByRole('option', { name: literally(target) }).click();
      await expect(link('Fictional QA page link')).toHaveAttribute(
        'href',
        new RegExp(`/p/${targetId}$`),
      );
    });

    await test.step('hovering a link shows its address with Copy, Edit and Remove; Edit changes the address', async () => {
      await link('Fictional QA web link').hover();
      await expect(page.getByText(web, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
      await page.getByRole('button', { name: 'Edit' }).click();
      await linkBox.fill(edited);
      await keys.press('Enter');
      await expect(link('Fictional QA web link')).toHaveAttribute('href', edited);
    });

    await test.step('clicking a web link opens it in a new tab', async () => {
      const opened = page.waitForEvent('popup');
      await link('Fictional QA web link').click();
      await expect(await opened).toHaveURL(edited);
    });

    await test.step('Remove unlinks the text and keeps it', async () => {
      await link('Fictional QA mail link').hover();
      await page.getByRole('button', { name: 'Remove' }).click();
      await expect(link('Fictional QA mail link')).toHaveCount(0);
      await expect(editor.content).toContainText('Fictional QA mail link');
    });

    await test.step('clicking a Care Hub link opens the page in the same tab', async () => {
      let newTabs = 0;
      page.context().on('page', () => (newTabs += 1));
      await link('Fictional QA page link').click();
      await expect(page).toHaveURL(new RegExp(`/p/${targetId}$`));
      await new PageScreen(page).expectTitle(target);
      expect(newTabs).toBe(0);
    });
  });
});
