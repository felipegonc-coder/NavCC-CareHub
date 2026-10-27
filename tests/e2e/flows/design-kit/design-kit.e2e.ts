import type { Route } from '@playwright/test';
import { expect, needs, onlyIn, test } from '../_support/index.js';
import {
  chooseTheme,
  expectFocusInside,
  expectThemeColours,
  focusedControl,
  lastClick,
  openDesignKit,
  runningAnimations,
  themeColours,
  themeOption,
  watchClicks,
} from './design-kit-page.js';

// The design kit gallery at /design (decision 0008, Look and feel). The Look and feel spec has no
// check IDs yet, so these use provisional DK numbers.

// The option that follows the device: "System" in the gallery, "Use system setting" in Settings.
const followDevice = /system/i;

test.describe('Design kit: theme', () => {
  onlyIn('desktop-light');
  needs('designKit');

  test('DK-01 the theme switch changes light and dark, and the choice survives a reload', async ({
    page,
  }) => {
    await openDesignKit(page);

    await test.step('at first the switch follows the device, which is light', async () => {
      await expect(themeOption(page, followDevice)).toBeChecked();
      await expectThemeColours(page, themeColours.light);
    });

    await test.step('choosing Dark turns the page dark', async () => {
      await chooseTheme(page, 'Dark');
      await expect(themeOption(page, 'Dark')).toBeChecked();
      await expectThemeColours(page, themeColours.dark);
    });

    await test.step('Dark is still chosen after a reload', async () => {
      await page.reload();
      await expect(themeOption(page, 'Dark')).toBeChecked();
      await expectThemeColours(page, themeColours.dark);
    });

    await test.step('with the keyboard, the left arrow moves from Dark to Light', async () => {
      await themeOption(page, 'Dark').focus();
      await page.keyboard.press('ArrowLeft');
      await expect(themeOption(page, 'Light')).toBeChecked();
      await expect(themeOption(page, 'Light')).toBeFocused();
      await expectThemeColours(page, themeColours.light);
    });

    await test.step('Light is still chosen after a reload', async () => {
      await page.reload();
      await expect(themeOption(page, 'Light')).toBeChecked();
      await expectThemeColours(page, themeColours.light);
    });
  });

  test('DK-02 following the device switches light and dark while the page is open', async ({
    page,
  }) => {
    await openDesignKit(page);
    await expect(themeOption(page, followDevice)).toBeChecked();

    await page.emulateMedia({ colorScheme: 'dark' });
    await expectThemeColours(page, themeColours.dark);

    await page.emulateMedia({ colorScheme: 'light' });
    await expectThemeColours(page, themeColours.light);
  });

  test('DK-03 a theme chosen in one tab applies in the other open tabs', async ({
    page,
    context,
  }) => {
    await openDesignKit(page);
    const otherTab = await context.newPage();
    await openDesignKit(otherTab);

    await chooseTheme(page, 'Dark');
    await expectThemeColours(page, themeColours.dark);

    await expect(themeOption(otherTab, 'Dark')).toBeChecked();
    await expectThemeColours(otherTab, themeColours.dark);
  });
});

test.describe('Design kit: no white flash', () => {
  onlyIn('desktop-light');
  needs('designKit');
  // A service worker would answer requests before page.route() could hold them.
  test.use({ serviceWorkers: 'block' });

  test('DK-04 a saved dark theme shows before the app has loaded', async ({ page }) => {
    await openDesignKit(page);
    await chooseTheme(page, 'Dark');
    await expectThemeColours(page, themeColours.dark);

    // Hold every script except theme-init.js, the small script that applies the saved theme
    // before the first paint (decision 0008), so nothing else can colour the page yet.
    let holding = true;
    const held: Route[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const appScript =
        request.resourceType() === 'script' &&
        !new URL(request.url()).pathname.endsWith('/theme-init.js');
      if (holding && appScript) held.push(route);
      else await route.continue();
    });

    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('body')).toHaveCSS('background-color', themeColours.dark.background);
    await expect(page.getByRole('main'), 'the app has not drawn the screen yet').toHaveCount(0);

    holding = false;
    await Promise.all(held.map((route) => route.continue()));
    await expect(page.getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
    await expectThemeColours(page, themeColours.dark);
  });
});

