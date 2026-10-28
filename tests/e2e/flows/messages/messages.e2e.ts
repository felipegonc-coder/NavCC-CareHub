import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { recordApiAnswers } from '../status/status-page.js';
import { hasLocation, pdf, pictures, svg } from './files.js';
import {
  deleteMessage,
  deletedLine,
  editMessage,
  filterFrom,
  isOwnReaction,
  messageResult,
  noMatches,
  openMessageMenu,
  reactionCount,
  reactThumbsUp,
  searchBox,
  sendAgain,
  sentIds,
  thumbsUpChip,
  whoReacted,
} from './message-actions.js';
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
import {
  fakeNotifications,
  notificationPermission,
  notificationWhere,
  openNotification,
  showMessageText,
  shownNotifications,
  toBackground,
  wording,
  type Shown,
} from './notifications.js';

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

  test.describe('Editing, deleting and reactions', () => {
    needs('signIn', 'messages');

    test("MS-05 Avery edits and deletes her own message, its text is gone from the server, and nobody can change someone else's message (403)", async ({
      page,
      browser,
    }) => {
      const draft = uniqueName('Fictional QA: the front desk opens at 8. Ref');
      const fixed = uniqueName('Fictional QA: the front desk opens at 9. Ref');
      const kept = uniqueName('Fictional QA: the vending machine is fixed. Ref');
      const elis = uniqueName('Fictional QA: thanks for the update. Ref');
      const answersToAvery = recordApiAnswers(page);
      await signInAs(page, 'admin');
      await openMessages(page);
      const eli = await windowFor(browser, 'editor');
      await startChat(eli, ['admin']);
      await startChat(page, ['editor']);

      const [draftId, keptId, elisId] =
        await test.step('Avery sends two messages and Eli one', async () => {
          await send(page, draft);
          await send(page, kept);
          await expect(message(eli, kept)).toBeVisible();
          await send(eli, elis);
          // After a reload the chat's messages come from the server, with their IDs.
          await page.reload();
          await openChat(page, firstName.editor);
          await expect(message(page, elis)).toBeVisible();
          const idOf = async (text: string) => {
            const found = await sentIds(answersToAvery, text);
            expect(found, `the IDs of "${text}"`).toHaveLength(1);
            return found[0] ?? '';
          };
          return [await idOf(draft), await idOf(kept), await idOf(elis)] as const;
        });

      const edit =
        await test.step('Avery edits hers: the new text shows with "edited", for Eli too', async () => {
          const sent = await editMessage(page, draft, fixed);
          expect(sent.status, 'saving the edit').toBeLessThan(300);
          expect(JSON.stringify(sent), 'the edit names the message by its ID').toContain(draftId);
          for (const who of [page, eli]) {
            await expect(messageRow(who, fixed)).toContainText(/\bedited\b/i);
            await expect(message(who, draft)).toHaveCount(0);
          }
          return sent;
        });

      const removal =
        await test.step('Avery deletes it after confirming: "This message was deleted" stays', async () => {
          const sent = await deleteMessage(page, fixed);
          expect(sent.status, 'deleting').toBeLessThan(300);
          expect(JSON.stringify(sent), 'the delete names the message by its ID').toContain(draftId);
          for (const who of [page, eli]) {
            await expect(message(who, fixed)).toHaveCount(0);
            await expect(who.getByRole('main').getByText(deletedLine).last()).toBeVisible();
          }
          return sent;
        });

      await test.step("the server doesn't send the deleted text: Eli's reload holds neither version", async () => {
        const answersToEli = recordApiAnswers(eli);
        await eli.reload();
        await openChat(eli, firstName.admin);
        await expect(message(eli, kept)).toBeVisible();
        await sentIds(answersToEli, kept);
        const leaks = answersToEli.filter(({ body }) =>
          [draft, fixed].some((text) => JSON.stringify(body).includes(text)),
        );
        expect(
          leaks.map(({ path }) => path),
          'answers that still hold the deleted text',
        ).toEqual([]);
      });

      await test.step("on Eli's message, Avery's menu has no Edit or Delete", async () => {
        const menu = await openMessageMenu(page, elis);
        for (const item of ['Edit', 'Delete']) {
          await expect(menu.getByRole('menuitem', { name: item, exact: true })).toHaveCount(0);
        }
        await page.keyboard.press('Escape');
      });

      await test.step("the server refuses to edit or delete someone else's message (403)", async () => {
        const tries = [
          { who: eli, sent: edit, id: keptId, what: "Eli editing Avery's message" },
          { who: eli, sent: removal, id: keptId, what: "Eli deleting Avery's message" },
          { who: page, sent: edit, id: elisId, what: "Avery, an admin, editing Eli's message" },
          { who: page, sent: removal, id: elisId, what: "Avery, an admin, deleting Eli's message" },
        ];
        for (const { who, sent, id, what } of tries) {
          expect(await sendAgain(who, sent, draftId, id), what).toBe(403);
        }
        await page.reload();
        await openChat(page, firstName.editor);
        for (const text of [kept, elis]) {
          await expect(message(page, text)).toBeVisible();
          await expect(messageRow(page, text)).not.toContainText(/\bedited\b/i);
        }
      });
      await eli.context().close();
    });

    test("MS-18 👍 on Eli's message is added, then removed; the count and who reacted are right, the same reaction twice is refused, and nobody is notified", async ({
      page,
      browser,
    }) => {
      const text = uniqueName('Fictional QA: the 4 PM huddle moved to room B. Ref');
      await signInAs(page, 'admin');
      await openMessages(page);
      // Eli's tab is in the background with notifications allowed, so a notification would show.
      const eliContext = await browser.newContext();
      await fakeNotifications(eliContext, 'granted');
      const eli = await eliContext.newPage();
      await signInAs(eli, 'editor');
      await openMessages(eli);
      await startChat(eli, ['admin']);
      await startChat(page, ['editor']);
      await send(eli, text);
      await expect(message(page, text)).toBeVisible();
      await toBackground(eli, true);
      const averysChip = thumbsUpChip(page, text);
      const elisChip = thumbsUpChip(eli, text);

      const added = await test.step('Avery reacts 👍: the chip shows 1, as hers', async () => {
        const sent = await reactThumbsUp(page, text);
        expect(sent.status, 'adding the reaction').toBeLessThan(300);
        await expect.poll(() => reactionCount(averysChip)).toBe(1);
        expect(await isOwnReaction(averysChip), "Avery's 👍 is highlighted for her").toBe(true);
        return sent;
      });

      await test.step('clicking the chip again removes it', async () => {
        await averysChip.first().click();
        await expect(averysChip).toHaveCount(0);
        await expect(elisChip).toHaveCount(0);
      });

      await test.step('Avery and Eli both react: the count is 2, and pointing at it names them', async () => {
        await reactThumbsUp(page, text);
        await expect
          .poll(() => reactionCount(elisChip), { message: "Eli sees Avery's 👍" })
          .toBe(1);
        expect(await isOwnReaction(elisChip), "Avery's 👍 isn't highlighted for Eli").toBe(false);
        await elisChip.first().click();
        await expect.poll(() => reactionCount(elisChip)).toBe(2);
        expect(await isOwnReaction(elisChip), "Eli's own 👍 is highlighted for him").toBe(true);
        await expect.poll(() => reactionCount(averysChip)).toBe(2);
        const who = await whoReacted(page, averysChip);
        expect(who).toMatch(word(firstName.editor));
        expect(who).toMatch(new RegExp(`\\b(${firstName.admin}|you)\\b`, 'i'));
      });

      await test.step('the same 👍 again is refused, and the count stays 2', async () => {
        const again = await (await apiFor(page)).send(added.method, added.path, added.data);
        expect(again.ok(), `a second identical 👍 is refused (it answered ${again.status()})`).toBe(
          false,
        );
        await page.reload();
        await openChat(page, firstName.editor);
        await expect(message(page, text)).toBeVisible();
        await expect.poll(() => reactionCount(averysChip)).toBe(2);
      });

      await test.step('nobody is notified: Eli gets no notification and no notice about it', async () => {
        const aboutIt = (shown: Shown) =>
          wording(shown).includes(text) || /\breact|👍/i.test(wording(shown));
        const shown = (await shownNotifications(eli)).filter(aboutIt);
        expect(shown, 'notifications to Eli about the reactions').toEqual([]);
        await toBackground(eli, false);
        await openChat(eli, 'Care Hub');
        await expect(eli.getByRole('main').getByText(/\breact(ed|ion)\b/i)).toHaveCount(0);
      });
      await eliContext.close();
    });
  });

  test.describe('Offline', () => {
    needs('signIn', 'messages');

    test('MS-08 two messages sent offline wait with "Will send when you\'re back online", then send in order, once each', async ({
      page,
      browser,
    }) => {
      const first = uniqueName('Fictional QA offline note 1 of 2. Ref');
      const second = uniqueName('Fictional QA offline note 2 of 2. Ref');
      const waiting = /Will send when you['’]re back online/;
      await signInAs(page, 'admin');
      await openMessages(page);
      const eli = await windowFor(browser, 'editor');
      await startChat(eli, ['admin']);
      await startChat(page, ['editor']);
      const top = async (who: typeof page, text: string) =>
        (await message(who, text).boundingBox())?.y ?? Number.NaN;

      await test.step('offline, both wait with "Will send when you\'re back online"', async () => {
        await page.context().setOffline(true);
        await send(page, first);
        await send(page, second);
        for (const text of [first, second]) {
          await expect(messageRow(page, text)).toContainText(waiting);
        }
        await expect(message(eli, first), 'nothing reaches Eli while Avery is offline').toHaveCount(
          0,
        );
      });

      await test.step('back online, they send in order, once each', async () => {
        await page.context().setOffline(false);
        await expect(message(eli, second)).toBeVisible({ timeout: 15_000 });
        await expect(message(eli, first)).toBeVisible();
        expect(await top(eli, first), 'the first is above the second').toBeLessThan(
          await top(eli, second),
        );
        for (const text of [first, second]) {
          await expect(messageRow(page, text)).not.toContainText(waiting);
        }
      });

      await test.step('after a reload, the server has each once, in order', async () => {
        const answersToEli = recordApiAnswers(eli);
        await eli.reload();
        await openChat(eli, firstName.admin);
        for (const text of [first, second]) {
          await expect(message(eli, text)).toBeVisible();
          expect(await sentIds(answersToEli, text), `copies of "${text}"`).toHaveLength(1);
        }
        expect(await top(eli, first)).toBeLessThan(await top(eli, second));
      });
      await eli.context().close();
    });
  });

  test.describe('Message search', () => {
    needs('signIn', 'messages');

    test('MS-19 "sched" with From: Eli finds his "SCHÉDULE" (case and accents ignored), "exact phrases" work, deleted messages aren\'t found, and a result opens the chat at the message', async ({
      page,
      browser,
    }) => {
      test.slow();
      // A made-up word, letters only, ties the searches to this test's messages.
      const tag = randomUUID()
        .slice(0, 8)
        .replace(/\d/g, (digit) => 'ghijklmnop'.charAt(Number(digit)));
      const fromEli = `Fictional QA SCHÉDULE ${tag} for the front desk`;
      const fromAvery = `Fictional QA schedule ${tag} from Avery`;
      const deleted = `Fictional QA schedule ${tag} that was deleted`;
      await signInAs(page, 'admin');
      await openMessages(page);
      const eli = await windowFor(browser, 'editor');
      await startChat(eli, ['admin']);
      await startChat(page, ['editor']);

      await test.step('Eli and Avery write about the schedule, Avery deletes one, and newer messages follow', async () => {
        await send(eli, fromEli);
        await expect(message(page, fromEli)).toBeVisible();
        await send(page, fromAvery);
        await send(page, deleted);
        await deleteMessage(page, deleted);
        await expect(message(page, deleted)).toHaveCount(0);
        // Newer messages push Eli's out of sight, so opening it from the results has to scroll back.
        const filler = uniqueName('Fictional QA filler');
        for (let i = 1; i <= 25; i += 1) await send(page, `${filler} ${i}`);
        await expect(message(page, `${filler} 25`)).toBeVisible();
        await openChat(page, 'Care Hub');
      });

      await test.step('"sched" finds both schedule messages, and not the deleted one', async () => {
        await searchBox(page).fill(`sched ${tag}`);
        await expect(messageResult(page, fromEli)).toBeVisible();
        await expect(messageResult(page, fromAvery)).toBeVisible();
        await expect(messageResult(page, deleted)).toHaveCount(0);
        await expect(messageResult(page, deletedLine)).toHaveCount(0);
      });

      await test.step("From: Eli keeps his message and drops Avery's", async () => {
        await filterFrom(page, 'editor');
        await expect(messageResult(page, fromAvery)).toHaveCount(0);
        await expect(messageResult(page, fromEli)).toBeVisible();
        await expect
          .soft(
            messageResult(page, fromEli).locator('mark').first(),
            'the matching words are marked',
          )
          .toBeVisible();
      });

      await test.step('"exact phrases" match only in that order', async () => {
        await searchBox(page).fill(`"schedule ${tag}"`);
        await expect(messageResult(page, fromEli)).toBeVisible();
        await searchBox(page).fill(`"${tag} schedule"`);
        await expect(noMatches(page)).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('button', { name: 'Clear filters' }),
        ).toBeVisible();
      });

      await test.step('choosing the result opens the chat with Eli at his message', async () => {
        await searchBox(page).fill(`sched ${tag}`);
        await messageResult(page, fromEli).click();
        await expect(
          page.getByRole('main').getByRole('heading', { name: startsWith(firstName.editor) }),
        ).toBeVisible();
        await expect(message(page, fromEli)).toBeInViewport();
      });
      await eli.context().close();
    });
  });

  test.describe('Browser notifications', () => {
    needs('signIn', 'messages', 'settings');

    test('MS-07 with notifications allowed and the tab in the background, Eli\'s message shows a notification that opens the chat; with "Show message text" off it shows his name but not the text', async ({
      page,
      browser,
    }) => {
      test.slow();
      await fakeNotifications(page.context());
      await signInAs(page, 'admin');
      await openMessages(page);
      const eli = await windowFor(browser, 'editor');
      await startChat(eli, ['admin']);
      const fromEli = (shown: Shown) => word(firstName.editor).test(wording(shown));

      await test.step('Avery turns notifications on from the offer in Messages', async () => {
        const offer = page.getByText('Get notified about new messages?');
        await expect(offer).toBeVisible();
        await page.getByRole('button', { name: 'Turn on', exact: true }).click();
        await expect
          .poll(() => notificationPermission(page), { message: 'the browser was asked' })
          .toBe('granted');
        await expect(offer).toBeHidden();
      });

      await test.step("in the background, Eli's message shows his name and text, and clicking it opens the chat", async () => {
        await openChat(page, 'Care Hub');
        await toBackground(page, true);
        const text = uniqueName('Fictional QA: can you take the 3 PM call? Ref');
        await send(eli, text);
        const shown = await notificationWhere(
          page,
          (one) => fromEli(one) && wording(one).includes(text),
          "a notification with Eli's name and the text",
        );
        await openNotification(page, shown);
        await expect(
          page.getByRole('main').getByRole('heading', { name: startsWith(firstName.editor) }),
        ).toBeVisible();
        await expect(message(page, text)).toBeVisible();
      });

      try {
        await test.step('with "Show message text" off, it shows Eli\'s name and "New message", not the text', async () => {
          await showMessageText(page, false);
          await openMessages(page);
          await openChat(page, 'Care Hub');
          await toBackground(page, true);
          const text = uniqueName('Fictional QA: the 5 PM report is ready. Ref');
          await send(eli, text);
          const { shown } = await notificationWhere(
            page,
            (one) =>
              fromEli(one) && (/new message/i.test(wording(one)) || wording(one).includes(text)),
            "a notification about Eli's message",
          );
          expect(wording(shown)).not.toContain(text);
          expect(wording(shown)).toMatch(/new message/i);
        });
      } finally {
        await showMessageText(page, true);
      }
      await eli.context().close();
    });
  });
});
