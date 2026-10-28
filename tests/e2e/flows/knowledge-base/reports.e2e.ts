import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { KnowledgeBase, idOf, makeHandbook, turnIntoKnowledgeBase } from './kb-page.js';
import { ReportDialog, ReportsView } from './reports.js';

// Knowledge base, section 3.4: Report a problem. Val (Viewer) reports a problem on a published
// page, as Riley does in the spec; Eli (Editor) owns the page, replies and closes the report.

test.describe('Knowledge base: reports', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'knowledgeBase', 'notices');

  test("KB-08 a report reaches the Reports view and the owner's 🔔 chat; the reply and the closing notify the reporter", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const owner = await nameOf(page);
    const refund = uniqueName('Fictional QA Refund policy');
    const handbook = await makeHandbook(page, uniqueName('Fictional QA Support handbook'), [
      refund,
    ]);
    await turnIntoKnowledgeBase(page, handbook.id, 1);
    const refundId = idOf(handbook.subIds, refund);
    const problem = 'The phone number is wrong';
    const answer = 'Fixed: it is now 555-0100, a fictional number.';
    const val = await openAs(browser, 'viewer');
    const reporter = await nameOf(val.page);
    const card = literally(refund);

    await test.step('Val: Report a problem → Wrong or unclear, "The phone number is wrong", Send', async () => {
      await new PageScreen(val.page).goto(refundId);
      const report = new ReportDialog(val.page);
      await report.open();
      await report.send('Wrong or unclear', problem);
      await expect(report.thanks(owner)).toBeVisible();
      await expect(report.yours(problem)).toContainText('New');
    });

    const reports = new ReportsView(new KnowledgeBase(page, handbook.id));
    await test.step('Eli finds it in Reports, and in the 🔔 chat as "Problem reported"', async () => {
      await reports.open();
      await expect(reports.report(problem)).toBeVisible();
      const chat = new CareHubChat(page);
      await chat.open();
      const notice = chat.notice(card, 'Problem reported');
      await expect(notice).toContainText(`${reporter} reported a problem: Wrong or unclear.`);
    });

    await test.step('Eli replies, then marks it Fixed', async () => {
      await reports.open();
      const opened = await reports.openReport(problem);
      await reports.reply(opened, answer);
      await reports.setStatus(opened, 'Fixed');
    });

    await test.step("Val's 🔔 chat tells Val about the reply and the closing", async () => {
      const chat = new CareHubChat(val.page);
      await chat.open();
      await expect(chat.notice(card, 'Reply to your report')).toContainText(
        `${owner} replied to your report.`,
      );
      await expect(chat.notice(card, 'Report closed')).toContainText(
        'Your report was marked Fixed.',
      );
    });
    await val.close();
  });
});
