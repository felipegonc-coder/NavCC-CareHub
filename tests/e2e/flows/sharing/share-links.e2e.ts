import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen } from '../pages/page-screen.js';
import { AccessDialog, ShareLinkTab } from './access.js';
import { nameOf } from './share-dialog.js';

// Roles and permissions, section 3 (Share links, 🟨 RP-D3 default: on): a view-only reader for
// people who aren't signed in.

test.describe('Sharing: share links', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'sharing');

  test('RP-21 someone signed out reads a share-linked page read only with its sub-pages locked, and after Turn off the link isn’t active', async ({
    page,
    browser,
  }) => {
    const title = uniqueName('Fictional QA Holiday hours');
    const sub = uniqueName('Fictional QA Holiday rota');
    await signInAs(page, 'admin');
    const averyName = await nameOf(page);
    const id = await makePage(page, title);
    await makePage(page, sub, { parentId: id });
    const shareLink = new ShareLinkTab(new AccessDialog(page));
    let link = '';

    await test.step('Avery makes a share link; Include sub-pages is off', async () => {
      await new PageScreen(page).goto(id);
      await shareLink.share.open();
      link = await shareLink.make();
      await expect(shareLink.subPages).not.toBeChecked();
    });

    const visitor = await browser.newContext();
    try {
      const reader = await visitor.newPage();

      await test.step('signed out, the link shows the page under "Shared by Avery · view only", with nothing to edit', async () => {
        await reader.goto(link);
        await expect(reader.getByText(`Shared by ${averyName} · view only`)).toBeVisible();
        await expect(reader.getByRole('heading', { name: title })).toBeVisible();
        await expect(reader.getByRole('textbox')).toHaveCount(0);
        await expect(reader.getByRole('navigation', { name: 'Sidebar' })).toHaveCount(0);
      });

      await test.step('the sub-page shows as "🔒 A page", without its title', async () => {
        await expect(reader.getByText(/^(🔒\s*)?A page$/)).toBeVisible();
        await expect(reader.getByText(sub)).toHaveCount(0);
      });

      await test.step('once Avery turns the link off, it says "This link isn’t active." and shows nothing else', async () => {
        await shareLink.turnOff.click();
        await expect(shareLink.turnOff).toBeHidden();
        await reader.reload();
        await expect(reader.getByText("This link isn't active.")).toBeVisible();
        await expect(reader.getByText(title)).toHaveCount(0);
      });
    } finally {
      await visitor.close();
    }
  });
});
