import type { Page, Request, Response } from '@playwright/test';
import { expect, needs, onlyIn, people, signInAs, test, uniqueName } from '../_support/index.js';
import * as stub from '../_support/claude-stub.js';
import { selectPart } from '../comments/threads.js';
import * as db from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { Editor } from '../editor/editor-page.js';
import * as data from '../meetings/meetings-data.js';
import * as mt from '../meetings/meetings-page.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, pageIdOf } from '../pages/page-screen.js';
import { SearchWindow, uniqueWord } from '../search/search-window.js';
import * as claude from './claude-page.js';

// Every check that reads or changes the workspace's Claude switches (Claude features, section
// 3.1) is in this one file, which runs in order, so a switch one check turns on never shows up in
// another. The checks of the default, with every switch off, come first (CL-01, MT-11). Then come
// the checks that turn a switch on: each turns it off again in `finally`, and afterAll turns every
// switch off, whatever happened.

test.describe.configure({ mode: 'serial' });

const { MINUTE } = data;

/** A one-hour slot on day `day` (0 is Sunday) of the week from `sunday`, at `time`. */
function slot(sunday: string, day: number, time: string) {
  const start = mt.momentAt(mt.addDays(sunday, day), time);
  return { start, end: start + 60 * MINUTE };
}

test.describe('Claude switches', () => {
  onlyIn('desktop-light');
  needs('signIn', 'claude');

  test.afterAll(async ({ browser }) => {
    await claude.turnEverySwitchOff(browser);
  });

  // ---- With every switch off (the default). CL-01 comes first here. ----

  test('CL-01 with every switch off, nothing offers Claude or sends to it', async ({ page }) => {
    needs('pages', 'editor', 'slashMenu', 'databases', 'search'); // meetings: MT-11, below
    test.skip(claude.NO_KEY, claude.WITH_KEY);
    await stub.clear();
    await signInAs(page, 'editor');

    await test.step('a page: the sidebar, "/", the selection toolbar, Ctrl+J', async () => {
      const editor = await Editor.onNewPage(page);
      const text = 'Fictional refund steps: check the order, then send the refund.';
      await editor.typeBlocks(text, '');
      await page.keyboard.type('/');
      await expect(editor.slashMenu).toBeVisible();
      await claude.expectNoClaude(page, 'the "/" menu');
      await page.keyboard.press('Escape');
      const block = editor.content.getByText(text, { exact: true });
      await selectPart(block, text);
      const bold = page.getByRole('button', { name: /^bold/i });
      const toolbar = page.getByRole('toolbar').filter({ has: bold });
      await toolbar.getByRole('button', { name: /^(…|more)/i }).click();
      await claude.expectNoClaude(page, 'the "…" menu of the selection toolbar');
      await page.keyboard.press('Escape');
      await selectPart(block, text);
      for (const keys of ['ControlOrMeta+J', 'ControlOrMeta+Alt+J']) {
        await page.keyboard.press(keys);
        await claude.expectNoClaude(page, keys);
      }
    });

    await test.step('a database: no Claude field among the property types', async () => {
      const screen = new DatabaseScreen(page, (await db.makeDatabase(page)).id);
      await screen.open();
      await claude.addProperty(screen).click();
      await expect(page.getByText('Checkbox', { exact: true }).first()).toBeVisible();
      await claude.expectNoClaude(page, 'the property types');
      await page.keyboard.press('Escape');
    });

    await test.step('search', async () => {
      const search = new SearchWindow(page);
      await search.openWith();
      await search.type('refund');
      await claude.expectNoClaude(page, 'the search window');
    });

    expect(await stub.requests(), 'requests the Claude stub got').toEqual([]);
  });

  test.describe('Meetings with Claude off', () => {
    needs('calendar', 'meetings', 'pages');

    test('MT-11 with Claude off, there is no Summarize button anywhere', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'admin');
      const eli = await data.member(page, people.editor.email);
      const sunday = mt.sundayIn(10);
      const title = uniqueName('Team huddle');
      const windows: Page[] = [];
      const eventId = await data.createEvent(page, {
        title,
        ...slot(sunday, 2, '10:00'),
        people: [eli.id],
      });
      try {
        // Meeting summary starts off and only an Admin turns it on (Claude features, section 3.1).
        await test.step('not in the event panel', async () => {
          await mt.openEvent(page, title, sunday);
          await expect(mt.notesButton(page)).toBeVisible();
          await claude.expectNoSummarize(page, 'event panel');
        });

        let notesId = '';
        await test.step('not in the notes page, for Avery (an Admin) or Eli (an Editor)', async () => {
          await mt.notesButton(page).click();
          await page.waitForURL(/\/p\/[^/?#]+/);
          notesId = mt.pageIdIn(page.url());
          await expect(mt.sectionHeading(page, 'Summary')).toBeVisible();
          await claude.expectNoSummarize(page, "Avery's notes page");
          const eliPage = await mt.windowFor(browser, 'editor');
          windows.push(eliPage);
          await eliPage.goto(`/p/${notesId}`);
          await expect(mt.sectionHeading(eliPage, 'Summary')).toBeVisible();
          await claude.expectNoSummarize(eliPage, "Eli's notes page");
        });

        await test.step('not in All meeting notes', async () => {
          await mt.openAllMeetingNotes(page);
          await mt.searchNotes(page, title);
          await expect(page.getByRole('main').getByText(title).first()).toBeVisible();
          await claude.expectNoSummarize(page, 'All meeting notes');
        });
      } finally {
        await data.deleteEvent(page, eventId);
        for (const opened of windows) await opened.context().close();
      }
    });
  });

  test('CL-03 without a key, Settings says so and no switch turns on', async ({ page }) => {
    test.skip(!claude.NO_KEY, claude.BY_HAND);
    // The Claude stub isn't used: a server without a key sends nothing.
    await signInAs(page, 'admin');
    await claude.openClaudeSettings(page);
    await expect(claude.keyStatus.missing(page)).toBeVisible();
    for (const name of claude.SWITCHES) {
      const control = claude.claudeSwitch(page, name);
      await expect(control, name).toBeDisabled();
      await control.click({ force: true });
      await expect(control, name).not.toBeChecked();
    }
    await claude.openClaudeSettings(page);
    for (const name of claude.SWITCHES) {
      await expect(claude.claudeSwitch(page, name), `${name}, opened again`).not.toBeChecked();
    }
  });

  // ---- With a switch on. Each check turns its switch off again in `finally`. ----

  test("CL-03 with a key, Test connection and Nav's OK", async ({ page, browser }) => {
    test.skip(claude.NO_KEY, claude.WITH_KEY);
    await signInAs(page, 'admin');
    await claude.openClaudeSettings(page);
    try {
      await test.step('Test connection sends nothing from the workspace', async () => {
        const sent: string[] = [];
        for (const time of ['first', 'second']) {
          await stub.clear();
          await claude.testConnection(page).click();
          await expect.poll(async () => (await stub.requests()).length, time).toBe(1);
          sent.push(await stub.sentText());
        }
        expect(sent[1], 'the second test').toBe(sent[0]);
        expect(sent[0]?.toLowerCase(), 'the test').not.toMatch(/avery|example\.test/);
      });

      await test.step('Writing help: Turn on waits for "Nav has given the OK"', async () => {
        const control = claude.claudeSwitch(page, 'Writing help');
        await control.click();
        const confirm = claude.turnOnConfirm(page);
        await expect(confirm.dialog).toContainText(claude.WRITING_HELP_SENDS);
        await expect(confirm.turnOn).toBeDisabled();
        await confirm.navOk.check();
        await confirm.turnOn.click();
        await expect(control).toBeChecked();
      });
    } finally {
      await claude.turnEverySwitchOff(browser);
    }
  });

  test('CL-06 Writing help changes the page only on Replace', async ({ page, browser }) => {
    needs('pages', 'editor');
    await signInAs(page, 'editor');
    await claude.withSwitchesOn(browser, ['Writing help'], async () => {
      const editor = await Editor.onNewPage(page);
      const text = 'Fictional refund steps: check the order, confirm the amount, then send it.';
      const shorter = 'Fictional refund steps, in short.';
      await editor.typeBlocks(text);
      await stub.clear();

      await test.step('Make shorter shows a suggestion; the page stays as it was', async () => {
        await stub.answerNext(shorter);
        await claude.askClaudeOn(editor, text, 'Make shorter');
        await expect(claude.suggestion(page, 'Replace')).toBeEnabled();
        await expect(page.getByText(shorter).first()).toBeVisible();
        await expect(editor.content.getByText(text, { exact: true })).toBeVisible();
        expect(await stub.sentText(), 'what went to Claude').toContain(text);
      });

      await test.step('Replace changes it, and one Ctrl+Z brings it back', async () => {
        await claude.suggestion(page, 'Replace').click();
        await editor.expectBlocks(shorter);
        await editor.undo();
        await editor.expectBlocks(text);
      });

      await test.step('Discard changes nothing', async () => {
        await claude.askClaudeOn(editor, text, 'Make shorter');
        await claude.suggestion(page, 'Discard').click();
        await expect(claude.suggestion(page, 'Replace')).toHaveCount(0);
        await editor.expectBlocks(text);
      });
    });
  });

  test('CL-09 the assistant cites only pages you can open', async ({ page, browser }) => {
    needs('pages', 'editor', 'search');
    const hidden = uniqueWord();
    await signInAs(page, 'editor');
    await claude.withSwitchesOn(browser, ['Assistant'], async ({ admin }) => {
      // Avery's private page matches the question too, so only access keeps it out.
      const title = `Fictional refunds take 30 days ${hidden}`;
      const privateId = await makePage(admin, title, { space: 'Private' });
      const editor = await Editor.onNewPage(page);
      const policyId = pageIdOf(page);
      await editor.typeBlocks('Fictional refund policy: refunds take 5 to 7 business days.');

      await test.step('This page, in the side panel: the answer links to it', async () => {
        await claude.toSidePanel(page);
        await claude.askAssistant(page, 'How long do refunds take?', 'This page');
        await expect(claude.sourceLink(page, policyId).first()).toBeVisible();
      });

      await test.step("All pages I can open: nothing of Avery's private page", async () => {
        await stub.clear();
        await claude.askAssistant(page, 'How long do refunds take?', 'All pages I can open');
        await expect(claude.sourceLink(page, privateId)).toHaveCount(0);
        expect(await stub.sentText(), 'what went to Claude').not.toContain(hidden);
      });
    });
  });

  test('CL-13 a Claude field fills a row; Fill all asks first', async ({ page, browser }) => {
    needs('databases');
    await signInAs(page, 'editor');
    const tickets = await db.makeDatabase(page, uniqueName('Fictional tickets'));
    const details = await db.addProperty(page, tickets.id, 'Details', db.config.text());
    const asks = [
      'Fictional: where is my refund?',
      'Fictional: new address',
      'Fictional: bad total',
    ] as const;
    const addTicket = (ask: string) =>
      db.addRow(page, tickets.id, uniqueName('Fictional ticket'), {
        [details.id]: db.value.text(ask),
      });
    const first = await addTicket(asks[0]);
    for (const ask of asks.slice(1)) await addTicket(ask);
    await claude.withSwitchesOn(browser, ['Claude fields'], async () => {
      const screen = new DatabaseScreen(page, tickets.id);
      await screen.open();
      await claude.addClaudeField(screen, 'Summary', 'Details');
      const summary = db.propertyNamed(await db.getDatabase(page, tickets.id), 'Summary');
      const cell = screen.cell(first.id, summary.id);
      const filled = 'Fictional summary: asks where the refund is.';
      await stub.clear();

      await test.step('Fill fills that one row', async () => {
        await stub.answerNext(filled);
        await cell.hover();
        await claude.fillButton(cell).click();
        await expect(claude.fillButton(cell)).toHaveCount(0);
        await expect(cell).toContainText(filled);
        expect(await stub.requests(), 'requests to Claude').toHaveLength(1);
        expect(await stub.sentText()).toContain(asks[0]);
      });

      await test.step('Fill all asks first, with the number of rows and requests', async () => {
        const confirm = await claude.fillAll(screen, 'Summary');
        await expect(confirm).toContainText(claude.fillAllSays(3));
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        expect(await stub.requests(), 'requests after Cancel').toHaveLength(1);
      });
    });
  });

  test('CL-15 Summarize warns, fills the summary, asks to replace', async ({ page, browser }) => {
    needs('calendar', 'meetings', 'pages');
    await signInAs(page, 'editor');
    const avery = await data.member(page, people.admin.email);
    const sunday = mt.sundayIn(11);
    const title = uniqueName('Weekly huddle');
    const event = { title, ...slot(sunday, 3, '09:00'), people: [avery.id] };
    const eventId = await data.createEvent(page, event);
    try {
      await claude.withSwitchesOn(browser, ['Meeting summary'], async () => {
        await mt.takeNotes(page, title, sunday);
        const notes = 'Fictional notes: the late shift starts at 2 PM from next week.';
        await mt.writeIn(page, 'Notes', notes);
        const summary = mt.sectionFirstBlock(page, 'Summary');
        await stub.clear();

        await test.step('Summarize warns, then fills the summary from the notes', async () => {
          await claude.summarize(page).click();
          const warning = claude.summaryWarning(page);
          await expect(warning.dialog).toContainText(warning.says);
          await warning.goOn.click();
          await expect(summary).toHaveText(/\S/);
          expect(await stub.sentText(), 'what went to Claude').toContain(notes);
        });

        await test.step('a second Summarize asks before replacing it', async () => {
          const before = await summary.innerText();
          await claude.summarize(page).click();
          await claude.replaceSummary(page).getByRole('button', { name: 'Cancel' }).click();
          await expect(summary).toHaveText(before);
        });
      });
    } finally {
      await data.deleteEvent(page, eventId);
    }
  });

  test('CL-11 nobody else, Admins included, can open your chats', async ({ page, browser }) => {
    const word = uniqueWord();
    await signInAs(page, 'editor');
    await claude.withSwitchesOn(browser, ['Assistant'], async ({ admin }) => {
      const casey = await mt.windowFor(browser, 'commenter');
      try {
        await page.goto('/');
        await claude.askAssistant(page, `Fictional question about the rota ${word}`, 'No pages');
        // Eli opens the chat again; the answers that hold it are the requests others try.
        const chat: Request[] = [];
        page.on('response', async (response) => {
          const read = response.request().method() === 'GET';
          if (!read || !new URL(response.url()).pathname.startsWith(claude.CLAUDE_API)) return;
          if ((await response.text().catch(() => '')).includes(word)) chat.push(response.request());
        });
        await page.reload();
        await (await claude.openAssistant(page)).getByText(word).first().click();
        await expect.poll(() => chat.length, 'reads of the chat').toBeGreaterThan(0);

        await test.step("Avery's assistant doesn't list it", async () => {
          await admin.goto('/');
          await claude.openAssistant(admin);
          await expect(admin.getByText(word)).toHaveCount(0);
        });

        await test.step('Avery and Casey get none of it from the API', async () => {
          for (const [who, other] of Object.entries({ Avery: admin, Casey: casey })) {
            for (const request of chat) {
              const answer = await claude.replay(other, request);
              const where = `${who}: ${request.url()}`;
              expect(await answer.text(), where).not.toContain(word);
              // A chat by its ID is refused (403); a list just doesn't have it.
              if (/[0-9a-f-]{16,}$/i.test(request.url())) expect(answer.status(), where).toBe(403);
            }
          }
        });
      } finally {
        await casey.context().close();
      }
    });
  });

  test('CL-05 turning the Assistant off stops it within 5 seconds', async ({ page, browser }) => {
    await signInAs(page, 'editor');
    await claude.withSwitchesOn(browser, ['Assistant'], async ({ admin }) => {
      await page.goto('/');
      const slow = `Fictional slow question ${stub.words.slow}`; // answered after 35 seconds
      await claude.askAssistant(page, slow, 'No pages', false);
      await expect(claude.writing(page)).toBeVisible();
      await claude.turnOff(admin, 'Assistant');
      await expect(claude.writing(page)).toBeHidden({ timeout: 5_000 });
      await expect(claude.assistant(page)).toBeHidden({ timeout: 5_000 });
      await claude.expectNoClaude(page, 'once the Assistant is off');
    });
  });

  test('CL-04 people without Use Claude get no Claude, and 403', async ({ page, browser }) => {
    needs('pages', 'editor');
    await signInAs(page, 'editor');
    await claude.withSwitchesOn(browser, ['Writing help', 'Assistant'], async ({ saved }) => {
      const val = await mt.windowFor(browser, 'viewer');
      const casey = await mt.windowFor(browser, 'commenter');
      try {
        await test.step('Eli (an Editor) has no Settings → Claude and changes no switch', async () => {
          await claude.openSettings(page);
          await expect(claude.settingsSection(page, 'My account')).toBeVisible();
          await expect(claude.settingsSection(page, 'Claude')).toHaveCount(0);
          for (const request of saved) {
            expect((await claude.replay(page, request)).status(), request.url()).toBe(403);
          }
        });

        // Eli's own Claude requests, on a page in the team space, which Val can open.
        const editor = await Editor.onNewPage(page);
        const text = 'Fictional rota note for the morning shift.';
        await editor.typeBlocks(text);
        const helped = page.waitForRequest(claude.writeTo(claude.CLAUDE_API));
        await claude.askClaudeOn(editor, text, 'Improve writing');
        const requests = [await helped];
        await claude.suggestion(page, 'Discard').click();
        const asked = page.waitForRequest(claude.writeTo(claude.CLAUDE_API));
        await claude.askAssistant(page, 'Fictional question about the rota', 'This page');
        requests.push(await asked);

        await test.step('Val (a Viewer) sees no Claude on the same page', async () => {
          await new PageScreen(val).goto(pageIdOf(page));
          await selectPart(val.getByText(text, { exact: true }), text);
          for (const keys of ['ControlOrMeta+J', 'ControlOrMeta+Alt+J']) {
            await val.keyboard.press(keys);
            await claude.expectNoClaude(val, `Val's page, ${keys}`);
          }
        });

        await test.step('Val and Casey get 403 for the same requests', async () => {
          for (const [who, other] of Object.entries({ Val: val, Casey: casey })) {
            for (const request of requests) {
              const status = (await claude.replay(other, request)).status();
              expect(status, `${who}: ${request.url()}`).toBe(403);
            }
          }
        });
      } finally {
        await val.context().close();
        await casey.context().close();
      }
    });
  });

  test('CL-02 the key never reaches a browser', async ({ browser }) => {
    // Server logs and exports aren't in reach of a browser test. This checks every header, answer,
    // web bundle and page source that reaches Avery's browser, a failed Claude request included.
    needs('pages', 'editor');
    await claude.withSwitchesOn(browser, ['Writing help'], async () => {
      const context = await browser.newContext();
      const seen: Promise<string>[] = [];
      const read = async (response: Response) => {
        // Live updates never end; their headers are enough.
        const live = (response.headers()['content-type'] ?? '').includes('event-stream');
        return JSON.stringify(await response.allHeaders()) + (live ? '' : await response.text());
      };
      context.on('response', (response) => seen.push(read(response).catch(() => '')));
      try {
        const page = await context.newPage();
        await signInAs(page, 'admin');
        await claude.openClaudeSettings(page);
        await expect(claude.keyStatus.set(page, stub.TEST_KEY)).toBeVisible();
        const sources = [await page.content()];
        const editor = await Editor.onNewPage(page);
        const text = `Fictional note that fails ${stub.words.broken}`;
        await editor.typeBlocks(text);
        await claude.askClaudeOn(editor, text, 'Improve writing');
        await expect(claude.suggestion(page, 'Try again')).toBeVisible();
        sources.push(await page.content());
        const all = [...(await Promise.all(seen)), ...sources];
        const withKey = all.filter((each) => each.includes(stub.TEST_KEY)).length;
        expect(withKey, 'places with the key').toBe(0);
      } finally {
        await context.close();
      }
    });
  });
});
