import type { APIResponse, Browser, Locator, Page, Request } from '@playwright/test';
import { apiFor, expect, signInAs, test } from '../_support/index.js';
import { selectPart } from '../comments/threads.js';
import type { DatabaseScreen } from '../databases/database-page.js';
import type { Editor } from '../editor/editor-page.js';
import { windowFor } from '../meetings/meetings-page.js';

// Claude features (sections 3 and 4) as switches.e2e.ts finds them on the screens. Every label,
// text and path those checks use is here, so matching a change on the screens is a change here.

// ---- Runs without a key ----

/** A run by hand against a server without ANTHROPIC_API_KEY (e2e has the fictional key). */
export const NO_KEY = process.env.E2E_NO_CLAUDE_KEY === '1';

/** Why CL-03's check without a key skips in e2e. */
export const BY_HAND =
  'By hand only: start the server without ANTHROPIC_API_KEY, then run with E2E_NO_CLAUDE_KEY=1';

/** Why the other checks skip in that run. */
export const WITH_KEY = 'Needs the e2e server, with its fictional key and the Claude stub';

// ---- Settings → Claude (section 3.1) ----

/** The four workspace switches in Settings → Claude (section 3.1). All start off. */
export const SWITCHES = ['Writing help', 'Assistant', 'Claude fields', 'Meeting summary'] as const;
export type Switch = (typeof SWITCHES)[number];

/** The Settings window, opened with Ctrl+, over Home. */
export async function openSettings(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await page.keyboard.press('Control+Comma');
}

/** A section of Settings, such as My account or Claude (Workspace, Admins only). */
export function settingsSection(page: Page, name: string): Locator {
  const exact = { name, exact: true };
  return page.getByRole('link', exact).or(page.getByRole('tab', exact)).first();
}

/** Settings → Claude. */
export async function openClaudeSettings(page: Page): Promise<void> {
  await openSettings(page);
  await settingsSection(page, 'Claude').click();
  await expect(page.getByRole('heading', { name: 'Claude', exact: true }).first()).toBeVisible();
}

/** One of the four switches in Settings → Claude. */
export const claudeSwitch = (page: Page, name: Switch): Locator =>
  page.getByRole('switch', { name: new RegExp(`^${name}`) }).first();

/** The key line of Settings → Claude: "Key set (ends in 7Qx2)", or what it says without one. */
export const keyStatus = {
  set: (page: Page, key: string) => page.getByText(`Key set (ends in ${key.slice(-4)})`),
  missing: (page: Page) =>
    page.getByText("No key. Add it to the server's settings file, then restart Care Hub."),
};

/** Test connection, next to the key line. */
export const testConnection = (page: Page) => page.getByRole('button', { name: 'Test connection' });

/** The confirm or warning on top whose text matches. */
export const confirmWith = (page: Page, text: RegExp | string): Locator =>
  page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: text }).last();

/** What Turn on's confirm says for Writing help. */
export const WRITING_HELP_SENDS =
  /Writing help sends the text people select, and the text around it, to Anthropic['’]s Claude\. Only turn this on with Nav['’]s written OK\./;

/** The confirm a switch shows before it turns on: Turn on stays grey until the tick. */
export function turnOnConfirm(page: Page) {
  const dialog = confirmWith(page, /Nav/);
  return {
    dialog,
    navOk: dialog.getByRole('checkbox', { name: 'Nav has given the OK' }),
    turnOn: dialog.getByRole('button', { name: 'Turn on', exact: true }),
  };
}

/** A request from the browser that changes something under `prefix`, such as CLAUDE_API. */
export const writeTo = (prefix: string) => (request: Request) =>
  request.method() !== 'GET' && new URL(request.url()).pathname.startsWith(prefix);

/** Where the screens send their Claude requests. */
export const CLAUDE_API = '/api/claude/';

/** Turns a switch on in the open Settings → Claude. Returns the request that saved it. */
export async function turnOn(page: Page, name: Switch): Promise<Request> {
  await claudeSwitch(page, name).click();
  const confirm = turnOnConfirm(page);
  await confirm.navOk.check();
  const saved = page.waitForRequest(writeTo('/api/'));
  await confirm.turnOn.click();
  await expect(claudeSwitch(page, name), name).toBeChecked();
  return saved;
}