test.describe('Design kit: dark device', () => {
  onlyIn('desktop-dark');
  needs('designKit');

  test('DK-05 with no saved choice, a device in dark mode gets the dark theme', async ({
    page,
  }) => {
    await openDesignKit(page);
    await expect(themeOption(page, followDevice)).toBeChecked();
    await expectThemeColours(page, themeColours.dark);
  });
});

test.describe('Design kit: keyboard and screen readers', () => {
  onlyIn('desktop-light');
  needs('designKit');

  test.beforeEach(async ({ page }) => {
    await openDesignKit(page);
  });

  test('DK-06 every control reached with Tab shows a visible focus outline', async ({ page }) => {
    const reached: string[] = [];
    const unmarked: string[] = [];
    for (let stop = 0; stop < 40; stop += 1) {
      await page.keyboard.press('Tab');
      const focused = await focusedControl(page);
      if (!focused || reached.includes(focused.name)) break;
      reached.push(focused.name);
      if (!focused.indicated) unmarked.push(focused.name);
    }

    expect(reached, 'Tab reaches the switch, buttons, fields and tabs').toEqual(
      expect.arrayContaining([
        expect.stringMatching(/"System"|"Use system setting"/),
        'button "Primary"',
        'button "Saving"',
        'button "Move to Trash"',
        'combobox "Team"',
        'checkbox "Email me a copy"',
        'switch "Desktop notifications"',
        'tab "Details"',
      ]),
    );
    expect(unmarked, 'controls without a visible focus outline').toEqual([]);
  });

  test('DK-07 the Team select works with the keyboard', async ({ page }) => {
    const team = page.getByRole('combobox', { name: 'Team' });
    const list = page.getByRole('listbox');

    await test.step('Enter opens the list', async () => {
      await team.focus();
      await page.keyboard.press('Enter');
      await expect(list).toBeVisible();
      // While the list is open the rest of the page is hidden from screen
      // readers (aria-hidden), the trigger too, so look it up with
      // includeHidden. `expanded: true` keeps the match to the open trigger.
      await expect(
        page.getByRole('combobox', { name: 'Team', includeHidden: true, expanded: true }),
      ).toHaveCount(1);
      await expectFocusInside(list);
    });

    await test.step('the arrow keys move through the options and Enter picks one', async () => {
      await page.keyboard.press('Home');
      await expect(list.getByRole('option', { name: 'Support' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(list.getByRole('option', { name: 'Billing' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(list).toBeHidden();
      await expect(team).toHaveText('Billing');
      await expect(team).toBeFocused();
    });

    await test.step('typing a letter jumps to the matching option', async () => {
      await page.keyboard.press('ArrowDown');
      await expect(list).toBeVisible();
      await expectFocusInside(list);
      await page.keyboard.type('r');
      await expect(list.getByRole('option', { name: 'Returns' })).toBeFocused();
    });

    await test.step('Esc closes the list, keeps the choice and returns focus', async () => {
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(team).toHaveText('Billing');
      await expect(team).toBeFocused();
    });
  });

  test('DK-08 the Ticket tabs move with the arrow keys', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Ticket' });
    const details = tabs.getByRole('tab', { name: 'Details' });
    const history = tabs.getByRole('tab', { name: 'History' });

    await expect(details).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Details' })).toHaveText(
      'Opened by Sam Rivers, waiting for a reply.',
    );

    await details.focus();
    await page.keyboard.press('ArrowRight');
    await expect(history).toBeFocused();
    await expect(history).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'History' })).toHaveText(
      'Two replies, one internal note.',
    );

    await page.keyboard.press('ArrowRight');
    await expect(details, 'the arrows wrap around').toBeFocused();
    await page.keyboard.press('End');
    await expect(history).toBeFocused();
    await page.keyboard.press('Home');
    await expect(details).toBeFocused();
    await expect(details).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('tabpanel', { name: 'Details' }),
      'Tab leaves the tab list for the open panel',
    ).toBeFocused();
  });

  test('DK-09 the checkbox and the switch toggle with Space and keep their labels', async ({
    page,
  }) => {
    const copy = page.getByRole('checkbox', { name: 'Email me a copy' });
    const notifications = page.getByRole('switch', { name: 'Desktop notifications' });

    await test.step('checkbox', async () => {
      await expect(copy).toBeChecked();
      await copy.focus();
      await page.keyboard.press('Space');
      await expect(copy).not.toBeChecked();
      await page.keyboard.press('Space');
      await expect(copy).toBeChecked();
      await expect(copy).toHaveAccessibleName('Email me a copy');
      await page.getByText('Email me a copy', { exact: true }).click();
      await expect(copy, 'clicking the label toggles it too').not.toBeChecked();
    });

    await test.step('switch', async () => {
      await expect(notifications).not.toBeChecked();
      await notifications.focus();
      await page.keyboard.press('Space');
      await expect(notifications).toBeChecked();
      await expect(notifications).toHaveAccessibleName('Desktop notifications');
      await page.keyboard.press('Space');
      await expect(notifications).not.toBeChecked();
      await page.getByText('Desktop notifications', { exact: true }).click();
      await expect(notifications, 'clicking the label toggles it too').toBeChecked();
    });
  });

  test("DK-10 a field's hint and error are tied to it", async ({ page }) => {
    const name = page.getByRole('textbox', { name: 'Name' });
    const email = page.getByRole('textbox', { name: 'Email' });

    await expect(name).toHaveAccessibleDescription('As customers will see it.');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(name).not.toHaveAttribute('required');

    await expect(email, 'the required mark is not read as part of the name').toHaveAccessibleName(
      'Email',
    );
    await expect(email).toHaveAccessibleDescription('Enter an email address.');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAttribute('required');
  });

  test("DK-11 disabled and loading buttons can't be pressed", async ({ page }) => {
    const saving = page.getByRole('button', { name: 'Saving' });
    const disabled = page.getByRole('button', { name: 'Disabled' });

    await expect(disabled).toBeDisabled();
    await expect(saving).toBeDisabled();
    await expect(saving).toHaveAttribute('aria-busy', 'true');

    await test.step('Tab stops on the loading button and skips the disabled one', async () => {
      await page.getByRole('button', { name: 'New page' }).focus();
      await page.keyboard.press('Tab');
      await expect(saving).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    });

    await test.step('pressing the loading button is cancelled, unlike a normal button', async () => {
      await watchClicks(page);

      await page.getByRole('button', { name: 'Primary' }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => lastClick(page)).toEqual({ button: 'Primary', cancelled: false });

      await saving.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => lastClick(page)).toEqual({ button: 'Saving', cancelled: true });
    });
  });

  test('DK-12 icon buttons have names', async ({ page }) => {
    for (const label of ['Settings', 'Move to Trash']) {
      const button = page.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveAccessibleName(label);
    }
  });
});

test.describe('Design kit: reduced motion', () => {
  onlyIn('desktop-light');
  needs('designKit');

  test('DK-13 nothing keeps moving when the device asks for less motion', async ({ page }) => {
    await test.step('normally the spinner and skeletons move', async () => {
      await openDesignKit(page);
      await expect.poll(() => runningAnimations(page)).toBeGreaterThan(0);
    });

    await test.step('with reduced motion they stand still', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
      await expect.poll(() => runningAnimations(page)).toBe(0);
    });
  });
});
