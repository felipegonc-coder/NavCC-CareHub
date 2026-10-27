import type { Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { png } from '../import-export/zip-files.js';
import { hasLocation, pictures, type TestFile } from '../messages/files.js';
import { makePage } from '../pages/page-data.js';
import { Editor } from './editor-page.js';

// Pages and blocks, sections 3.8 (Copy and paste) and 3.11 (Files): what comes in from outside.

/** Puts rich text (HTML) and plain text on the clipboard, as another app's Copy would. */
async function copyFromAnotherApp(page: Page, copied: { html?: string; text: string }) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async ({ html, text }) => {
    const kinds: Record<string, Blob> = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
    if (html) kinds['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(kinds)]);
  }, copied);
}

/** Drops files from the computer on an element, at its middle (dragenter, dragover, drop). */
async function dropFiles(target: Locator, files: TestFile[]) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Can't drop the files: the place to drop them isn't shown");
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  const sent = files.map(({ name, mimeType, buffer }) => ({
    name,
    mimeType,
    base64: buffer.toString('base64'),
  }));
  const dataTransfer = await target.page().evaluateHandle((each) => {
    const transfer = new DataTransfer();
    for (const file of each) {
      const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
    }
    return transfer;
  }, sent);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await target.dispatchEvent(type, { dataTransfer, ...at });
  }
}

const weight = (text: Locator) => text.evaluate((element) => getComputedStyle(element).fontWeight);
const slant = (text: Locator) => text.evaluate((element) => getComputedStyle(element).fontStyle);

/** A section copied from a Google Docs file: Docs marks bold and links with inline styles. */
function googleDocsSection(words: Record<'heading' | 'bold' | 'item1' | 'item2' | 'link', string>) {
  const span = (text: string, style = 'font-weight:400;') =>
    `<span style="font-size:11pt;font-family:Arial,sans-serif;${style}">${text}</span>`;
  const item = (text: string) =>
    `<li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation">${span(text)}</p></li>`;
  const cell = (text: string) =>
    `<td style="border:solid #000000 1pt;padding:5pt;"><p dir="ltr">${span(text)}</p></td>`;
  const html =
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-fictional-qa">' +
    `<h1 dir="ltr" style="margin-top:20pt;">${span(words.heading, 'font-size:20pt;font-weight:400;')}</h1>` +
    `<p dir="ltr">${span(words.bold, 'font-weight:700;')}${span(' comes first.')}</p>` +
    `<ul style="margin-top:0;">${item(words.item1)}${item(words.item2)}</ul>` +
    '<div dir="ltr" align="left"><table style="border-collapse:collapse;"><tbody>' +
    `<tr>${cell('Fictional QA step')}${cell('Fictional QA owner')}</tr>` +
    `<tr>${cell('Fictional QA check the order')}${cell('Fictional QA Tier 1')}</tr>` +
    '</tbody></table></div>' +
    `<p dir="ltr"><a href="https://example.test/refund-policy" style="text-decoration:none;">${span(
      words.link,
      'color:#1155cc;text-decoration:underline;',
    )}</a></p></b>`;
  const text = [
    words.heading,
    `${words.bold} comes first.`,
    words.item1,
    words.item2,
    'Fictional QA step\tFictional QA owner',
    'Fictional QA check the order\tFictional QA Tier 1',
    words.link,
  ].join('\n');
  return { html, text };
}

