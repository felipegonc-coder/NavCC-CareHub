import type { Browser, Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { PageComments } from '../comments/page-comments.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { me, newPerson, type NewPerson } from '../settings/settings-data.js';
import { memberRow, membersTab, openSettings } from '../settings/settings-page.js';
import { ShareDialog, choice, nameOf, type Level } from '../sharing/share-dialog.js';

// FLOW-08, guest and share link → turn off: Roles and permissions (Guests and Share links; RP-18,
// RP-19 and RP-21), Comments and mentions (page comments) and Settings and members (the Guests
// tab, section 3.4).
//
// The seed's Casey (casey.commenter@example.test) is a member with the Commenter role, so this
// flow adds a new guest "Casey QA <tag>" with a fictional @example.test sign-in name.

/** Whether `locator` shows within `timeout` ms, for a step Care Hub may or may not ask for. */
const appears = (locator: Locator, timeout = 2_000) =>
  locator.waitFor({ timeout }).then(
    () => true,
    () => false,
  );

/**
 * The path of the link Care Hub shows in `root` (as text or in a field), leaving out the
 * Tailscale address that the guest setup screen may mention.
 */
async function linkIn(root: Locator): Promise<string> {
  const shown = [
    await root.innerText(),
    ...(await Promise.all((await root.getByRole('textbox').all()).map((box) => box.inputValue()))),
  ].join(' ');
  const link = (shown.match(/https?:\/\/[^\s"'<>]+/g) ?? [])
    .map((each) => new URL(each))
    .find((url) => !url.hostname.includes('tailscale'));
  if (!link) throw new Error(`No link is shown: ${shown}`);
  return `${link.pathname}${link.search}${link.hash}`;
}

/**
 * Adds a guest in the share dialog (Roles and permissions, Guests): their sign-in name in the
 * invite box, the "guest" choice, a level, Invite. Care Hub sends no email, so it shows the
 * inviter a one-time setup link with a reminder about Tailscale. Returns the link's path.
 */
async function addGuest(share: ShareDialog, guest: NewPerson, level: Level): Promise<string> {
  const { page, dialog } = share;
  await share.inviteBox.fill(guest.email);
  await choice(page, /guest/i).click();
  // Care Hub may ask the inviter for the guest's name too.
  const name = page
    .getByRole('dialog')
    .last()
    .getByLabel(/^(name|guest.s name|full name)$/i);
  if (await appears(name)) await name.fill(guest.name);
  await share.inviteLevel.click();
  await choice(page, new RegExp(`^${level}`)).click();
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click();
  const setup = page
    .getByRole('dialog')
    .filter({ hasText: /setup link/i })
    .last();
  await expect(setup).toContainText(/tailscale/i);
  return linkIn(setup);
}

/** The guest opens the setup link signed out, picks a password (and their name, if asked). */
async function setUpGuest(browser: Browser, path: string, guest: NewPerson): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  // Fields only: a "Show password" button has the word in its name too.
  const passwords = page.getByLabel(/password/i).and(page.locator('input'));
  await expect(passwords.first()).toBeVisible();
  const name = page.getByLabel(/^name$/i);
  if (await name.isVisible()) await name.fill(guest.name);
  for (const box of await passwords.all()) await box.fill(guest.password);
  await page
    .getByRole('button', {
      name: /^(set password|save password|save|continue|create account|finish|get started)$/i,
    })
    .click();
  await page.waitForURL((url) => url.pathname !== new URL(path, url).pathname);
  await expect(page.getByRole('main')).toBeVisible();
  return page;
}

/** The share dialog's Share link tab, with Include sub-pages, expiry and Turn off. */
async function shareLinkTab(share: ShareDialog): Promise<Locator> {
  await share.dialog.getByRole('tab', { name: /share link/i }).click();
  return share.dialog;
}

/** Whether the person on `page` is signed out: GET /api/auth/me no longer knows them. */
async function signedOut(page: Page): Promise<boolean> {
  const response = await page.request.get('/api/auth/me');
  if (response.status() === 401) return true;
  return response.ok() && !((await response.json()) as { user?: unknown }).user;
}

/** Settings → Members → Guests: the guest's Remove, confirmed. Returns when it was confirmed. */
async function removeGuest(page: Page, email: string): Promise<number> {
  await openSettings(page, 'Members');
  await membersTab(page, 'Guests');
  const row = memberRow(page, email);
  await expect(row).toBeVisible();
  const remove = row.getByRole('button', { name: /^remove/i });
  if (await remove.isVisible()) {
    await remove.click();
  } else {
    await row
      .getByRole('button', { name: /more|actions|options|…|⋯/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /^remove/i }).click();
  }
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .last()
    .getByRole('button', { name: /^remove/i })
    .click();
  return Date.now();
}

test.describe('Cross-area flow: a guest and a share link, then both turned off', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing', 'comments', 'settings');

  test('FLOW-08 Avery shares Onboarding plan with the guest Casey and by share link; members see Casey’s comment, the visitor reads it with sub-pages locked, removing Casey signs her out within 5 seconds and the turned-off link isn’t active', async ({
    page,
    browser,
  }) => {
    test.slow(); // Four people: Avery, the guest Casey, Eli and a visitor who isn't signed in.
    const title = uniqueName('Onboarding plan');
    const subTitle = uniqueName('First week');
    const note = uniqueName('Fictional QA guest comment');
    const guest = newPerson('Casey');
    await signInAs(page, 'admin');
    const pageId = await makePage(page, title);
    const subId = await makePage(page, subTitle, { parentId: pageId });
    const averyName = await nameOf(page);
    const screen = new PageScreen(page);
    const opened: Page[] = [];

    try {
      const setupPath =
        await test.step('Avery adds the guest Casey with Can comment and gets a one-time setup link', async () => {
          await screen.goto(pageId);
          const share = new ShareDialog(page);
          await share.open();
          const path = await addGuest(share, guest, 'Can comment');
          await page.keyboard.press('Escape');
          return path;
        });

      const casey =
        await test.step('Casey opens the setup link signed out and picks a password', () =>
          setUpGuest(browser, setupPath, guest));
      opened.push(casey);
      const caseyName = await nameOf(casey);

      await test.step('Casey, signed in as a guest, opens the page and comments', async () => {
        expect((await me(casey)).member?.kind).toBe('guest');
        await new PageScreen(casey).goto(pageId);
        const comments = new PageComments(casey);
        await comments.box.click();
        await casey.keyboard.type(note);
        await casey.keyboard.press('Enter');
        await expect(comments.comment(note)).toBeVisible();
      });

      await test.step('members see Casey’s comment', async () => {
        const eli = await openAs(browser, 'editor');
        opened.push(eli.page);
        await new PageScreen(eli.page).goto(pageId);
        await expect(new PageComments(eli.page).comment(note)).toContainText(caseyName);
      });

      const linkPath =
        await test.step('Avery makes a share link with Include sub-pages left off', async () => {
          await screen.goto(pageId);
          const share = new ShareDialog(page);
          await share.open();
          const tab = await shareLinkTab(share);
          const subPages = tab
            .getByRole('switch', { name: /sub-pages/i })
            .or(tab.getByRole('checkbox', { name: /sub-pages/i }))
            .first();
          await expect(subPages).not.toBeChecked();
          await tab
            .getByRole('button', { name: /^(make|create|turn on)( a)?( share)?( link)?$/i })
            .click();
          await expect(tab.getByRole('button', { name: /^turn off/i })).toBeVisible();
          const path = await linkIn(tab);
          await page.keyboard.press('Escape');
          return path;
        });

      const visitor = await (await browser.newContext()).newPage();
      opened.push(visitor);

      await test.step('a visitor who isn’t signed in reads the page; the sub-page is locked', async () => {
        await visitor.goto(linkPath);
        await expect(
          visitor
            .getByRole('heading', { name: literally(title) })
            .or(visitor.getByText(title, { exact: true }))
            .first(),
        ).toBeVisible();
        await expect(
          visitor.getByText(
            new RegExp(`Shared by ${literally(averyName).source}\\s*·\\s*view only`, 'i'),
          ),
        ).toBeVisible();
        // Read only: nothing to type in, no Share, and no comments (Share links: a clean reader).
        await expect(visitor.locator('[contenteditable="true"]')).toHaveCount(0);
        await expect(visitor.getByRole('textbox')).toHaveCount(0);
        await expect(visitor.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
        await expect(visitor.getByText(note)).toHaveCount(0);
        // With sub-pages off the sub-page shows as "🔒 A page", with no title anywhere.
        await expect(visitor.getByText(/🔒\s*A page/).first()).toBeVisible();
        expect(await visitor.content()).not.toContain(subTitle);
        // Refused, or not found when the API doesn't say the page exists.
        const asked = await visitor.request.get(`/api/pages/${subId}`);
        expect([401, 403, 404], `GET /api/pages/${subId} signed out`).toContain(asked.status());
        expect(await asked.text()).not.toContain(subTitle);
      });

      await test.step('Avery removes the guest Casey; Casey is signed out within 5 seconds', async () => {
        const removedAt = await removeGuest(page, guest.email);
        await expect.poll(() => signedOut(casey), { timeout: 5_000, intervals: [250] }).toBe(true);
        expect(Date.now() - removedAt).toBeLessThanOrEqual(5_000);
        await casey.reload();
        await expect(casey.getByLabel(/password/i).first()).toBeVisible();
        await expect(casey.getByText(title)).toHaveCount(0);
      });

      await test.step('Avery turns off the link; it then says “This link isn’t active.”', async () => {
        await screen.goto(pageId);
        const share = new ShareDialog(page);
        await share.open();
        const tab = await shareLinkTab(share);
        await tab.getByRole('button', { name: /^turn off/i }).click();
        // Care Hub may ask first; "Turn off stops the link at once".
        const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^turn off/i });
        if (await appears(confirm)) await confirm.click();
        await visitor.reload();
        await expect(visitor.getByText(/^This link isn['’]t active\.$/)).toBeVisible();
        expect(await visitor.content()).not.toContain(title);
      });
    } finally {
      await Promise.all(opened.map((each) => each.context().close()));
    }
  });
});
