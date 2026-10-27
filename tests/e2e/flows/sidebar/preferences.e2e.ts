import type { Locator } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen } from '../pages/page-screen.js';
import { ShareDialog } from '../sharing/share-dialog.js';
import { joinWithLink, makeInviteLink } from './new-member.js';
import { Sidebar } from './sidebar-page.js';

// Sidebar, spaces and nested pages, section 3.1: the sidebar's width, Ctrl+\, Customize sidebar
// and collapsed sections are saved per person (section 4), so they survive a reload and leave
// everyone else's sidebar as it was.

/** Waits for the sidebar to be `px` wide (0: hidden), allowing for its border and rounding. */
async function expectWidth(sidebar: Sidebar, px: number) {
  await expect
    .poll(
      async () => {
        const width = await sidebar.width();
        return Math.abs(width - px) <= 4 ? px : width;
      },
      { message: `the sidebar is ${px} px wide` },
    )
    .toBe(px);
}

/** Customize sidebar, from a right-click on a section heading; it may come as a menu item first. */
async function customize(sidebar: Sidebar): Promise<Locator> {
  const { page } = sidebar;
  await sidebar.heading('Private').click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: /^customize sidebar/i });
  const name = /customize sidebar/i;
  const panel = page.getByRole('dialog', { name }).or(page.getByRole('menu', { name }));
  await expect(item.or(panel).first()).toBeVisible();
  if (await item.isVisible()) await item.click();
  await expect(panel).toBeVisible();
  return panel;
}

/** Shows or hides a top item, or Recent, with its switch in Customize sidebar. */
async function showInSidebar(sidebar: Sidebar, item: string, shown: boolean) {
  const panel = await customize(sidebar);
  const name = new RegExp(`^(show )?${item}$`, 'i');
  const toggle = panel
    .getByRole('switch', { name })
    .or(panel.getByRole('checkbox', { name }))
    .or(panel.getByRole('menuitemcheckbox', { name }))
    .first();
  await expect(toggle).toBeChecked({ checked: !shown });
  await toggle.click();
  // A menu may close by itself once a choice is made; a panel stays open until Esc.
  if (await panel.isVisible()) {
    await expect(toggle).toBeChecked({ checked: shown });
    await sidebar.page.keyboard.press('Escape');
  }
  await expect(panel).toBeHidden();
}

test.describe('Sidebar: settings each person keeps', () => {
  onlyIn('desktop-light');
  // A new member (Settings and members, section 3.4) changes their own sidebar, so the seeded
  // people's sidebars stay as other tests expect. Avery shares a page, so both have Shared.
  needs('signIn', 'appShell', 'pages', 'settings', 'sharing', 'home');

  test('SB-02 width, hidden state, hidden items and collapsed sections survive a reload, for that person only', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await signInAs(page, 'admin');
    const handover = uniqueName('Fictional QA handover notes');
    const handoverId = await makePage(page, handover, { space: 'Private' });
    const riley = await joinWithLink(browser, await makeInviteLink(page));
    try {
      const share = new ShareDialog(page);
      await new PageScreen(page).goto(handoverId);
      await share.open();
      await share.invite(riley.name, 'Can view');
      await share.closeWithEscape();

      // Avery's sidebar as it is now: the private page Avery shared shows under Shared.
      const avery = new Sidebar(page);
      const home = (sidebar: Sidebar) =>
        sidebar.nav.getByRole('link', { name: 'Home', exact: true });
      await expect(avery.entry(handover, avery.section('Shared'))).toBeVisible();
      const before = {
        width: await avery.width(),
        home: await home(avery).count(),
        recent: await avery.section('Recent').count(),
      };

      const mine = new Sidebar(riley.page);
      const screen = new PageScreen(riley.page);
      await screen.goto(handoverId);
      await expect(mine.entry(handover, mine.section('Shared'))).toBeVisible();
      const reload = async () => {
        await riley.page.reload();
        await expect(screen.title).toBeVisible();
      };

      await test.step('the edge drags between 220 and 480 px, and the width stays after a reload', async () => {
        await expectWidth(mine, 240);
        await mine.dragEdge(400);
        await expectWidth(mine, 480);
        await mine.dragEdge(-400);
        await expectWidth(mine, 220);
        await mine.dragEdge(100);
        await expectWidth(mine, 320);
        await reload();
        await expectWidth(mine, 320);
      });

      await test.step('a click on Shared collapses it, and it stays collapsed after a reload', async () => {
        await mine.heading('Shared').click();
        await expect(mine.heading('Shared')).toHaveAttribute('aria-expanded', 'false');
        await expect(mine.entry(handover, mine.section('Shared'))).toBeHidden();
        await reload();
        await expect(mine.heading('Shared')).toHaveAttribute('aria-expanded', 'false');
        await expect(mine.entry(handover, mine.section('Shared'))).toBeHidden();
      });

      await test.step('Customize sidebar hides Home and shows Recent; both stay after a reload', async () => {
        await showInSidebar(mine, 'Home', false);
        await showInSidebar(mine, 'Recent', true);
        await expect(home(mine)).toHaveCount(0);
        // Recent lists the pages Riley opened, newest first (section 3.4).
        await expect(mine.entry(handover, mine.section('Recent'))).toBeVisible();
        await reload();
        await expect(mine.entry(handover, mine.section('Recent'))).toBeVisible();
        await expect(home(mine)).toHaveCount(0);
      });

      await test.step('Ctrl+\\ hides it, the pointer at the left edge shows it until it leaves, and hidden stays after a reload', async () => {
        await riley.page.keyboard.press('ControlOrMeta+Backslash');
        await expectWidth(mine, 0);
        await riley.page.mouse.move(2, 400, { steps: 5 });
        await expectWidth(mine, 320);
        await riley.page.mouse.move(900, 400, { steps: 5 });
        await expectWidth(mine, 0);
        await reload();
        await expectWidth(mine, 0);
        await riley.page.keyboard.press('ControlOrMeta+Backslash');
        await expectWidth(mine, 320);
      });

      await test.step('none of it changed Avery’s sidebar', async () => {
        await page.reload();
        await expect(avery.entry(handover, avery.section('Shared'))).toBeVisible();
        await expect.poll(() => avery.width()).toBe(before.width);
        await expect(home(avery)).toHaveCount(before.home);
        await expect(avery.section('Recent')).toHaveCount(before.recent);
      });

      await test.step('a double-click on the edge sets the width back to 240 px', async () => {
        await mine.resetWidth();
        await expectWidth(mine, 240);
        await reload();
        await expectWidth(mine, 240);
      });
    } finally {
      await riley.close();
    }
  });
});
