import { createHmac } from 'node:crypto';
import type { Browser, BrowserContextOptions, Locator, Page, Request } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import type { Me } from './settings-data.js';
import { openSettings } from './settings-page.js';

// My account (Settings and members, section 3.1) for people who sign in with their own password:
// the sign-in screen, Password, 2-step verification and Devices. The people are new for each test
// (newPerson), so changing their password or sessions never touches anyone else's run.

type Credentials = { email: string; password: string };
type Scope = Page | Locator;

/** Password fields only: a "Show password" button has the word in its name too. */
export function passwordBox(scope: Scope, label: RegExp = /password/i): Locator {
  return scope.getByLabel(label).and(scope.locator('input'));
}

/** Whether the person on `page` is signed in to the workspace (GET /api/auth/me). */
export async function signedIn(page: Page): Promise<boolean> {
  const response = await (await apiFor(page)).send('GET', '/api/auth/me');
  if (!response.ok()) return false;
  return ((await response.json()) as Me).member !== null;
}

/** A window of its own (its own cookies), like another device. */
export async function newDevice(
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<Page> {
  return (await browser.newContext(options)).newPage();
}

/** The sign-in screen: sign-in name and password, then Sign in. */
export async function enterPassword(page: Page, { email, password }: Credentials): Promise<void> {
  await page.goto('/');
  await page
    .getByLabel(/email|sign-in name/i)
    .first()
    .fill(email);
  await passwordBox(page).first().fill(password);
  await page.getByRole('button', { name: /^(sign in|log in|continue)$/i }).click();
}

/** Signs in with a password on a new device and waits until it's in. */
export async function signInOn(
  browser: Browser,
  person: Credentials,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const page = await newDevice(browser, options);
  await enterPassword(page, person);
  await expect
    .poll(() => signedIn(page), { message: `${person.email} should be signed in` })
    .toBe(true);
  return page;
}

/** Signing in was refused: the sign-in screen stays, with a message, and nobody is signed in. */
export async function expectRefused(page: Page): Promise<void> {
  await expect(
    page
      .getByRole('alert')
      .or(page.getByText(/wrong|incorrect|didn['’]t work|invalid|try again/i))
      .first(),
  ).toBeVisible();
  expect(await signedIn(page), 'nobody should be signed in').toBe(false);
}

/** Polls until the person on `page` is signed out; returns how long it took in ms. */
export async function signedOutWithin(page: Page, since: number): Promise<number> {
  await expect
    .poll(() => signedIn(page), { timeout: 10_000, intervals: [250], message: 'signed out' })
    .toBe(false);
  return Date.now() - since;
}

// ---- Password ----

/** A request that changes something on the server (not a GET). */
function isApiWrite(request: Request): boolean {
  return new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET';
}

/** The password change as the browser sent it, so it can be tried again with other values. */
export type SentChange = {
  method: string;
  path: string;
  data: Record<string, unknown>;
  status: number;
};

/**
 * My account → Change password: types the current and the new password (twice if asked) and saves.
 * Returns the request it sent, or null when the screen refused it before sending anything.
 */
export async function changePassword(
  page: Page,
  current: string,
  next: string,
): Promise<SentChange | null> {
  await openSettings(page, 'My account');
  await page
    .getByRole('button', { name: /^change( password)?$/i })
    .first()
    .click();
  const form = page.getByRole('dialog').last();
  await passwordBox(form, /current/i)
    .first()
    .fill(current);
  for (const box of await passwordBox(form, /new|again|confirm|repeat/i).all())
    await box.fill(next);
  const sent = page.waitForRequest(isApiWrite, { timeout: 3_000 }).catch(() => null);
  await form
    .getByRole('button', { name: /^(change|save|update|set)( new)?( password)?$/i })
    .last()
    .click();
  const request = await sent;
  if (!request) return null;
  const response = await request.response();
  const { pathname, search } = new URL(request.url());
  return {
    method: request.method(),
    path: pathname + search,
    data: (request.postDataJSON() ?? {}) as Record<string, unknown>,
    status: response?.status() ?? 0,
  };
}

/**
 * The form's refusal of a new password: an alert, or the new password box marked invalid (errors
 * name the field and keep the typed value, section 2). A hint such as "At least 12 characters"
 * that is always there doesn't count.
 */
export function passwordRefusal(page: Page): Locator {
  const form = page.getByRole('dialog').last();
  return form
    .getByRole('alert')
    .or(passwordBox(form, /new/i).and(form.locator('[aria-invalid="true"]')))
    .first();
}

/** `data` with every string `from` replaced by `to`, at any depth (to try a sent request again). */
export function swapped<T>(data: T, from: string, to: string): T {
  if (data === from) return to as T;
  if (Array.isArray(data)) return data.map((item: unknown) => swapped(item, from, to)) as T;
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, swapped(value, from, to)]),
    ) as T;
  }
  return data;
}

