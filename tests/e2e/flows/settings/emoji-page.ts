import type { APIResponse, Locator, Page } from '@playwright/test';
import { apiFor, expect, test } from '../_support/index.js';
import { choice } from '../sharing/share-dialog.js';
import { clickAndConfirm } from './account-page.js';
import { openSettings } from './settings-page.js';

// Settings → Emoji (Settings and members, section 3.5): the workspace's custom emoji, and using
// one by name in pages, comments and messages.

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The name on its own, not inside a longer one ("blue-pine" but not "blue-pine-2"). */
export const emojiName = (name: string) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`);

/** The list of custom emoji: one row or list item per emoji, with its picture. */
export function emojiRows(page: Page): Locator {
  const main = page.getByRole('dialog').or(page.getByRole('main')).last();
  return main
    .getByRole('row')
    .filter({ has: page.getByRole('img') })
    .or(main.getByRole('listitem').filter({ has: page.getByRole('img') }));
}

/** The custom emoji `name` in the list. */
export function emojiRow(page: Page, name: string): Locator {
  return emojiRows(page).filter({ hasText: emojiName(name) });
}

/** The custom emoji shown as a picture in `scope`, found by its name (its text alternative). */
export function emojiIn(scope: Locator, name: string): Locator {
  return scope.getByRole('img', { name: emojiName(name) });
}

/** Add emoji: picks the picture and types the name; returns the dialog, not added yet. */
export async function fillEmoji(page: Page, name: string, file: Buffer): Promise<Locator> {
  await page.getByRole('button', { name: /^add( custom)? emoji$/i }).click();
  // The Add emoji dialog, not Settings around it: the one with the picture's file box.
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.locator('input[type="file"]') })
    .last();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'fictional-emoji.png',
    mimeType: 'image/png',
    buffer: file,
  });
  await dialog.getByLabel(/^name/i).fill(name);
  return dialog;
}

/** The dialog's Add button. */
export const addButton = (dialog: Locator) =>
  dialog.getByRole('button', { name: /^(add|save|upload)( emoji)?$/i });

/** Adds the emoji filled in (a button that can't be pressed yet isn't pressed). */
export async function submitEmoji(dialog: Locator): Promise<void> {
  if (await addButton(dialog).isEnabled()) await addButton(dialog).click();
}

/** Add emoji with a picture and a name, and waits for the dialog to close. */
export async function addEmoji(page: Page, name: string, file: Buffer): Promise<void> {
  const dialog = await fillEmoji(page, name, file);
  await submitEmoji(dialog);
  await expect(dialog).toBeHidden();
}

/** The name rule (section 3.5): 2 to 32 lowercase letters, numbers, dashes or underscores. */
export const allowedName = /^[a-z0-9_-]{2,32}$/;

/** The dialog refused the emoji: an alert, a field marked invalid, or Add can't be pressed. */
export function refusal(dialog: Locator): Locator {
  return dialog
    .getByRole('alert')
    .or(dialog.locator('[aria-invalid="true"]'))
    .or(addButton(dialog).and(dialog.locator('[disabled], [aria-disabled="true"]')))
    .first();
}

/** Deletes a custom emoji from its row (a button or the row's menu), confirming if asked. */
export async function deleteEmoji(page: Page, name: string): Promise<void> {
  const row = emojiRow(page, name);
  const button = row.getByRole('button', { name: /^(delete|remove)/i });
  if (await button.count()) {
    await clickAndConfirm(page, button.first(), /^(delete|remove)/i);
  } else {
    await row
      .getByRole('button', { name: /more|actions|options|…|⋯/i })
      .first()
      .click();
    const item = page.getByRole('menuitem', { name: /^(delete|remove)/i });
    await clickAndConfirm(page, item, /^(delete|remove)/i);
  }
  await expect(row).toHaveCount(0);
}

/** Settings → Emoji, with any `name` left over from an earlier run deleted first. */
export async function openEmoji(page: Page, leftover?: string): Promise<void> {
  await openSettings(page, 'Emoji');
  if (leftover && (await emojiRow(page, leftover).count())) await deleteEmoji(page, leftover);
}

/**
 * Puts the custom emoji `name` where the cursor is: ":" and its name, then the suggestion. Where
 * ":" suggests nothing, the emoji button next to the box (`picker`) and a search in its picker.
 */
export async function insertEmoji(page: Page, name: string, picker?: Locator): Promise<void> {
  await page.keyboard.type(`:${name}`);
  const suggestion = choice(page, emojiName(name));
  if (
    await suggestion.waitFor({ timeout: 3_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await suggestion.click();
    return;
  }
  if (!picker) throw new Error(`Typing ":${name}" suggested no emoji`);
  for (let i = 0; i <= name.length; i += 1) await page.keyboard.press('Backspace');
  await picker.click();
  const search = page
    .getByRole('searchbox')
    .or(page.getByPlaceholder(/search/i))
    .last();
  await search.fill(name);
  await page
    .getByRole('button', { name: emojiName(name) })
    .or(page.getByRole('option', { name: emojiName(name) }))
    .or(page.getByRole('gridcell', { name: emojiName(name) }))
    .first()
    .click();
}

/** The emoji button next to a message or comment box. */
export function emojiButton(scope: Locator): Locator {
  return scope.getByRole('button', { name: /emoji/i }).first();
}

// ---- Many emoji at once, through the API (the 500 limit) ----
// Assumes the API behind the Emoji screen: GET /api/emoji lists them ({ emoji: [...] } or a list),
// POST /api/emoji takes a form with `name` and the picture as `file` and answers with the emoji
// ({ emoji: { id } } or { id }), and DELETE /api/emoji/:id deletes one. To be lined up with
// docs/team/testing/settings.md when it lands.

type CustomEmoji = { id: string; name: string };

/** The workspace's custom emoji, through the API. */
export async function listEmoji(page: Page): Promise<CustomEmoji[]> {
  const answer = await (
    await apiFor(page)
  ).get<{ emoji?: CustomEmoji[] } | CustomEmoji[]>('/api/emoji');
  return Array.isArray(answer) ? answer : (answer.emoji ?? []);
}

/** Adds a custom emoji through the API as the person on `page`; returns the raw answer. */
export async function sendEmoji(page: Page, name: string, file: Buffer): Promise<APIResponse> {
  // A form upload, so not apiFor's JSON: the same CSRF header and Origin (decision 0007, 3.1).
  const baseURL = test.info().project.use.baseURL ?? '';
  const cookies = await page.context().cookies(baseURL || undefined);
  const csrf = cookies.find((cookie) => cookie.name === 'carehub_csrf')?.value ?? '';
  return page.request.fetch('/api/emoji', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrf, Origin: new URL(baseURL).origin },
    multipart: { name, file: { name: `${name}.png`, mimeType: 'image/png', buffer: file } },
  });
}

/** The id of the emoji POST /api/emoji added. */
export async function addedId(response: APIResponse): Promise<string> {
  const answer = (await response.json()) as { id?: string; emoji?: { id?: string } };
  const id = answer.emoji?.id ?? answer.id;
  if (!id) throw new Error(`No emoji id in the answer: ${JSON.stringify(answer)}`);
  return id;
}
