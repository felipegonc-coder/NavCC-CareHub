import type { Browser, Locator, Page } from '@playwright/test';
import { apiFor, expect, signInAs, type PersonKey } from '../_support/index.js';
import type { TestFile } from './files.js';

/** Messages lives at /messages (docs/team/testing.md); the 🔔 Care Hub chat is inside it. */
export const messagesPath = '/messages';

/**
 * First names of the seeded people (decision 0007, section 2.5). The spec's examples use Sam, Riley
 * and Jordan; in these flows Eli, Casey and Val play them.
 */
export const firstName: Record<PersonKey, string> = {
  admin: 'Avery',
  editor: 'Eli',
  commenter: 'Casey',
  viewer: 'Val',
};

/** The 🔔 chat's line under its header (Messages spec, section 2). */
export const noticesIntro = 'Care Hub sends reminders, automations and alerts here.';

/** `text` with its RegExp characters escaped. */
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole word or name, for example `word('Val')` matches "Val Viewer" but not "Valid". */
export const word = (text: string) => new RegExp(`\\b${escape(text)}\\b`);

/** Text that starts with `text`, for chat rows whose name is followed by a preview and a time. */
export const startsWith = (text: string) => new RegExp(`^\\W*${escape(text)}`);

/** Opens Messages and waits for the chat list. */
export async function openMessages(page: Page): Promise<Locator> {
  await page.goto(messagesPath);
  await expect(page).toHaveTitle(/^Care Hub/);
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: 'New message' })).toBeVisible();
  return main;
}

/** Signs `who` in, in a window of their own (separate cookies), with Messages open. */
export async function windowFor(browser: Browser, who: PersonKey): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  await openMessages(page);
  return page;
}

/** A chat in the chat list, by the start of its name. The list comes before the open chat. */
export function chatRow(page: Page, name: string): Locator {
  const main = page.getByRole('main');
  const named = { name: startsWith(name) };
  return main.getByRole('link', named).or(main.getByRole('button', named)).first();
}

/** Opens a chat from the chat list. */
export async function openChat(page: Page, name: string): Promise<void> {
  await chatRow(page, name).click();
  await expect(
    page.getByRole('main').getByRole('heading', { name: startsWith(name) }),
  ).toBeVisible();
}

/** The message box of the open chat (the search box at the top of the list is a different one). */
export function composer(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('textbox', { name: /^(?!search)/i })
    .last();
}

/** Types a message in the open chat and sends it with Enter. */
export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

/** A message's text in the open chat (after the chat list's previews). */
export function message(page: Page, text: string): Locator {
  return page.getByRole('main').getByText(text, { exact: true }).last();
}

/** The whole message with `text`: an article or list item in the open chat. */
export function messageRow(page: Page, text: string): Locator {
  const main = page.getByRole('main');
  return main.getByRole('article').or(main.getByRole('listitem')).filter({ hasText: text }).last();
}

/**
 * A line about a change in the chat, from its words in order, for example
 * `changeLine(page, 'Avery', 'added', 'Val')` for "Avery Lin added Val Ortiz".
 */
export function changeLine(page: Page, ...words: string[]): Locator {
  const line = new RegExp(words.map((part) => `\\b${escape(part)}\\b`).join('.*'));
  return page.getByRole('main').getByText(line).last();
}

/** The unread count in the sidebar's Messages link (its name ends ", 3 new"); 0 without one. */
export async function messagesBadge(page: Page): Promise<number> {
  const link = page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('link', { name: /^Messages\b/ });
  const match = /Messages, (\d+)\+? new/.exec(await link.ariaSnapshot());
  return match ? Number(match[1]) : 0;
}

/** The badge once it has stopped changing (reading a chat marks it read a moment later). */
export async function steadyBadge(page: Page): Promise<number> {
  let last = await messagesBadge(page);
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(500);
        const now = await messagesBadge(page);
        const steady = now === last;
        last = now;
        return steady;
      },
      { timeout: 10_000, message: 'the Messages badge stops changing' },
    )
    .toBe(true);
  return last;
}