test.describe('Editor: pasting from other apps', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-25 pasting from a Google Docs file and a web page keeps the structure, Markdown text makes blocks, and Ctrl+Shift+V pastes plain text', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const words = {
      heading: uniqueName('Fictional QA Refund steps'),
      bold: 'Fictional QA the order number',
      item1: 'Fictional QA find the order',
      item2: 'Fictional QA check the amount',
      link: 'Fictional QA refund policy',
    };
    const fromDocs = googleDocsSection(words);

    await test.step('a Google Docs section keeps its heading, bold text, list, table and link', async () => {
      const editor = await Editor.onNewPage(page);
      await copyFromAnotherApp(page, fromDocs);
      await page.keyboard.press('ControlOrMeta+V');
      const content = editor.content;
      await expect(content.getByRole('heading', { name: words.heading })).toBeVisible();
      expect(
        Number(await weight(content.getByText(words.bold, { exact: true }))),
      ).toBeGreaterThanOrEqual(600);
      await expect(editor.block('Bulleted list').filter({ hasText: words.item1 })).toBeVisible();
      await expect(editor.block('Bulleted list').filter({ hasText: words.item2 })).toBeVisible();
      const table = content.getByRole('table');
      await expect(table.getByRole('row')).toHaveCount(2);
      await expect(table).toContainText('Fictional QA check the order');
      await expect(content.getByRole('link', { name: words.link })).toHaveAttribute(
        'href',
        'https://example.test/refund-policy',
      );
    });

    await test.step('Ctrl+Shift+V pastes the same section as plain text', async () => {
      const editor = await Editor.onNewPage(page);
      await copyFromAnotherApp(page, fromDocs);
      await page.keyboard.press('ControlOrMeta+Shift+V');
      const content = editor.content;
      for (const text of Object.values(words)) await expect(content).toContainText(text);
      await expect(content.getByRole('heading')).toHaveCount(0);
      await expect(content.getByRole('listitem')).toHaveCount(0);
      await expect(content.getByRole('table')).toHaveCount(0);
      await expect(content.getByRole('link')).toHaveCount(0);
      expect(Number(await weight(content.getByText(words.bold)))).toBeLessThan(600);
    });

    await test.step('a web page keeps its heading, numbered list, table, link, bold and italic', async () => {
      const editor = await Editor.onNewPage(page);
      const heading = uniqueName('Fictional QA web steps');
      const html =
        `<h2>${heading}</h2><ol><li>Fictional QA open the ticket</li><li>Fictional QA reply</li></ol>` +
        '<table><thead><tr><th>Fictional QA queue</th><th>Fictional QA wait</th></tr></thead>' +
        '<tbody><tr><td>Fictional QA billing</td><td>Fictional QA 2 minutes</td></tr></tbody></table>' +
        '<p>Read <strong>Fictional QA bold words</strong>, <em>Fictional QA slanted words</em> and ' +
        '<a href="https://example.test/help">Fictional QA help page</a>.</p>';
      await copyFromAnotherApp(page, { html, text: heading });
      await page.keyboard.press('ControlOrMeta+V');
      const content = editor.content;
      await expect(content.getByRole('heading', { name: heading })).toBeVisible();
      await expect(editor.block('Numbered list')).toHaveText([
        'Fictional QA open the ticket',
        'Fictional QA reply',
      ]);
      await expect(content.getByRole('table').getByRole('row')).toHaveCount(2);
      await expect(content.getByRole('link', { name: 'Fictional QA help page' })).toHaveAttribute(
        'href',
        'https://example.test/help',
      );
      expect(
        Number(await weight(content.getByText('Fictional QA bold words'))),
      ).toBeGreaterThanOrEqual(600);
      expect(await slant(content.getByText('Fictional QA slanted words'))).toBe('italic');
    });

    await test.step('Markdown text makes blocks', async () => {
      const editor = await Editor.onNewPage(page);
      const heading = uniqueName('Fictional QA Markdown steps');
      const text = [
        `## ${heading}`,
        '',
        '- Fictional QA first point',
        '- Fictional QA second point',
        '',
        '1. Fictional QA numbered step',
        '',
        '> Fictional QA quoted line',
        '',
        'See [Fictional QA linked page](https://example.test/markdown) and **Fictional QA strong words**.',
      ].join('\n');
      await copyFromAnotherApp(page, { text });
      await page.keyboard.press('ControlOrMeta+V');
      const content = editor.content;
      await expect(editor.block('Heading 2').filter({ hasText: heading })).toBeVisible();
      await expect(editor.block('Bulleted list')).toHaveText([
        'Fictional QA first point',
        'Fictional QA second point',
      ]);
      await expect(editor.block('Numbered list')).toHaveText(['Fictional QA numbered step']);
      await expect(editor.block('Quote')).toHaveText('Fictional QA quoted line');
      await expect(content.getByRole('link', { name: 'Fictional QA linked page' })).toHaveAttribute(
        'href',
        'https://example.test/markdown',
      );
      expect(
        Number(await weight(content.getByText('Fictional QA strong words'))),
      ).toBeGreaterThanOrEqual(600);
      await expect(content).not.toContainText('## ');
      await expect(content).not.toContainText('**');
    });
  });

  test('PB-26 a pasted Care Hub page link becomes a page mention; a pasted web link stays a link and offers Mention, Bookmark and Embed', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional QA refund steps');
    const pageId = await makePage(page, title);
    const editor = await Editor.onNewPage(page);
    // YouTube is on the starter list of approved sites (section 3.10); the video is made up.
    const video = 'https://www.youtube.com/watch?v=FictionalQA';

    await test.step('the Care Hub link becomes a mention that shows the page’s title', async () => {
      await copyFromAnotherApp(page, { text: new URL(`/p/${pageId}`, page.url()).href });
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.content.getByText(title)).toBeVisible();
      await expect(editor.content).not.toContainText(`/p/${pageId}`);
    });

    await test.step('the web link pastes as a link, with Mention, Bookmark, Embed and Dismiss', async () => {
      await page.keyboard.press('Enter');
      await copyFromAnotherApp(page, { text: video });
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.content.getByRole('link', { name: video })).toBeVisible();
      const offer = (name: string) =>
        page
          .getByRole('menuitem', { name, exact: true })
          .or(page.getByRole('button', { name, exact: true }));
      for (const name of ['Mention', 'Bookmark', 'Embed']) await expect(offer(name)).toBeVisible();
      await offer('Dismiss').click();
      await expect(offer('Bookmark')).toHaveCount(0);
      await expect(editor.content.getByRole('link', { name: video })).toBeVisible();
    });
  });
});

