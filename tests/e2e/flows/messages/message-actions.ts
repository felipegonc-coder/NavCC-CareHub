import type { Locator, Page, Request } from '@playwright/test';
import { apiFor, expect, type PersonKey } from '../_support/index.js';
import { clickAndConfirm, swapped } from '../settings/account-page.js';
import type { ApiAnswer } from '../status/status-page.js';
import { firstName, messageRow, word } from './messages-page.js';

// A message's menu, editing and deleting, reactions and message search (Messages spec, sections 2,
// 3, 5 and 6). The flows note the requests the screens send, so they can send the same request as
// someone else and check that the server refuses it.

/** "This message was deleted", which stays where a deleted message was (section 3). */
export const deletedLine = 'This message was deleted';

/** A request that changed something on the server, as the browser sent it, and its answer. */
export type Sent = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  data: unknown;
  status: number;
};

function bodyOf(request: Request): unknown {
  const text = request.postData();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Runs `action` and returns the first request to /api it made that changes something (not a GET)
 * and that `matches`, once it's answered. `matches` keeps out requests the page sends by itself,
 * such as marking a chat read.
 */
export async function capture(
  page: Page,
  matches: (request: Request) => boolean,
  action: () => Promise<unknown>,
): Promise<Sent> {
  const sent = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname.startsWith('/api/') &&
      request.method() !== 'GET' &&
      matches(request),
    { timeout: 10_000 },
  );
  // If the action fails first, its error is the one to report.
  sent.catch(() => undefined);
  await action();
  const request = await sent;
  const response = await request.response();
  const { pathname, search } = new URL(request.url());
  return {
    method: request.method() as Sent['method'],
    path: pathname + search,
    data: bodyOf(request),
    status: response?.status() ?? 0,
  };
}

/**
 * Sends a noted request again as the person signed in on `page`, about another message: every `from`
 * ID in its address and body becomes `to`. Returns the status code.
 */
export async function sendAgain(page: Page, sent: Sent, from: string, to: string): Promise<number> {
  const api = await apiFor(page);
  const answer = await api.send(
    sent.method,
    sent.path.replaceAll(from, to),
    swapped(sent.data, from, to),
  );
  return answer.status();
}

/**
 * The IDs of the things in `answers` that have `text` as one of their values: the messages with that
 * text, as the server sent them. Two IDs for one text means it was saved twice.
 */
export function idsWithText(answers: ApiAnswer[], text: string): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      const { id } = value as { id?: unknown };
      const values = Object.values(value);
      if ((typeof id === 'string' || typeof id === 'number') && values.includes(text)) {
        ids.add(String(id));
      }
      values.forEach(visit);
    }
  };
  answers.forEach((answer) => visit(answer.body));
  return [...ids];
}

/** The IDs for `text` in the answers, once the server has sent it at least once. */
export async function sentIds(answers: ApiAnswer[], text: string): Promise<string[]> {
  await expect
    .poll(() => idsWithText(answers, text).length, { message: `the server sends "${text}"` })
    .toBeGreaterThan(0);
  return idsWithText(answers, text);
}

// ---- A message's menu (section 6: Edit, Delete, Copy text, Add reaction, Download files) ----

/** The button that opens a message's menu, shown when pointing at the message. */
const menuButtonName =
  /^(more|more actions|more options|actions|options|message (actions|menu|options))$/i;

/**
 * Opens a message's menu: with its button when pointing at the message, or with Enter on the
 * message (section 6). Every message's menu has Copy text.
 */
export async function openMessageMenu(page: Page, text: string): Promise<Locator> {
  const row = messageRow(page, text);
  await row.hover();
  const button = row.getByRole('button', { name: menuButtonName }).first();
  const pointed = await button.waitFor({ timeout: 2_000 }).then(
    () => true,
    () => false,
  );
  if (pointed) {
    await button.click();
  } else {
    await row.focus();
    await row.press('Enter');
  }
  const menu = page
    .getByRole('menu')
    .filter({ has: page.getByRole('menuitem', { name: 'Copy text' }) })
    .last();
  await expect(menu).toBeVisible();
  return menu;
}

/** Edit in the message's menu: replaces its text and saves with Enter. Returns the request sent. */
export async function editMessage(page: Page, text: string, newText: string): Promise<Sent> {
  const menu = await openMessageMenu(page, text);
  await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  // The edit box takes the focus, in the message or in the composer.
  const box = page.locator(':focus');
  await expect(box).toBeEditable();
  await box.fill(newText);
  return capture(
    page,
    (request) => (request.postData() ?? '').includes(newText),
    () => box.press('Enter'),
  );
}

