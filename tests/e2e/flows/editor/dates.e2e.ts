import type { Locator, Page } from '@playwright/test';
import {
  DEFAULT_TIME_ZONE,
  expect,
  needs,
  onlyIn,
  signInAs,
  test,
  uniqueName,
} from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { literally } from '../pages/page-screen.js';
import { choice } from '../sharing/share-dialog.js';
import { Editor } from './editor-page.js';

// Pages and blocks, section 3.7: dates and reminders in text.

/** "Oct 27" and "1:54pm", as typed after "@", for a moment in the default time zone. */
function typed(at: Date): { day: string; time: string } {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIME_ZONE, ...options }).format(at);
  return {
    day: part({ month: 'short', day: 'numeric' }),
    time: part({ hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase(),
  };
}

/** Types "@" and a date, then picks the date in the "@" menu; returns the chip. */
async function addDate(editor: Editor, words: string, shown: RegExp): Promise<Locator> {
  await editor.page.keyboard.type(`@${words}`);
  await choice(editor.page, shown).click();
  const chip = editor.content
    .getByRole('button', { name: shown })
    .or(editor.content.getByText(shown));
  await expect(chip.first()).toBeVisible();
  return chip.first();
}

/** Opens the chip's picker and sets its reminder, such as "15 minutes before". */
async function remind(page: Page, chip: Locator, when: string) {
  await chip.click();
  await page
    .getByRole('combobox', { name: /remind/i })
    .or(page.getByRole('button', { name: /remind/i }))
    .first()
    .click();
  await choice(page, when).click();
  await page.keyboard.press('Escape');
  await expect(chip).toContainText('⏰');
}

test.describe('Editor: dates and reminders', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'reminders', 'notices');

  test('PB-28 "@tomorrow 9am" makes a date chip, and a reminder 15 minutes before a time arrives in the 🔔 chat on time', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const title = await editor.screen.titleText();

    await test.step('"@tomorrow 9am" makes a chip for tomorrow at 9:00 AM', async () => {
      const tomorrow = typed(new Date(Date.now() + 24 * 60 * 60 * 1000)).day;
      await page.keyboard.type(uniqueName('Fictional QA call the family') + ' ');
      const chip = await addDate(editor, 'tomorrow 9am', /9:00\s?AM/i);
      await expect(chip).toContainText(new RegExp(`tomorrow|${tomorrow}`, 'i'));
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
    });

    // A time 16 to 17 minutes from now, so the reminder 15 minutes before it is due in 1 to 2.
    const at = new Date(Math.ceil((Date.now() + 16 * 60_000) / 60_000) * 60_000);
    const due = at.getTime() - 15 * 60_000;
    const { day, time } = typed(at);

    await test.step('a date with a time gets a reminder 15 minutes before; the chip shows ⏰', async () => {
      await page.keyboard.type(uniqueName('Fictional QA check in with the caller') + ' ');
      const hour = time.replace(/(am|pm)$/, '');
      const chip = await addDate(
        editor,
        `${day} ${time}`,
        new RegExp(`${literally(hour).source}\\s?${time.slice(-2)}`, 'i'),
      );
      await remind(page, chip, '15 minutes before');
    });

    await test.step('the reminder arrives in Eli’s 🔔 chat when it’s due, not before', async () => {
      const chat = new CareHubChat(await page.context().newPage());
      await chat.open();
      const notice = chat.shown(title);
      const early = due - Date.now() - 10_000;
      if (early > 0) {
        await chat.page.waitForTimeout(early);
        await expect(notice).toHaveCount(0);
      }
      await expect(notice.first()).toBeVisible({ timeout: Math.max(due - Date.now(), 0) + 60_000 });
    });
  });
});
