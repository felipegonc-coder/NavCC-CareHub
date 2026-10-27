import type { Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';

// Pages and blocks, sections 3.1 (Presence) and 3.12 (Live co-editing): two people, one paragraph.

/**
 * A block's own text, without what the editor draws into it: other people's cursors and their
 * name labels are drawn inside the text but can't be edited (contenteditable="false").
 */
function typedText(block: Locator): Promise<string> {
  return block.evaluate((element) => {
    const copy = element.cloneNode(true) as Element;
    for (const drawn of copy.querySelectorAll('[contenteditable="false"]')) drawn.remove();
    return (copy.textContent ?? '').replace(/\u2060/g, '');
  });
}

/** Someone else's cursor in the text: a mark in their colour with their first name (section 3.1). */
function cursorOf(screen: PageScreen, firstName: string): Locator {
  return screen.content.getByText(firstName, { exact: true });
}

/**
 * Ctrl+Z until the block reads `goal`. Typing comes back in runs, so one press may not take back
 * all of it; each press must change something, and 5 presses at most.
 */
async function undoUntil(page: Page, block: Locator, goal: string) {
  for (let presses = 0; presses < 5 && (await typedText(block)) !== goal; presses += 1) {
    const before = await typedText(block);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => typedText(block)).not.toBe(before);
  }
  expect(await typedText(block)).toBe(goal);
}

test.describe('Editor: two people in one page', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'coEditing');

  test('PB-30 two people typing in the same paragraph lose no letters, see each other’s named cursor, and Ctrl+Z undoes only their own typing', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'editor');
    const id = await makePage(page, uniqueName('Fictional QA Weekly huddle – Oct 27'));
    const other = await openAs(browser, 'admin');
    try {
      const [eli, avery] = [new PageScreen(page), new PageScreen(other.page)];
      const first = async (who: Page) => (await nameOf(who)).replace(/\s.*$/, '');
      const [eliFirst, averyFirst] = [await first(page), await first(other.page)];
      const start = 'Fictional QA huddle notes';
      const [eliTyping, averyTyping] = [' and the refund queue is clear', 'Agenda for Monday: '];
      const paragraph = (screen: PageScreen) =>
        screen.content.getByRole('paragraph').filter({ hasText: start });
      const [eliBlock, averyBlock] = [paragraph(eli), paragraph(avery)];

      await test.step('both have the page open on one paragraph', async () => {
        await eli.goto(id);
        await avery.goto(id);
        await eli.title.click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(start);
        await expect.poll(() => typedText(averyBlock)).toBe(start);
        // Eli's cursor stays at the end; Avery's goes to the start of the same paragraph.
        await averyBlock.click();
        await other.page.keyboard.press('Home');
      });

      await test.step('they type at the same time and see each other’s cursor with a first name', async () => {
        await Promise.all([
          page.keyboard.type(eliTyping, { delay: 60 }),
          other.page.keyboard.type(averyTyping, { delay: 60 }),
          expect(cursorOf(eli, averyFirst)).toBeVisible(),
          expect(cursorOf(avery, eliFirst)).toBeVisible(),
        ]);
      });

      await test.step('no letter is lost: both see the whole paragraph, the same', async () => {
        const whole = `${averyTyping}${start}${eliTyping}`;
        await expect.poll(() => typedText(eliBlock)).toBe(whole);
        await expect.poll(() => typedText(averyBlock)).toBe(whole);
      });

      await test.step('Eli’s Ctrl+Z takes back only Eli’s typing', async () => {
        await undoUntil(page, eliBlock, `${averyTyping}${start}`);
        await expect.poll(() => typedText(averyBlock)).toBe(`${averyTyping}${start}`);
      });

      await test.step('Avery’s Ctrl+Z takes back only Avery’s typing', async () => {
        await undoUntil(other.page, averyBlock, start);
        await expect.poll(() => typedText(eliBlock)).toBe(start);
      });
    } finally {
      await other.close();
    }
  });
});
