import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { literally } from '../pages/page-screen.js';
import { choice } from '../sharing/share-dialog.js';
import type { KnowledgeBase } from './kb-page.js';

// Knowledge base, sections 2 and 3.4: Report a problem, the Reports view and replies, plus the
// settings and health line that KB-11 and KB-12 use. The routes are the knowledge base lane's
// (/api/knowledge, #310), used here only to make test data; what a person does goes through the
// screens. Every guess about the screens is in this file.

/** "What's wrong?" in Report a problem, as the dialog shows the reasons. */
export type Reason =
  'Out of date' | 'Wrong or unclear' | 'Broken link or file' | "Something's missing" | 'Other';

/** The reasons as the reports route takes them. */
const REASON_IDS: Record<Reason, string> = {
  'Out of date': 'out_of_date',
  'Wrong or unclear': 'wrong_or_unclear',
  'Broken link or file': 'broken_link',
  "Something's missing": 'missing',
  Other: 'other',
};

/** Test data: a report on a page by the signed-in person, as Send in Report a problem makes. */
export async function reportByApi(page: Page, pageId: string, reason: Reason, text?: string) {
  const body = { reason: REASON_IDS[reason], text };
  await (await apiFor(page)).post(`/api/knowledge/pages/${pageId}/reports`, body);
}

/** Test data: a knowledge base's settings (Full access), such as Editing removes verification. */
export async function changeSettings(
  page: Page,
  databaseId: string,
  settings: { editingRemovesVerification?: boolean; defaultPeriod?: string },
) {
  await (await apiFor(page)).patch(`/api/knowledge/bases/${databaseId}/settings`, settings);
}

/** The health line on the knowledge base's home, for editors: "86% verified · 4 expired · 2 open reports". */
export function healthLine(page: Page): Locator {
  return page
    .getByRole('main')
    .getByText(/^\d+% verified · \d+ expired · \d+ open reports?$/)
    .first();
}

/**
 * Report a problem (section 2), from the bottom of a knowledge base page: "What's wrong?" with
 * five reasons, a text box, Send, then "Thanks. Riley Chen will take a look." and Your reports.
 * Assumed: the reasons are radio buttons and the text box is the dialog's only one.
 */
export class ReportDialog {
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog').filter({ hasText: "What's wrong?" });
  }

  async open() {
    await this.page
      .getByRole('main')
      .getByRole('button', { name: 'Report a problem', exact: true })
      .last()
      .click();
    await expect(this.dialog).toBeVisible();
  }

  async send(reason: Reason, text: string) {
    await this.dialog
      .getByRole('radio', { name: reason, exact: true })
      .or(this.dialog.getByRole('button', { name: reason, exact: true }))
      .first()
      .click();
    await this.dialog.getByRole('textbox').fill(text);
    await this.dialog.getByRole('button', { name: 'Send', exact: true }).click();
  }

  /** "Thanks. Eli Park will take a look." */
  thanks(owner: string): Locator {
    return this.dialog.getByText(`Thanks. ${owner} will take a look.`);
  }

  /** A report under Your reports, with its status. */
  yours(text: string): Locator {
    return this.dialog.getByRole('listitem').filter({ hasText: text });
  }
}

/**
 * The Reports view of a knowledge base (editors and owners): each report with page, reason, text,
 * reporter, when and status. Opening one shows its replies and a reply box. Assumed: it opens in a
 * dialog or a side panel, with a reply box named Reply and the status as a button ("New").
 */
export class ReportsView {
  constructor(readonly kb: KnowledgeBase) {}

  async open() {
    await this.kb.open();
    await this.kb.view('Reports');
  }

  /** A report in the view, by its text. */
  report(text: string): Locator {
    return this.kb.screen.root.getByText(literally(text)).first();
  }

  /** The open report: its replies, the reply box and the status. */
  opened(text: string): Locator {
    const page = this.kb.page;
    return page.getByRole('dialog').or(page.getByRole('complementary')).filter({ hasText: text });
  }

  async openReport(text: string): Promise<Locator> {
    await this.report(text).click();
    const opened = this.opened(text);
    await expect(opened).toBeVisible();
    return opened;
  }

  async reply(opened: Locator, text: string) {
    await opened.getByRole('textbox', { name: /reply/i }).fill(text);
    await opened.getByRole('button', { name: /^(reply|send)$/i }).click();
    await expect(opened.getByText(text)).toBeVisible();
  }

  /** Sets the status: "In progress", "Fixed" or "Won't fix". */
  async setStatus(opened: Locator, status: 'In progress' | 'Fixed' | "Won't fix") {
    await opened
      .getByRole('button', { name: /^(status:? )?(new|in progress)$/i })
      .or(opened.getByRole('combobox', { name: /status/i }))
      .first()
      .click();
    await choice(this.kb.page, new RegExp(`^${literally(status).source}$`)).click();
    await expect(opened.getByText(status, { exact: true }).first()).toBeVisible();
  }
}
