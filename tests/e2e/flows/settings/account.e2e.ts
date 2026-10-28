import { randomUUID } from 'node:crypto';
import { devices, type Browser, type Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import * as account from './account-page.js';
import * as data from './settings-data.js';
import * as st from './settings-page.js';

// Settings and members, Done means 4 to 6 (SM-02, SM-03, SM-05). Each check signs in a new person
// who joins with an invite link from Avery (the fictional admin), so their password, 2-step
// verification and sessions are theirs alone: no other flow signs in as them.

const MINUTE = 60_000;

/** Avery makes a one-use Editor invite link and someone new joins with it, on their laptop. */
async function newcomer(page: Page, browser: Browser, firstName: string) {
  await signInAs(page, 'admin');
  const person = data.newPerson(firstName);
  const invite = await st.createInviteLink(page, { role: 'Editor', uses: 1 });
  const laptop = await st.join(browser, invite, person);
  return { person, laptop };
}

async function closeAll(...pages: (Page | undefined)[]): Promise<void> {
  for (const each of pages) await each?.context().close();
}

test.describe('Settings: password and 2-step verification', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');

  test('SM-02 a new password signs out the other devices; password123 and an 11-character password are refused', async ({
    page,
    browser,
  }) => {
    test.setTimeout(2 * MINUTE);
    const { person, laptop } = await newcomer(page, browser, 'Robin');
    const phone = await account.signInOn(browser, person, {
      userAgent: devices['Pixel 7'].userAgent,
    });
    try {
      await test.step('password123 and an 11-character password are refused', async () => {
        for (const tried of ['password123', 'Kq7-vT2m-xZ']) {
          expect(tried).toHaveLength(11);
          const sent = await account.changePassword(laptop, person.password, tried);
          // Refused on the screen before sending, or by the server.
          if (sent)
            expect(sent.status, `the server refuses "${tried}"`).toBeGreaterThanOrEqual(400);
          await expect(account.passwordRefusal(laptop), `"${tried}" is refused`).toBeVisible();
        }
        expect(await account.signedIn(phone), 'nothing changed: the phone is still in').toBe(true);
      });

      const fresh = `Fictional-${randomUUID()}`;
      const sent = await test.step('a good new password is saved', async () => {
        const change = await account.changePassword(laptop, person.password, fresh);
        expect(change?.status, 'the server takes the new password').toBeLessThan(300);
        await expect(account.passwordRefusal(laptop)).toHaveCount(0);
        return change;
      });

      await test.step('the other device is signed out; this one stays in', async () => {
        await account.signedOutWithin(phone, Date.now());
        expect(await account.signedIn(laptop)).toBe(true);
      });

      await test.step('the server refuses password123 too, not just the screen', async () => {
        if (!sent) return;
        const again = account.swapped(
          account.swapped(sent.data, fresh, 'password123'),
          person.password,
          fresh,
        );
        const method = sent.method as 'POST' | 'PUT' | 'PATCH';
        const response = await (await apiFor(laptop)).send(method, sent.path, again);
        expect(response.ok(), `${sent.method} ${sent.path} with password123`).toBe(false);
      });

      await test.step('only the new password signs in', async () => {
        const old = await account.newDevice(browser);
        await account.enterPassword(old, person);
        await account.expectRefused(old);
        await old.context().close();
        const renewed = await account.signInOn(browser, { email: person.email, password: fresh });
        await renewed.context().close();
      });
    } finally {
      await closeAll(laptop, phone);
    }
  });

  test('SM-03 2-step verification: turning it on, signing in with a code, a recovery code that works once, and turning it off', async ({
    page,
    browser,
  }) => {
    // Codes come in 30-second steps, and each step's code is used once, so this waits for up to
    // three new steps.
    test.setTimeout(4 * MINUTE);
    const { person, laptop } = await newcomer(page, browser, 'Quinn');
    const opened: Page[] = [laptop];
    const device = async () => {
      const each = await account.newDevice(browser);
      opened.push(each);
      return each;
    };
    try {
      const app = await test.step('turning it on shows the key and 10 recovery codes', async () => {
        const shown = await account.turnOnTwoStep(laptop);
        expect(shown.recoveryCodes, 'ten one-time recovery codes').toHaveLength(10);
        return shown;
      });

      await test.step('signing in asks for the code, and a code from the app works', async () => {
        const next = await device();
        await account.enterPassword(next, person);
        await expect(account.codeBox(next)).toBeVisible();
        expect(await account.signedIn(next), 'not in before the code').toBe(false);
        await account.enterCode(next, account.codeBox(next), await account.freshCode(next, app));
        await expect.poll(() => account.signedIn(next)).toBe(true);
      });

      const [recovery] = app.recoveryCodes;
      if (!recovery) throw new Error('No recovery code to try');
      await test.step('a recovery code works once', async () => {
        const first = await device();
        await account.enterPassword(first, person);
        await account.enterCode(first, await account.recoveryBox(first), recovery);
        await expect.poll(() => account.signedIn(first)).toBe(true);

        const second = await device();
        await account.enterPassword(second, person);
        await account.enterCode(second, await account.recoveryBox(second), recovery);
        await account.expectRefused(second);
      });

      await test.step('turning it off takes the password and a code; then no code is asked', async () => {
        await account.turnOffTwoStep(laptop, person.password, await account.freshCode(laptop, app));
        const after = await device();
        await account.enterPassword(after, person);
        await expect.poll(() => account.signedIn(after)).toBe(true);
        await expect(account.codeBox(after)).toHaveCount(0);
      });
    } finally {
      await closeAll(...opened);
    }
  });
});