/** Turns one switch off in the open Settings → Claude. */
export async function turnOff(page: Page, name: Switch): Promise<void> {
  const control = claudeSwitch(page, name);
  await control.click();
  // Care Hub may ask before turning one off.
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^turn off/i });
  if (
    await confirm.waitFor({ timeout: 2_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await confirm.click();
  }
  await expect(control, name).not.toBeChecked();
}

/** Turns every Claude switch off as Avery (an Admin), in a window of its own. */
export async function turnEverySwitchOff(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAs(page, 'admin');
    await openClaudeSettings(page);
    for (const name of SWITCHES) {
      if (await claudeSwitch(page, name).isChecked()) await turnOff(page, name);
    }
  } finally {
    await context.close();
  }
}

/**
 * Runs `check` with these switches on. Avery (an Admin) turns them on in a window of her own, left
 * open on Settings → Claude; afterwards every switch is off again, whatever happened.
 */
export async function withSwitchesOn(
  browser: Browser,
  names: Switch[],
  check: (on: { admin: Page; saved: Request[] }) => Promise<void>,
): Promise<void> {
  test.skip(NO_KEY, WITH_KEY);
  const admin = await windowFor(browser, 'admin');
  try {
    await openClaudeSettings(admin);
    const saved: Request[] = [];
    for (const name of names) saved.push(await turnOn(admin, name));
    await check({ admin, saved });
  } finally {
    await admin.context().close();
    await turnEverySwitchOff(browser);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Sends a request someone's screen made again, as the person on `other`. */
export async function replay(other: Page, request: Request): Promise<APIResponse> {
  const { pathname, search } = new URL(request.url());
  const body: unknown = request.postDataJSON() ?? undefined;
  return (await apiFor(other)).send(request.method() as Method, pathname + search, body);
}

// ---- Claude on the screens (sections 3.2 to 3.5 and 4) ----

/** Nothing on the screen names or offers Claude (section 4: off means no Claude anywhere). */
export async function expectNoClaude(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(500); // whatever a key or click opens has had time to show
  await expect(page.getByText(/claude/i).filter({ visible: true }), where).toHaveCount(0);
  for (const role of ['button', 'link', 'menuitem', 'option', 'dialog', 'complementary'] as const) {
    await expect(page.getByRole(role, { name: /claude/i }), where).toHaveCount(0);
  }
}

const CHOICES = ['button', 'tab', 'radio', 'menuitemradio', 'menuitem', 'option'] as const;

/** Clicks a choice by its name, whether it's a button, tab, radio, menu entry or option. */
async function pick(scope: Page | Locator, name: string): Promise<void> {
  const each = CHOICES.map((role) => scope.getByRole(role, { name, exact: true }));
  await each
    .reduce((all, one) => all.or(one))
    .first()
    .click();
}

/** Two of the eight Ask Claude actions (section 3.2). */
type Action = 'Make shorter' | 'Improve writing';

/** Selects a block's text, then Ctrl+J → one of the Ask Claude actions (section 3.2). */
export async function askClaudeOn(editor: Editor, text: string, action: Action): Promise<void> {
  const block = editor.content.getByText(text, { exact: true });
  await block.click();
  await selectPart(block, text);
  await editor.page.keyboard.press('ControlOrMeta+J');
  await editor.page.getByRole('menuitem', { name: action, exact: true }).click();
}

/** A button of the box under the text with Claude's suggestion (section 3.2). */
export const suggestion = (page: Page, name: 'Replace' | 'Try again' | 'Discard') =>
  page.getByRole('button', { name, exact: true });

/** The assistant (section 3.3): floating, in the side panel or full screen. */
export const assistant = (page: Page): Locator =>
  page
    .getByRole('complementary', { name: /claude/i })
    .or(page.getByRole('dialog', { name: /claude/i }))
    .first();

/** Opens the assistant with Ctrl+Alt+J, unless it's open already. */
export async function openAssistant(page: Page): Promise<Locator> {
  const panel = assistant(page);
  await expect(page.getByRole('main')).toBeVisible();
  if (!(await panel.isVisible())) await page.keyboard.press('ControlOrMeta+Alt+J');
  await expect(panel).toBeVisible();
  return panel;
}

/** Moves the open assistant to the side panel. */
export async function toSidePanel(page: Page): Promise<void> {
  await pick(await openAssistant(page), 'Side panel');
}

/** A link in the assistant's answer to a page, by the page's ID: one of its sources. */
export const sourceLink = (page: Page, pageId: string): Locator =>
  assistant(page).locator(`a[href*="/p/${pageId}"]`);

/** The pages chip: what the assistant may read. */
export type Pages = 'This page' | 'All pages I can open' | 'No pages';

const NOT_FOUND = "I couldn't find that in the pages you can open.";

/**
 * Asks the assistant with the pages chip on `pages`, then waits for the answer, which ends with
 * Copy, or says nothing was found.
 */
export async function askAssistant(page: Page, question: string, pages: Pages, wait = true) {
  const panel = await openAssistant(page);
  const chip = panel.getByRole('button', { name: /This page|All pages I can open|No pages/ });
  if (!(await chip.innerText()).includes(pages)) {
    await chip.click();
    await pick(page.getByRole('menu').or(page.getByRole('listbox')).last(), pages);
  }
  const answers = async () =>
    (await panel.getByRole('button', { name: 'Copy', exact: true }).count()) +
    (await panel.getByText(NOT_FOUND).count());
  const before = await answers();
  await panel.getByRole('textbox').last().fill(question);
  await page.keyboard.press('Enter');
  if (wait) await expect.poll(answers).toBeGreaterThan(before);
}

/** "Claude is writing…", shown while an answer comes (section 4). */
export const writing = (page: Page) => page.getByText(/^Claude is writing/);

/** "+" at the end of a table's header, which lists the property types (Databases, 3.4). */
export const addProperty = (screen: DatabaseScreen) =>
  screen.grid.getByRole('button', { name: /^(\+|add a property|add property|new property)$/i });

/** Adds a Claude field that sums up one property (section 3.4). A new one is filled by hand. */
export async function addClaudeField(screen: DatabaseScreen, name: string, uses: string) {
  const { page } = screen;
  await addProperty(screen).click();
  await pick(page, 'Claude field');
  const settings = page.getByRole('dialog').or(page.getByRole('menu')).last();
  await settings.getByRole('textbox', { name: /name/i }).fill(name);
  await pick(settings, 'Summary');
  await settings.getByRole('checkbox', { name: uses, exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(screen.header(name)).toBeVisible();
}

/** Fill, in a cell of a Claude field. */
export const fillButton = (cell: Locator) =>
  cell.getByRole('button', { name: 'Fill', exact: true });

/** The column's Fill all, then the confirm it shows first. */
export async function fillAll(screen: DatabaseScreen, name: string): Promise<Locator> {
  await screen.header(name).click();
  await pick(screen.page, 'Fill all');
  return confirmWith(screen.page, /Fill \d+ rows\?/);
}

/** What Fill all's confirm says for this many rows. */
export const fillAllSays = (rows: number) =>
  new RegExp(`Fill ${rows} rows\\? This uses ${rows} of this month['’]s [\\d,]+ requests\\.`);

/** Summarize, on a meeting's notes page (section 3.5). */
export const summarize = (page: Page) =>
  page.getByRole('button', { name: 'Summarize', exact: true });

/** The warning before a summary, and its button that goes on. */
export function summaryWarning(page: Page) {
  const dialog = confirmWith(page, 'visible to everyone');
  return {
    dialog,
    says: 'The summary will be visible to everyone who can open this page.',
    goOn: dialog.getByRole('button', { name: /^(summarize|continue)$/i }),
  };
}

/** What a second Summarize asks before replacing the summary. */
export const replaceSummary = (page: Page) => confirmWith(page, /replac/i);

/** No button, link or menu item called Summarize on the screen. */
export async function expectNoSummarize(page: Page, where: string): Promise<void> {
  for (const role of ['button', 'link', 'menuitem'] as const) {
    await expect(page.getByRole(role, { name: /summari[sz]e/i }), where).toHaveCount(0);
  }
}