test.describe('Editor: files dropped from the computer', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor');

  test('PB-06 dropping 3 pictures makes 3 image blocks in the same order, and the stored files have no location', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    // Three sizes tell the pictures apart, whatever the server does to their bytes. The first one
    // is a photo with a made-up GPS position in it.
    const files: TestFile[] = [
      ...pictures('Fictional QA photo').slice(0, 1),
      {
        name: 'Fictional QA photo 2.png',
        mimeType: 'image/png',
        buffer: png(40, 20, [240, 150, 40]),
      },
      {
        name: 'Fictional QA photo 3.png',
        mimeType: 'image/png',
        buffer: png(20, 40, [40, 160, 90]),
      },
    ];
    const images = editor.content.locator('img');

    await test.step('dropping them on the page makes 3 image blocks', async () => {
      await dropFiles(editor.content.getByRole('paragraph').first(), files);
      // A picture may ask for a description after uploading; it can be skipped (section 3.4).
      await expect(async () => {
        const skip = page.getByRole('button', { name: /^skip/i });
        if (await skip.count()) await skip.first().click();
        await expect(images).toHaveCount(3, { timeout: 2_000 });
        await expect(skip).toHaveCount(0);
      }).toPass({ timeout: 60_000 });
    });

    await test.step('in the order they were dropped', async () => {
      const sizes = () =>
        images.evaluateAll((shown: HTMLImageElement[]) =>
          shown.map((image) => `${image.naturalWidth}x${image.naturalHeight}`),
        );
      await expect.poll(sizes, { timeout: 30_000 }).toEqual(['24x16', '40x20', '20x40']);
    });

    await test.step('the stored files have no location in them', async () => {
      const addresses = () =>
        images.evaluateAll((shown: HTMLImageElement[]) =>
          shown.map((image) => image.currentSrc || image.src),
        );
      // Each picture shows from its stored file once its upload is done (Files, /api/files/:id).
      await expect
        .poll(async () => (await addresses()).every((address) => address.includes('/api/files/')), {
          timeout: 30_000,
        })
        .toBe(true);
      for (const address of await addresses()) {
        const stored = await page.request.get(address);
        expect(stored.ok()).toBe(true);
        expect(hasLocation(await stored.body())).toBe(false);
      }
    });
  });
});