test.describe('Settings: devices', () => {
  onlyIn('desktop-light');
  needs('signIn', 'settings');

  test('SM-05 Devices lists the sessions; Sign out ends one, and Sign out of all other devices ends the rest within 5 seconds', async ({
    page,
    browser,
  }) => {
    test.setTimeout(2 * MINUTE);
    const { person, laptop } = await newcomer(page, browser, 'Sage');
    const phone = await account.signInOn(browser, person, {
      userAgent: devices['Pixel 7'].userAgent,
    });
    const desktops = [
      await account.signInOn(browser, person),
      await account.signInOn(browser, person),
    ];
    try {
      const entries = account.sessionEntries(laptop);
      await test.step('Devices lists the 4 sessions, with This device and the phone', async () => {
        await st.openSettings(laptop, 'My account');
        await expect(laptop.getByRole('heading', { name: 'Devices' })).toBeVisible();
        await expect(entries).toHaveCount(4);
        await expect(entries.filter({ hasText: /this device/i })).toHaveCount(1);
        await expect(entries.filter({ hasText: /android/i })).toHaveCount(1);
      });

      await test.step("the phone's Sign out ends that session within 5 seconds", async () => {
        await account.signOutSession(laptop, entries.filter({ hasText: /android/i }));
        const took = await account.signedOutWithin(phone, Date.now());
        expect(took, 'ms until the phone is out').toBeLessThanOrEqual(5_000);
        for (const desktop of desktops) expect(await account.signedIn(desktop)).toBe(true);
        await expect(entries).toHaveCount(3);
      });

      await test.step('Sign out of all other devices ends the rest within 5 seconds', async () => {
        await account.signOutOthers(laptop);
        const since = Date.now();
        for (const desktop of desktops) {
          const took = await account.signedOutWithin(desktop, since);
          expect(took, 'ms until the other desktop is out').toBeLessThanOrEqual(5_000);
        }
        expect(await account.signedIn(laptop), 'this device stays in').toBe(true);
        await expect(entries).toHaveCount(1);
        await expect(entries.first()).toContainText(/this device/i);
      });
    } finally {
      await closeAll(laptop, phone, ...desktops);
    }
  });
});
