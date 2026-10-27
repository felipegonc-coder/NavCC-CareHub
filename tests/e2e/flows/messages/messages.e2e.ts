import { readFile } from 'node:fs/promises';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { hasLocation, pdf, pictures, svg } from './files.js';
import {
  addPeople,
  attach,
  changeLine,
  chatMenuButton,
  chatRow,
  chooseInChatMenu,
  composer,
  createPrivatePage,
  escape,
  firstName,
  message,
  messageRow,
  messagesBadge,
  noticesIntro,
  openChat,
  openMessages,
  send,
  sharePage,
  shownPicture,
  startChat,
  startsWith,
  steadyBadge,
  windowFor,
  word,
} from './messages-page.js';

// Messages spec, Done means and section 7. Avery (the seeded admin) does most of the sending; Eli,
// Casey and Val play Sam, Riley and Jordan. Every text, chat and page gets a unique name, because
// the database is shared by the whole run.

test.describe('Messages', () => {
  onlyIn('desktop-light');
  // The flows share the seeded people's chats and unread counts, so they run one after another.
  test.describe.configure({ mode: 'default' });

  test.describe('🔔 Care Hub chat', () => {
    needs('signIn', 'messages', 'notices');

    test("MS-09 the 🔔 chat is first, has no message box, can't be left, and a notice shows a card and buttons", async ({
      page,
    }) => {
      await signInAs(page, 'editor');
      const main = await openMessages(page);

      await test.step('it stays first, above a chat with a newer message', async () => {
        await startChat(page, ['commenter']);
        await send(page, uniqueName('Fictional QA hello'));
        const careHub = await chatRow(page, 'Care Hub').boundingBox();
        const newest = await chatRow(page, firstName.commenter).boundingBox();
        expect(careHub, 'the 🔔 Care Hub row').not.toBeNull();
        expect(newest, "Casey's chat row").not.toBeNull();
        expect(careHub?.y ?? Infinity).toBeLessThan(newest?.y ?? -Infinity);
      });

      await test.step('it has no message box and says what it is for', async () => {
        await openChat(page, 'Care Hub');
        await expect(main.getByText(noticesIntro)).toBeVisible();
        await expect(composer(page)).toHaveCount(0);
        for (const name of ['Send', 'Attach', 'Share page']) {
          await expect(main.getByRole('button', { name, exact: true })).toHaveCount(0);
        }
      });

      await test.step("it can't be left or renamed, only muted", async () => {
        await expect(main.getByRole('button', { name: /^Leave\b/ })).toHaveCount(0);
        if ((await chatMenuButton(page).count()) > 0) {
          await chatMenuButton(page).click();
          await expect(page.getByRole('menuitem', { name: /^Mute\b/ })).toBeVisible();
          await expect(page.getByRole('menuitem', { name: /^Leave\b/ })).toHaveCount(0);
          await expect(page.getByRole('menuitem', { name: /^Rename\b/ })).toHaveCount(0);
          await page.keyboard.press('Escape');
        }
      });

      await test.step('a notice shows a page or event card and buttons', async () => {
        // Notices have no create route (docs/team/testing.md), so this uses the seeded ones.
        const card = page.locator('a[href^="/p/"], a[href^="/calendar"], a[href^="/meetings"]');
        const notice = main
          .getByRole('article')
          .or(main.getByRole('listitem'))
          .filter({ has: card })
          .filter({ has: page.getByRole('button') });
        await expect(notice.first()).toBeVisible();
      });
    });
  });

  test.describe('Direct and group chats', () => {
    needs('signIn', 'messages');

    test('MS-01 a message shows in the open chat within 1 second; with the chat closed the badge goes up, and opening it clears it', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'admin');
      await openMessages(page);
      const eli = await windowFor(browser, 'editor');
      await startChat(eli, ['admin']);
      await startChat(page, ['editor']);

      await test.step("Avery's message shows in Eli's open chat within 1 second", async () => {
        const text = uniqueName('Can you cover the 2 PM queue? Ref');
        await composer(page).fill(text);
        const sentAt = Date.now();
        await composer(page).press('Enter');
        await message(eli, text).waitFor({ timeout: 10_000 });
        expect(Date.now() - sentAt, 'milliseconds until Eli saw it').toBeLessThanOrEqual(1_000);
      });

      const later = uniqueName('Fictional QA follow-up: the 2 PM queue is covered');
      const peak = await test.step("with the chat closed, Eli's badge goes up", async () => {
        await openChat(eli, 'Care Hub');
        const before = await steadyBadge(eli);
        await send(page, later);
        await expect
          .poll(() => messagesBadge(eli), { timeout: 2_000, message: 'the badge goes up' })
          .toBeGreaterThan(before);
        return messagesBadge(eli);
      });

      await test.step('opening the chat clears it', async () => {
        await openChat(eli, firstName.admin);
        await expect(message(eli, later)).toBeVisible();
        await expect
          .poll(() => messagesBadge(eli), { timeout: 2_000, message: 'the badge goes down' })
          .toBeLessThan(peak);
      });
      await eli.context().close();
    });

    test('MS-02 a group of 3 is started with a name, grown to 4 with the warning, renamed and left; each change shows a line', async ({
      page,
      browser,
    }) => {
      const group = uniqueName('Phoenix leads');
      const renamed = uniqueName('Phoenix leads West');
      await signInAs(page, 'admin');
      await openMessages(page);

      await test.step('Avery starts a group with Eli and Casey, named Phoenix leads', async () => {
        await startChat(page, ['editor', 'commenter'], group);
      });

      await test.step('adding Val warns "They\'ll see earlier messages." and shows a line', async () => {
        await addPeople(page, ['viewer']);
        await expect(changeLine(page, firstName.admin, 'added', firstName.viewer)).toBeVisible();
      });

      await test.step('renaming it shows a line with the new name', async () => {
        await chooseInChatMenu(page, 'Rename');
        const field = page
          .getByRole('dialog')
          .getByRole('textbox')
          .or(page.getByRole('main').getByRole('textbox', { name: /name/i }))
          .first();
        await field.fill(renamed);
        await field.press('Enter');
        const heading = page.getByRole('main').getByRole('heading', { name: startsWith(renamed) });
        await expect(heading).toBeVisible();
        await expect(changeLine(page, firstName.admin, renamed)).toBeVisible();
      });

      await test.step('Casey leaves: the chat is gone for her, and Avery sees a line', async () => {
        const casey = await windowFor(browser, 'commenter');
        await openChat(casey, renamed);
        await chooseInChatMenu(casey, 'Leave');
        // Leaving may ask to confirm first.
        const confirm = casey.getByRole('dialog').getByRole('button', { name: /^leave/i });
        await confirm.click({ timeout: 3_000 }).catch(() => undefined);
        await expect(chatRow(casey, renamed)).toHaveCount(0);
        await expect(changeLine(page, firstName.commenter, 'left')).toBeVisible();
        await casey.context().close();
      });
    });
  });

  test.describe('Page cards', () => {
    needs('signIn', 'messages', 'pages', 'sharing');

    test('MS-03 a page card warns first; people who can open the page see it, Val sees a locked card and never gets the title', async ({
      page,
      browser,
    }) => {
      const title = uniqueName('Refund policy');
      const group = uniqueName('Refund review');
      await signInAs(page, 'admin');
      const pageId = await createPrivatePage(page, title);
      await sharePage(page, pageId, ['editor', 'commenter']);
      await openMessages(page);
      await startChat(page, ['editor', 'commenter', 'viewer'], group);

      const eli = await windowFor(browser, 'editor');
      await openChat(eli, group);
      const val = await windowFor(browser, 'viewer');
      const answersToVal: string[] = [];
      val.on('response', async (response) => {
        if (!new URL(response.url()).pathname.startsWith('/api/')) return;
        answersToVal.push(await response.text().catch(() => ''));
      });
      await openChat(val, group);
      // A card links to the page (decision 0007, 4.1); the chat list's previews don't.
      const cardsFor = (who: typeof page) =>
        who.getByRole('main').locator(`a[href$="/p/${pageId}"]`);
      const warning = page.getByRole('dialog').filter({ hasText: /can['’]t open/ });
      const onlyVal = new RegExp(`${firstName.viewer}\\b.*can['’]t open ['‘’"“]${escape(title)}`);

      const sendWithWarning = async (sentBefore: number) => {
        await composer(page).press('Enter');
        await expect(warning).toContainText(onlyVal);
        await expect(warning).not.toContainText(word(firstName.editor));
        await expect(warning).not.toContainText(word(firstName.commenter));
        for (const name of ['Share page', 'Send anyway', 'Cancel']) {
          await expect(warning.getByRole('button', { name })).toBeVisible();
        }
        await expect(cardsFor(eli), 'nothing is sent before the answer').toHaveCount(sentBefore);
        await warning.getByRole('button', { name: 'Send anyway' }).click();
        await expect(cardsFor(eli)).toHaveCount(sentBefore + 1);
        await expect(cardsFor(eli).last()).toContainText(title);
      };

      await test.step('Share page: warned first, then Eli sees the card', async () => {
        await page.getByRole('main').getByRole('button', { name: 'Share page' }).click();
        const picker = page.getByRole('dialog');
        await picker.getByRole('combobox').or(picker.getByRole('textbox')).first().fill(title);
        await page
          .getByRole('option', { name: word(title) })
          .first()
          .click();
        await sendWithWarning(0);
      });

      await test.step('"@" and the page name: warned first, then Eli sees the card', async () => {
        await composer(page).pressSequentially(`@${title}`);
        await page
          .getByRole('option', { name: word(title) })
          .first()
          .click();
        await sendWithWarning(1);
      });

      await test.step('Val sees two locked cards and no answer to Val holds the title', async () => {
        const locked = val.getByRole('main').getByText(/A page you can['’]t open/);
        await expect
          .poll(() => locked.count(), { message: 'locked cards' })
          .toBeGreaterThanOrEqual(2);
        await expect(val.getByRole('main')).not.toContainText(title);
        const leaks = answersToVal.filter((body) => body.includes(title));
        expect(leaks, 'answers to Val that hold the title').toEqual([]);
      });
      await eli.context().close();
      await val.context().close();
    });
  });

  test.describe('Pictures and files', () => {
    needs('signIn', 'messages');

    test('MS-15 3 pictures and a PDF show as a grid and a file card; the viewer works by mouse and keyboard; no location is kept', async ({
      page,
    }) => {
      const label = uniqueName('Fictional shift photo');
      const text = uniqueName('Fictional QA photos from the front desk');
      const schedule = `${uniqueName('Fictional schedule')}.pdf`;
      await signInAs(page, 'admin');
      await openMessages(page);
      await startChat(page, ['editor']);
      const row = messageRow(page, text);
      const thumbnails = row.getByRole('button').filter({ has: page.locator('img') });
      const viewer = page.getByRole('dialog');

      await test.step('send 3 pictures and a PDF in one message', async () => {
        await attach(page, [...pictures(label), pdf(schedule)]);
        await send(page, text);
      });

      await test.step('the pictures show as a grid and the PDF as a file card', async () => {
        await expect(thumbnails).toHaveCount(3, { timeout: 30_000 });
        const boxes = await thumbnails.evaluateAll((all) =>
          all.map((one) => one.getBoundingClientRect().left),
        );
        expect(new Set(boxes.map(Math.round)).size, 'pictures side by side').toBeGreaterThan(1);
        await expect(row.getByText(schedule)).toBeVisible();
        await expect(row).toContainText(/\d+(\.\d+)?\s?(B|KB|MB)\b/i);
        const download = row.getByRole('link', { name: /download/i });
        await expect(
          download.or(row.getByRole('button', { name: /download/i })).first(),
        ).toBeVisible();
      });

      await test.step('the viewer moves with ← and →, and with Previous and Next', async () => {
        await thumbnails.first().click();
        await expect(viewer).toBeVisible();
        await expect(viewer.getByText(word(firstName.admin)).first()).toBeVisible();
        const first = await shownPicture(viewer);
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => shownPicture(viewer)).not.toBe(first);
        const second = await shownPicture(viewer);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => shownPicture(viewer)).toBe(first);
        await viewer.getByRole('button', { name: /^next/i }).click();
        await expect.poll(() => shownPicture(viewer)).toBe(second);
        await viewer.getByRole('button', { name: /^previous/i }).click();
        await expect.poll(() => shownPicture(viewer)).toBe(first);
      });

      await test.step('the stored picture has no location', async () => {
        const control = viewer
          .getByRole('button', { name: /^download/i })
          .or(viewer.getByRole('link', { name: /^download/i }))
          .first();
        const [download] = await Promise.all([page.waitForEvent('download'), control.click()]);
        const picture = await readFile(await download.path());
        expect(picture.length).toBeGreaterThan(0);
        expect(hasLocation(picture), 'the downloaded picture still has a GPS position').toBe(false);
      });

      await test.step('Esc closes the viewer', async () => {
        await page.keyboard.press('Escape');
        await expect(viewer).toBeHidden();
      });

      await test.step('an SVG is sent as a file card, not a picture', async () => {
        const drawing = `${uniqueName('Fictional floor plan')}.svg`;
        await attach(page, [svg(drawing)]);
        await composer(page).press('Enter');
        const card = messageRow(page, drawing);
        await expect(card.getByText(drawing)).toBeVisible({ timeout: 30_000 });
        await expect(card.getByRole('button').filter({ has: page.locator('img') })).toHaveCount(0);
      });
    });
  });
});