// ---- 2-step verification ----

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, as authenticator keys are written (spaces and dashes are ignored). */
function fromBase32(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`Not an authenticator key: ${text}`);
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The 30-second step of an authenticator code that `time` falls in. */
export const codeStep = (time: number) => Math.floor(time / 30_000);

/** The 6-digit code an authenticator app shows for `key` at `time` (RFC 6238: SHA-1, 30 s). */
export function authenticatorCode(key: string, time: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(codeStep(time)));
  const hmac = createHmac('sha1', fromBase32(key)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** The authenticator side of 2-step verification: the key, the recovery codes, the steps used. */
export type Authenticator = { key: string; recoveryCodes: string[]; used: Set<number> };

/**
 * A code from a 30-second step not used yet, as a real authenticator app would give the next time
 * (a server may refuse a code twice). Waits for the next step if needed, at most about 30 seconds,
 * and never hands out a code in the last 2 seconds of its step.
 */
export async function freshCode(page: Page, app: Authenticator): Promise<string> {
  for (;;) {
    const now = Date.now();
    const left = 30_000 - (now % 30_000);
    if (!app.used.has(codeStep(now)) && left > 2_000) {
      app.used.add(codeStep(now));
      return authenticatorCode(app.key, now);
    }
    await page.waitForTimeout(left + 250);
  }
}

/** The key shown for typing into an authenticator app: base32, at least 16 characters. */
async function shownKey(dialog: Locator): Promise<string> {
  const reveal = dialog.getByRole('button', { name: /(type|enter|show|can['’]t scan).*key/i });
  if (await reveal.count()) await reveal.first().click();
  const uri = /otpauth:\/\/totp\/[^"'\s<>]*[?&]secret=([A-Z2-7]+)/i.exec(await dialog.innerHTML());
  if (uri?.[1]) return uri[1];
  const shown = [
    await dialog.innerText(),
    ...(await Promise.all(
      (await dialog.getByRole('textbox').all()).map((box) => box.inputValue()),
    )),
  ].join('\n');
  const keys = (shown.match(/[A-Z2-7]{4}(?:[ -]?[A-Z2-7]{4}){3,}[A-Z2-7]*/g) ?? []).filter((key) =>
    /[2-7]/.test(key),
  );
  if (!keys[0]) throw new Error(`No authenticator key in the 2-step dialog: ${shown}`);
  return keys[0].replace(/[ -]/g, '');
}

/** One recovery code: letters and digits, maybe in dash-separated groups, with a digit in it. */
const recoveryCode = /^(?=.*\d)[A-Za-z0-9]{3,}(?:-[A-Za-z0-9]{3,})*$/;

/** The recovery codes the dialog shows once: list items, or else lines that look like codes. */
async function shownRecoveryCodes(dialog: Locator): Promise<string[]> {
  await expect(dialog.getByText(/recovery codes?/i).first()).toBeVisible();
  const items = (await dialog.getByRole('listitem').allInnerTexts()).map((text) => text.trim());
  const lines = (await dialog.innerText()).split('\n').map((text) => text.trim());
  const codes = items.filter((text) => recoveryCode.test(text) && text.length >= 8);
  return [
    ...new Set(
      codes.length ? codes : lines.filter((text) => recoveryCode.test(text) && text.length >= 8),
    ),
  ];
}

/** My account's 2-step verification control: Turn on or Turn off, or a switch. */
function twoStepControl(page: Page, action: 'on' | 'off'): Locator {
  const turn = action === 'on' ? /^(turn on|set up)/i : /^turn off/i;
  return page
    .getByRole('switch', { name: /2-step/i })
    .or(page.getByRole('button', { name: /2-step/i }).filter({ hasText: turn }))
    .or(page.getByRole('button', { name: turn }))
    .first();
}

/**
 * The 2-step setup in `area` (My account's dialog, or the sign-in screen when the workspace requires
 * it): reads the key the way someone without a camera would type it, enters a code, and keeps the
 * recovery codes shown once.
 */
export async function setUpTwoStep(page: Page, area: Locator): Promise<Authenticator> {
  const app: Authenticator = { key: await shownKey(area), recoveryCodes: [], used: new Set() };
  await area
    .getByLabel(/code/i)
    .and(area.locator('input'))
    .first()
    .fill(await freshCode(page, app));
  await area
    .getByRole('button', { name: /^(verify|turn on|confirm|continue|next|done)$/i })
    .first()
    .click();
  app.recoveryCodes = await shownRecoveryCodes(area);
  await area
    .getByRole('button', {
      name: /^(done|close|continue|finish|i['’]ve saved (them|these|my codes)|(continue|go) to (care hub|home))$/i,
    })
    .first()
    .click();
  return app;
}

/** My account → 2-step verification → Turn on, then the setup in its dialog. */
export async function turnOnTwoStep(page: Page): Promise<Authenticator> {
  await openSettings(page, 'My account');
  await twoStepControl(page, 'on').click();
  return setUpTwoStep(page, page.getByRole('dialog').last());
}

/** Care Hub asking someone to set up 2-step verification before they get in (section 3.5). */
export const setupRequest = (page: Page) =>
  page.getByText(/(set up|turn on|requires?) 2-step/i).first();

/**
 * The 2-step setup Care Hub asks for at sign-in when the workspace requires it: waits for it,
 * presses its start button if it has one, and returns its dialog, or else the whole screen.
 */
export async function twoStepSetup(page: Page): Promise<Locator> {
  await expect(setupRequest(page), 'Care Hub asks to set up 2-step verification').toBeVisible();
  const start = page
    .getByRole('button', {
      name: /^(set up|get started|start|turn on)( 2-step( verification)?)?$/i,
    })
    .first();
  if ((await start.isVisible()) && !(await codeBox(page).isVisible())) await start.click();
  const dialog = page.getByRole('dialog');
  return (await dialog.count()) ? dialog.last() : page.locator('body');
}

/** My account → 2-step verification → Turn off, with the password and a code (section 3.1). */
export async function turnOffTwoStep(page: Page, password: string, code: string): Promise<void> {
  await openSettings(page, 'My account');
  await twoStepControl(page, 'off').click();
  const dialog = page.getByRole('dialog').last();
  await passwordBox(dialog).first().fill(password);
  await dialog.getByLabel(/code/i).and(dialog.locator('input')).first().fill(code);
  const sent = page.waitForResponse((response) => isApiWrite(response.request()));
  await dialog.getByRole('button', { name: /^turn off( 2-step( verification)?)?$/i }).click();
  expect((await sent).ok(), 'turning 2-step verification off should be accepted').toBe(true);
}

/** The sign-in screen's 2-step step: the box for the 6-digit code. */
export function codeBox(page: Page): Locator {
  return page.getByLabel(/code/i).and(page.locator('input')).first();
}

/** Types into a 2-step box on the sign-in screen and confirms. */
export async function enterCode(page: Page, box: Locator, code: string): Promise<void> {
  await box.fill(code);
  await page.getByRole('button', { name: /^(verify|sign in|continue|confirm)$/i }).click();
}

/** "Use a recovery code" on the sign-in screen, then its box. */
export async function recoveryBox(page: Page): Promise<Locator> {
  await page
    .getByRole('button', { name: /recovery code/i })
    .or(page.getByRole('link', { name: /recovery code/i }))
    .first()
    .click();
  return page
    .getByLabel(/recovery code/i)
    .and(page.locator('input'))
    .first();
}

// ---- Devices ----

/** "Sign out" for one session (not "Sign out of all other devices"). */
const signOutOne = /^sign out(?! of all)/i;

/**
 * My account → Devices: the signed-in sessions, each with Sign out, or "This device". Only inside
 * the part of the page under the Devices heading.
 */
export function sessionEntries(page: Page): Locator {
  const rows = page
    .getByRole('row')
    .filter({ hasNot: page.getByRole('columnheader') })
    .or(page.getByRole('listitem'));
  const area = page
    .locator('section, [role="region"], div')
    .filter({ has: page.getByRole('heading', { name: 'Devices', exact: true }) })
    .filter({ has: rows })
    .last();
  const entries = area
    .getByRole('row')
    .filter({ hasNot: page.getByRole('columnheader') })
    .or(area.getByRole('listitem'));
  return entries
    .filter({ has: page.getByRole('button', { name: signOutOne }) })
    .or(entries.filter({ hasText: /this device/i }));
}

/** Dialogs open on the page: Settings itself may be one, and a confirmation adds another. */
const dialogs = (page: Page) => page.getByRole('alertdialog').or(page.getByRole('dialog'));

/** Clicks `button`, then confirms with `confirm` if a new dialog opens for it. */
export async function clickAndConfirm(page: Page, button: Locator, confirm: RegExp): Promise<void> {
  const before = await dialogs(page).count();
  await button.click();
  const asked = await expect
    .poll(() => dialogs(page).count(), { timeout: 2_000 })
    .toBeGreaterThan(before)
    .then(
      () => true,
      () => false,
    );
  if (asked) await dialogs(page).last().getByRole('button', { name: confirm }).click();
}

/** Sign out for one session, and the confirmation if Care Hub asks. */
export async function signOutSession(page: Page, entry: Locator): Promise<void> {
  await clickAndConfirm(page, entry.getByRole('button', { name: signOutOne }), /^sign out/i);
}

/** Sign out of all other devices, and the confirmation if Care Hub asks. */
export async function signOutOthers(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Sign out of all other devices', exact: true });
  await clickAndConfirm(page, button, /^sign out/i);
}