/** The picture the viewer shows: the address of the largest picture in it. */
export function shownPicture(viewer: Locator): Promise<string> {
  return viewer.locator('img').evaluateAll((pictures) => {
    const area = (picture: Element) => picture.clientWidth * picture.clientHeight;
    const largest = [...pictures].sort((a, b) => area(b) - area(a))[0];
    return largest instanceof HTMLImageElement ? largest.currentSrc || largest.src : '';
  });
}

/** Attach in the composer: opens the file chooser and picks `files`. */
export async function attach(page: Page, files: TestFile[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('main').getByRole('button', { name: 'Attach' }).click();
  await (await chooser).setFiles(files);
}

/** Picks people by first name in the open dialog's people box. */
async function pickPeople(page: Page, who: PersonKey[]): Promise<void> {
  const dialog = page.getByRole('dialog');
  const box = dialog
    .getByRole('combobox')
    .or(dialog.getByRole('textbox', { name: /people|^to\b|search|add/i }))
    .first();
  for (const person of who) {
    await box.fill(firstName[person]);
    await page
      .getByRole('option', { name: word(firstName[person]) })
      .first()
      .click();
  }
}

/**
 * New message: picks the people and starts the chat. One person opens the direct chat with them;
 * two or more start a group, named `groupName`.
 */
export async function startChat(
  page: Page,
  who: [PersonKey, ...PersonKey[]],
  groupName?: string,
): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: 'New message' }).click();
  const dialog = page.getByRole('dialog');
  await pickPeople(page, who);
  if (groupName) await dialog.getByRole('textbox', { name: /group name|^name/i }).fill(groupName);
  // One person may open the direct chat straight away; a group needs the button.
  const start = dialog.getByRole('button', {
    name: /^(start chat|start group|create group|start|create|open chat)$/i,
  });
  if (who.length > 1 || (await start.isVisible())) await start.click();
  await expect(dialog).toBeHidden();
  const header = groupName ?? firstName[who[0]];
  await expect(
    page.getByRole('main').getByRole('heading', { name: startsWith(header) }),
  ).toBeVisible();
}

/** The open chat's header menu (Rename, Add people, Mute, Mark as unread, Leave), if it has one. */
export function chatMenuButton(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('button', {
      name: /^(chat (menu|options|actions|settings)|more( actions| options)?|options)$/i,
    })
    .first();
}

/** Opens the header menu and chooses `item`. */
export async function chooseInChatMenu(page: Page, item: string): Promise<void> {
  await chatMenuButton(page).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Add people: picks them, checks the warning about earlier messages, and adds them. */
export async function addPeople(page: Page, who: PersonKey[]): Promise<void> {
  await chooseInChatMenu(page, 'Add people');
  const dialog = page.getByRole('dialog');
  await pickPeople(page, who);
  await expect(dialog.getByText("They'll see earlier messages.")).toBeVisible();
  await dialog.getByRole('button', { name: /^(add|add people)$/i }).click();
  await expect(dialog).toBeHidden();
}

/** A fictional page in `page`'s person's private space, made through the API (decision 0007, 4.1). */
export async function createPrivatePage(page: Page, title: string): Promise<string> {
  type Space = { id: string; kind?: string; type?: string; name?: string };
  const api = await apiFor(page);
  const answer = await api.get<Space[] | { spaces: Space[] }>('/api/spaces');
  const spaces = Array.isArray(answer) ? answer : answer.spaces;
  const own = spaces.find((space) =>
    /private/i.test(`${space.kind ?? space.type ?? ''} ${space.name ?? ''}`),
  );
  const created = await api.post<{ id?: string; page?: { id: string } }>('/api/pages', {
    spaceId: own?.id,
    kind: 'page',
    title,
  });
  const id = created.id ?? created.page?.id;
  if (!id) throw new Error(`POST /api/pages gave no page ID: ${JSON.stringify(created)}`);
  return id;
}

/** Shares a page with people through its Share dialog (Roles and permissions spec, section 3). */
export async function sharePage(page: Page, pageId: string, who: PersonKey[]): Promise<void> {
  await page.goto(`/p/${pageId}`);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await pickPeople(page, who);
  await dialog.getByRole('button', { name: 'Invite' }).click();
  for (const person of who) {
    await expect(dialog.getByText(word(firstName[person])).first()).toBeVisible();
  }
  await page.keyboard.press('Escape');
}