/** Delete in the message's menu, and its confirmation. Returns the request sent. */
export async function deleteMessage(page: Page, text: string): Promise<Sent> {
  const menu = await openMessageMenu(page, text);
  return capture(
    page,
    (request) => request.method() === 'DELETE' || /delete/i.test(request.url()),
    () =>
      clickAndConfirm(
        page,
        menu.getByRole('menuitem', { name: 'Delete', exact: true }),
        /^delete/i,
      ),
  );
}

// ---- Reactions (section 3) ----

const thumbsUp = '(?:👍|thumbs up)';

/** The 👍 chip under a message: the emoji and how many reacted, for example "👍 2". */
export function thumbsUpChip(page: Page, text: string): Locator {
  const name = new RegExp(`^(?=.*${thumbsUp})(?=.*\\d)`, 'i');
  return messageRow(page, text).getByRole('button', { name });
}

/** How many reacted, from the chip's name; 0 without a chip. */
export async function reactionCount(chip: Locator): Promise<number> {
  if ((await chip.count()) === 0) return 0;
  const name = /^- button "(.*)"/m.exec(await chip.first().ariaSnapshot())?.[1] ?? '';
  return Number(/\b\d+\b/.exec(name)?.[0] ?? 0);
}

/** Whether a chip shows the person's own reaction: pressed, or "you" in its name. */
export async function isOwnReaction(chip: Locator): Promise<boolean> {
  const snapshot = await chip.first().ariaSnapshot();
  return /\[pressed\]/.test(snapshot) || /^- button ".*\byou\b.*"/im.test(snapshot);
}

/**
 * 👍 from the quick reactions shown when pointing at a message, or from Add reaction in its menu.
 * Returns the request sent.
 */
export async function reactThumbsUp(page: Page, text: string): Promise<Sent> {
  const row = messageRow(page, text);
  await row.hover();
  // A quick reaction has no count in its name; a chip has one.
  const quick = row.getByRole('button', { name: new RegExp(`^(?!.*\\d)(?=.*${thumbsUp})`, 'i') });
  const pointed = await quick
    .first()
    .waitFor({ timeout: 2_000 })
    .then(
      () => true,
      () => false,
    );
  const isReaction = (request: Request) =>
    /react/i.test(request.url()) || /react|👍/i.test(request.postData() ?? '');
  return capture(page, isReaction, async () => {
    if (pointed) return quick.first().click();
    const menu = await openMessageMenu(page, text);
    await menu.getByRole('menuitem', { name: /^add reaction/i }).click();
    const picker = page.getByRole('dialog').last();
    const emoji = { name: new RegExp(thumbsUp, 'i') };
    await picker
      .getByRole('button', emoji)
      .or(picker.getByRole('option', emoji))
      .or(picker.getByRole('gridcell', emoji))
      .first()
      .click();
  });
}

/** Who reacted, from the tooltip shown when pointing at a chip ("Avery Lin and Eli Brooks"). */
export async function whoReacted(page: Page, chip: Locator): Promise<string> {
  await chip.first().hover();
  const tooltip = page.getByRole('tooltip').last();
  await expect(tooltip).toBeVisible();
  return tooltip.innerText();
}

// ---- Message search (section 2, Search results, and section 3) ----

/** The search box at the top of the chat list. */
export function searchBox(page: Page): Locator {
  const main = page.getByRole('main');
  return main
    .getByRole('searchbox')
    .or(main.getByRole('textbox', { name: /^search/i }))
    .first();
}

/** A message in the search results, by its text (matching words may be marked inside it). */
export function messageResult(page: Page, text: string): Locator {
  const main = page.getByRole('main');
  return main
    .getByRole('option')
    .or(main.getByRole('link'))
    .or(main.getByRole('button'))
    .filter({ hasText: text })
    .first();
}

/** "No messages match." with Clear filters (section 2, States). */
export const noMatches = (page: Page) => page.getByRole('main').getByText('No messages match.');

/** The From filter: picks one person. */
export async function filterFrom(page: Page, who: PersonKey): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('button', { name: /^from\b/i })
    .first()
    .click();
  const name = { name: word(firstName[who]) };
  const person = page
    .getByRole('option', name)
    .or(page.getByRole('menuitemradio', name))
    .or(page.getByRole('menuitemcheckbox', name))
    .or(page.getByRole('menuitem', name))
    .first();
  // A long list of people may need the name typed first.
  if (
    !(await person.waitFor({ timeout: 2_000 }).then(
      () => true,
      () => false,
    ))
  ) {
    await page.keyboard.type(firstName[who]);
  }
  await person.click();
}
